/**
 * Eugenia's tasks in the background (§8.6, §11.2): the indexing of sources and the
 * re-evaluation of the stale sub-wiki descriptions. They are queued and run while the user
 * keeps browsing; each one is saved as soon as it is done, without asking node by node.
 *
 * - Indexing: two sources at a time (each one reads its parts in parallel).
 * - Descriptions: one at a time, from the deepest node to the root, so that a parent is
 *   described from the new descriptions of its children.
 */
import { create } from "zustand";
import {
  newSummaryDocument,
  regenerationOrder,
  serializeSummary,
  sourceIndexChanges,
  sourceIndexState,
  summaryInvolvesPrivate,
  summaryPath,
  summarySources,
  ulid,
  vectorItems,
  type KnowledgeNode,
  type SummaryScope,
} from "@openeugenia/core";
import { useSettings } from "../store/settings.ts";
import { errorMessage, toast } from "../store/ui.ts";
import { canEdit, useWiki } from "../store/wiki.ts";
import { indexingContext, taskContext } from "./ai.ts";
import { uncommittedPaths } from "./pending.ts";
import { stageEmbeddings } from "./semantic.ts";
import { hasAI, hasEmbeddings } from "./settings.ts";

export type TaskKind = "index" | "summary";

export interface Task {
  /** Source identifier (indexing), `summary:<node>:<scope>` (description). */
  key: string;
  kind: TaskKind;
  /** Source indexed, or category described. */
  nodeId: string;
  /** Description: its scope. */
  scope?: SummaryScope;
  title: string;
  status: "queued" | "running";
  /** Indexing: preset of the model (that of the settings when absent). */
  preset?: string;
  done: number;
  total: number;
  assembling: boolean;
  controller: AbortController;
}

interface TasksState {
  tasks: Record<string, Task>;
  /** Tasks done since the current batch started, for the overall progress. */
  finished: number;
}

export const useTasks = create<TasksState>(() => ({ tasks: {}, finished: 0 }));

/** Tasks of each kind run at the same time. */
const LANES: Record<TaskKind, number> = { index: 2, summary: 1 };

export function summaryKey(nodeId: string, scope: SummaryScope): string {
  return `summary:${nodeId}:${scope}`;
}

export function patchTask(key: string, patch: Partial<Task>): void {
  useTasks.setState((s) => {
    const task = s.tasks[key];
    return task ? { tasks: { ...s.tasks, [key]: { ...task, ...patch } } } : s;
  });
}

function removeTask(key: string, finished: boolean): void {
  useTasks.setState((s) => {
    const tasks = { ...s.tasks };
    delete tasks[key];
    // Every task done: the next batch counts from zero.
    const empty = Object.keys(tasks).length === 0;
    return { tasks, finished: empty ? 0 : s.finished + (finished ? 1 : 0) };
  });
}

/** Saving is done one task at a time: the pending changes are read, then rewritten. */
let saving: Promise<unknown> = Promise.resolve();
export function exclusive<T>(run: () => Promise<T>): Promise<T> {
  const next = saving.then(run);
  saving = next.catch(() => undefined);
  return next;
}

type NewTask = Pick<Task, "key" | "kind" | "nodeId" | "title"> &
  Partial<Pick<Task, "scope" | "preset">>;

/** Queues tasks (those already queued or running are left as they are). */
export function queueTasks(list: readonly NewTask[]): void {
  useTasks.setState((s) => {
    const tasks = { ...s.tasks };
    for (const task of list) {
      if (tasks[task.key]) continue;
      tasks[task.key] = {
        ...task,
        status: "queued",
        done: 0,
        total: 1,
        assembling: false,
        controller: new AbortController(),
      };
    }
    return { tasks };
  });
  pump();
}

function pump(): void {
  const all = Object.values(useTasks.getState().tasks);
  for (const kind of Object.keys(LANES) as TaskKind[]) {
    const lane = all.filter((t) => t.kind === kind);
    const free = LANES[kind] - lane.filter((t) => t.status === "running").length;
    for (const task of lane.filter((t) => t.status === "queued").slice(0, Math.max(0, free))) {
      patchTask(task.key, { status: "running" });
      const run = task.kind === "index" ? runIndexing(task) : runSummary(task);
      void run.then((ok) => {
        removeTask(task.key, ok);
        pump();
      });
    }
  }
}

/** Stops a task (or all of them, or all of a kind): a running one is abandoned. */
export function cancelTasks(filter: { key?: string; kind?: TaskKind } = {}): void {
  for (const task of Object.values(useTasks.getState().tasks)) {
    if (filter.key && task.key !== filter.key) continue;
    if (filter.kind && task.kind !== filter.kind) continue;
    task.controller.abort();
    if (task.status === "queued") removeTask(task.key, false);
  }
}

async function isAbort(error: unknown): Promise<boolean> {
  const { isAbortError } = await import("@openeugenia/ai");
  return isAbortError(error);
}

// ---------------------------------------------------------------------------
// Indexing of sources
// ---------------------------------------------------------------------------

async function runIndexing(task: Task): Promise<boolean> {
  const { nodeId: sourceId, controller } = task;
  const { workspace, derived } = useWiki.getState();
  const node = derived?.tree.nodes.get(sourceId);
  if (!workspace || !node || node.type !== "source") return false;
  try {
    const page = derived!.files.get(node.indexPath);
    if (page) await workspace.prefetch([page]);
    const state = await sourceIndexState(workspace, node);
    const context = await indexingContext(!node.isPublic, controller.signal, task.preset);
    const { indexSource } = await import("@openeugenia/ai");
    const root = await indexSource(
      context,
      { title: node.title, text: state.text },
      {
        onProgress: (p) =>
          patchTask(task.key, {
            done: p.done,
            total: Math.max(1, p.total),
            assembling: p.assembling === true,
          }),
      },
    );
    if (controller.signal.aborted) return false;
    await exclusive(() => saveIndex(sourceId, context.provider.info.model, state.textSha, root));
    return true;
  } catch (error) {
    if (!(await isAbort(error))) toast(`Indexing "${node.title}": ${errorMessage(error)}`, "error");
    return false;
  }
}

/**
 * Stages the index (and the embeddings of its sections), then commits it if the source is
 * saved. The knowledge it proposes stays in the index, for the user to add to the wiki.
 */
async function saveIndex(
  sourceId: string,
  model: string,
  textSha: string,
  root: KnowledgeNode,
): Promise<void> {
  const { workspace, stage, commit } = useWiki.getState();
  // The source may have been renamed in the meantime: the index goes next to its page.
  const current = workspace?.tree.nodes.get(sourceId);
  if (!workspace || !current) return;
  // Every page of the previous index is known before writing the new one.
  const changes = sourceIndexChanges(workspace, current, { model, textSha, root });
  const message = `Index of "${current.title}"`;
  await stage(changes, message);
  const paths = changes.map((c) => c.path);
  // Search by meaning: the sections of the new index get their embeddings right away.
  const settings = useSettings.getState().settings;
  if (hasEmbeddings(settings)) {
    try {
      const ws = useWiki.getState().workspace!;
      const indexed = ws.tree.nodes.get(sourceId);
      if (indexed) {
        const items = await vectorItems(ws, settings.ai.embeddings!.model!, {
          nodes: [indexed],
          discussions: [],
        });
        const sections = items.filter((i) => i.kind === "section");
        const staged = await stageEmbeddings(sections, sections);
        paths.push(...staged.changes.map((c) => c.path));
      }
    } catch (error) {
      toast(`Index saved, without the embeddings of its sections: ${errorMessage(error)}`, "error");
    }
  }
  // A source not saved yet: its index joins the pending changes, saved with it.
  const pending = useWiki.getState().workspace?.pending;
  if (pending && uncommittedPaths(pending).includes(current.indexPath)) {
    toast(`"${current.title}" is indexed: the index will be saved with your changes.`, "success");
  } else {
    await commit(message, paths);
    toast(`"${current.title}" is indexed.`, "success");
  }
}

// ---------------------------------------------------------------------------
// Sub-wiki descriptions
// ---------------------------------------------------------------------------

/** Descriptions to re-evaluate (stale or missing, not locked), from the deepest to the root. */
export function staleDescriptions(): { nodeId: string; title: string; scope: SummaryScope }[] {
  const derived = useWiki.getState().derived;
  if (!derived) return [];
  return (["private", "public"] as const).flatMap((scope) =>
    regenerationOrder(derived.tree, derived.summaryStates[scope]).map((node) => ({
      nodeId: node.id,
      title: node.title,
      scope,
    })),
  );
}

/** Queues the re-evaluation of the stale or missing descriptions, deepest first. */
export function queueDescriptions(): number {
  const list = staleDescriptions().filter((d) => !failed.has(summaryKey(d.nodeId, d.scope)));
  queueTasks(
    list.map((d) => ({
      key: summaryKey(d.nodeId, d.scope),
      kind: "summary" as const,
      nodeId: d.nodeId,
      scope: d.scope,
      title: d.title,
    })),
  );
  return list.length;
}

/** Descriptions whose regeneration failed: not scheduled again automatically. */
const failed = new Set<string>();

async function runSummary(task: Task): Promise<boolean> {
  const scope = task.scope ?? "private";
  const { workspace, derived } = useWiki.getState();
  const node = derived?.tree.nodes.get(task.nodeId);
  if (!workspace || !derived || !node) return false;
  // Re-evaluated in the meantime, or locked: nothing to do.
  const status = derived.summaryStates[scope].get(node.id)?.status;
  if (status !== "stale" && status !== "missing") return true;
  try {
    const { summarizeNode, summaryInputFor } = await import("@openeugenia/ai");
    const context = await taskContext(
      summaryInvolvesPrivate(derived.tree, node, scope),
      task.controller.signal,
    );
    const input = await summaryInputFor(workspace, node.id, scope, derived.summaries);
    const text = await summarizeNode(context, input);
    if (task.controller.signal.aborted || !text) return false;
    await exclusive(async () => {
      const { derived: current, stage, commit } = useWiki.getState();
      const target = current?.tree.nodes.get(node.id);
      if (!current || !target) return;
      const path = summaryPath(target, scope);
      const existing = current.summaries.get(path);
      const doc = newSummaryDocument({
        id: existing?.fields.id || ulid(),
        scope,
        body: text,
        sources: summarySources(current.tree, target, scope),
        model: context.provider.info.model,
        locked: existing?.fields.locked ?? false,
      });
      const message = `Description of "${target.title}"${scope === "public" ? " (public)" : ""}`;
      await stage([{ op: "write", path, content: serializeSummary(doc) }], message);
      await commit(message, [path]);
    });
    return true;
  } catch (error) {
    if (await isAbort(error)) return false;
    failed.add(task.key);
    const { AIError } = await import("@openeugenia/ai");
    // Without a provider allowed for this content, the other descriptions would fail too.
    if (error instanceof AIError && (error.kind === "privacy" || error.kind === "config")) {
      cancelTasks({ kind: "summary" });
      for (const d of staleDescriptions()) failed.add(summaryKey(d.nodeId, d.scope));
    }
    toast(`Description of "${node.title}": ${errorMessage(error)}`, "error");
    return false;
  }
}

/**
 * Automatic re-evaluation of the descriptions: when the wiki is open with everything saved, the
 * stale descriptions are queued (unless the user turned it off).
 */
function scheduleDescriptions(): void {
  const state = useWiki.getState();
  const settings = useSettings.getState().settings;
  if (state.status !== "ready" || !state.online || !canEdit(state)) return;
  if (settings.ai.autoSummarize === false || !hasAI(settings)) return;
  // While the user has unsaved changes, the wiki is still moving.
  if (state.workspace && uncommittedPaths(state.workspace.pending).length > 0) return;
  queueDescriptions();
}

let timer: ReturnType<typeof setTimeout> | undefined;
if (typeof window !== "undefined") {
  useWiki.subscribe((state, previous) => {
    if (state.derived === previous.derived || state.status !== "ready") return;
    clearTimeout(timer);
    timer = setTimeout(scheduleDescriptions, 2000);
  });
}
