/**
 * Indexing of sources (§8.6) in the app: a Mistral model (a preset, with or without reasoning)
 * describes a source as a knowledge tree, saved like the wiki in its `_index/` folder, with the
 * embeddings of its sections if search by meaning is set up. The knowledge it proposes is added
 * to the wiki without review (unless the user turned it off), filed by Eugenia.
 *
 * Indexing runs in the background: the jobs live outside the views, so the user keeps browsing
 * while sources are indexed (two at a time), and every view shows their progress.
 */
import { useEffect, useState } from "react";
import { create } from "zustand";
import {
  extractionChanges,
  findIndexNode,
  indexKnowledge,
  newCandidates,
  normalizeKnowledgeTree,
  readSourceIndex,
  sourceIndexChanges,
  sourceIndexPages,
  sourceIndexState,
  vectorItems,
  type ExtractionPlan,
  type KnowledgeCandidate,
  type KnowledgeNode,
  type SourceIndexDocument,
  type WikiNode,
} from "@openeugenia/core";
import type { TaskContext } from "@openeugenia/ai";
import { useSettings } from "../store/settings.ts";
import { errorMessage, toast } from "../store/ui.ts";
import { useWiki } from "../store/wiki.ts";
import { indexingContext, taskContext } from "./ai.ts";
import { uncommittedPaths } from "./pending.ts";
import { stageEmbeddings } from "./semantic.ts";
import { hasAI, hasEmbeddings, hasIndexing, indexingConfig } from "./settings.ts";

export interface IndexJob {
  sourceId: string;
  title: string;
  status: "queued" | "running";
  /** Preset of the model (that of the settings when absent). */
  preset?: string;
  done: number;
  total: number;
  assembling: boolean;
  /** The proposed knowledge is being filed in the wiki. */
  extracting?: boolean;
  controller: AbortController;
}

interface IndexingState {
  jobs: Record<string, IndexJob>;
  /** Sources indexed since the current batch started, for the overall progress. */
  finished: number;
}

export const useIndexing = create<IndexingState>(() => ({ jobs: {}, finished: 0 }));

/** Sources indexed at the same time (each one reads its parts in parallel). */
const CONCURRENCY = 2;

function patchJob(id: string, patch: Partial<IndexJob>): void {
  useIndexing.setState((s) => {
    const job = s.jobs[id];
    return job ? { jobs: { ...s.jobs, [id]: { ...job, ...patch } } } : s;
  });
}

function removeJob(id: string, finished: boolean): void {
  useIndexing.setState((s) => {
    const jobs = { ...s.jobs };
    delete jobs[id];
    // Every job done: the next batch counts from zero.
    const empty = Object.keys(jobs).length === 0;
    return { jobs, finished: empty ? 0 : s.finished + (finished ? 1 : 0) };
  });
}

/** Saving is done one job at a time: the pending changes are read, then rewritten. */
let saving: Promise<unknown> = Promise.resolve();
function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = saving.then(task);
  saving = run.catch(() => undefined);
  return run;
}

/**
 * Queues the indexing of sources (already queued or running ones are left as they are). It runs
 * in the background; `preset` chooses another model than that of the settings.
 */
export function queueIndexing(sourceIds: readonly string[], preset?: string): void {
  const tree = useWiki.getState().derived?.tree;
  useIndexing.setState((s) => {
    const jobs = { ...s.jobs };
    for (const id of sourceIds) {
      const node = tree?.nodes.get(id);
      if (!node || node.type !== "source" || jobs[id]) continue;
      jobs[id] = {
        sourceId: id,
        title: node.title,
        status: "queued",
        ...(preset ? { preset } : {}),
        done: 0,
        total: 1,
        assembling: false,
        controller: new AbortController(),
      };
    }
    return { jobs };
  });
  pump();
}

/** Indexes one source, in the background. */
export function indexSourceNode(sourceId: string, preset?: string): void {
  queueIndexing([sourceId], preset);
}

function pump(): void {
  const jobs = Object.values(useIndexing.getState().jobs);
  const running = jobs.filter((j) => j.status === "running").length;
  for (const job of jobs.filter((j) => j.status === "queued").slice(0, CONCURRENCY - running)) {
    patchJob(job.sourceId, { status: "running" });
    void runIndexing(job).then((ok) => {
      removeJob(job.sourceId, ok);
      pump();
    });
  }
}

async function runIndexing(job: IndexJob): Promise<boolean> {
  const { sourceId, controller } = job;
  const { workspace, derived } = useWiki.getState();
  const node = derived?.tree.nodes.get(sourceId);
  if (!workspace || !node || node.type !== "source") return false;
  try {
    const page = derived!.files.get(node.indexPath);
    if (page) await workspace.prefetch([page]);
    const state = await sourceIndexState(workspace, node);
    const context = await indexingContext(!node.isPublic, controller.signal, job.preset);
    const { indexSource } = await import("@openeugenia/ai");
    const root = await indexSource(
      context,
      { title: node.title, text: state.text },
      {
        onProgress: (p) =>
          patchJob(sourceId, {
            done: p.done,
            total: Math.max(1, p.total),
            assembling: p.assembling === true,
          }),
      },
    );
    if (controller.signal.aborted) return false;
    // The knowledge proposed by the index goes to the wiki without review, filed by Eugenia.
    let plan: ExtractionPlan | null = null;
    if (useSettings.getState().settings.ai.autoExtract !== false) {
      const tree = useWiki.getState().workspace?.tree ?? derived!.tree;
      const candidates = newCandidates(tree, sourceId, allCandidates(root));
      if (candidates.length > 0) {
        patchJob(sourceId, { extracting: true });
        plan = await filingPlan(node, candidates, root.description, controller.signal, job.preset);
      }
    }
    if (controller.signal.aborted) return false;
    await exclusive(() =>
      saveIndex(sourceId, context.provider.info.model, state.textSha, root, plan),
    );
    return true;
  } catch (error) {
    const { isAbortError } = await import("@openeugenia/ai");
    if (!isAbortError(error)) toast(`Indexing "${node.title}": ${errorMessage(error)}`, "error");
    return false;
  }
}

/** Knowledge proposed by a generated tree, from the root down. */
function allCandidates(root: KnowledgeNode): KnowledgeCandidate[] {
  const visit = (node: KnowledgeNode): KnowledgeCandidate[] => [
    ...(node.knowledge ?? []),
    ...node.children.flatMap(visit),
  ];
  return visit(normalizeKnowledgeTree(root));
}

/**
 * Context to file knowledge in the categories of the wiki (their titles and descriptions are
 * sent): the indexing model, otherwise the main one; `null` if neither may receive them.
 */
async function categorizationContext(
  signal?: AbortSignal,
  preset?: string,
): Promise<TaskContext | null> {
  const settings = useSettings.getState().settings;
  try {
    if (hasIndexing(settings)) return await indexingContext(true, signal, preset);
    if (hasAI(settings)) return await taskContext(true, signal);
  } catch (error) {
    const { isAbortError } = await import("@openeugenia/ai");
    if (isAbortError(error)) throw error;
  }
  return null;
}

/** Where the proposed knowledge goes: filed by Eugenia, otherwise in the category of the source. */
async function filingPlan(
  source: WikiNode,
  candidates: readonly KnowledgeCandidate[],
  summary: string,
  signal?: AbortSignal,
  preset?: string,
): Promise<ExtractionPlan> {
  const context = await categorizationContext(signal, preset);
  const workspace = useWiki.getState().workspace!;
  if (!context) {
    const category = source.filedIn ?? workspace.tree.rootId;
    return { sourceId: source.id, knowledge: candidates.map((c) => ({ ...c, category })) };
  }
  const { indexExtractionPlan } = await import("@openeugenia/ai");
  return indexExtractionPlan(context, workspace, source, candidates, summary);
}

/**
 * Stages the index (and the embeddings of its sections) with the knowledge it adds to the wiki,
 * then commits them if the source is saved.
 */
async function saveIndex(
  sourceId: string,
  model: string,
  textSha: string,
  root: KnowledgeNode,
  plan: ExtractionPlan | null,
): Promise<void> {
  const { workspace, stage, commit } = useWiki.getState();
  // The source may have been renamed in the meantime: the index goes next to its page.
  const current = workspace?.tree.nodes.get(sourceId);
  if (!workspace || !current) return;
  // Every page of the previous index is known before writing the new one.
  const changes = sourceIndexChanges(workspace, current, { model, textSha, root });
  const extracted = plan ? await extractionChanges(workspace, plan) : null;
  if (extracted) changes.push(...extracted.changes);
  const added = extracted?.knowledge.length ?? 0;
  const message = added
    ? `Index of "${current.title}", and ${added} knowledge item(s)`
    : `Index of "${current.title}"`;
  const done = added
    ? `"${current.title}" is indexed: ${added} knowledge item(s) added to your wiki.`
    : `"${current.title}" is indexed.`;
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
    toast(`${done} It will be saved with your changes.`, "success");
  } else {
    await commit(message, paths);
    toast(done, "success");
  }
}

/**
 * Adds the knowledge proposed by the index of a source (or by one of its sections, and below)
 * to the wiki, without review: Eugenia files it, then it is committed. Returns the number of
 * knowledge items added (those already in the wiki are left out).
 */
export async function addProposedKnowledge(sourceId: string, key = ""): Promise<number> {
  const { workspace } = useWiki.getState();
  const source = workspace?.tree.nodes.get(sourceId);
  if (!workspace || !source) return 0;
  const index = await readSourceIndex(workspace, source);
  const start = index ? findIndexNode(index.root, key) : undefined;
  if (!index || !start) return 0;
  const candidates = newCandidates(
    workspace.tree,
    sourceId,
    indexKnowledge(start).map((k) => k.candidate),
  );
  if (candidates.length === 0) return 0;
  const plan = await filingPlan(source, candidates, index.root.description);
  return exclusive(async () => {
    const ws = useWiki.getState().workspace!;
    const { changes, knowledge } = await extractionChanges(ws, plan);
    const message = `Extraction: ${knowledge.length} knowledge item(s) from the index of "${source.title}"`;
    await useWiki.getState().stage(changes, message);
    await useWiki.getState().commit(
      message,
      changes.map((c) => c.path),
    );
    return knowledge.length;
  });
}

/** Stops a job (or all of them): a running one is abandoned, a queued one removed. */
export function cancelIndexing(sourceId?: string): void {
  for (const job of Object.values(useIndexing.getState().jobs)) {
    if (sourceId && job.sourceId !== sourceId) continue;
    job.controller.abort();
    if (job.status === "queued") removeJob(job.sourceId, false);
  }
}

/**
 * Indexes new or changed sources, if automatic indexing is on and possible: a private source
 * is left aside when private content is kept for a local AI and the indexing model is remote.
 */
export async function autoIndex(sourceIds: readonly string[]): Promise<void> {
  const settings = useSettings.getState().settings;
  const config = indexingConfig(settings);
  if (!config || settings.ai.autoIndex === false) return;
  const { isLocalUrl } = await import("@openeugenia/ai");
  const remote = config.kind !== "ollama" && !isLocalUrl(config.baseUrl ?? "");
  const { workspace, derived } = useWiki.getState();
  if (!workspace || !derived) return;
  const todo: string[] = [];
  for (const id of sourceIds) {
    const node = derived.tree.nodes.get(id);
    if (!node || node.type !== "source" || node.virtual) continue;
    if (!node.isPublic && remote && settings.ai.localOnlyForPrivate === true) continue;
    // Only a new or changed text is indexed again.
    const state = await sourceIndexState(workspace, node).catch(() => null);
    if (state?.status === "current") continue;
    todo.push(id);
  }
  queueIndexing(todo);
}

/** Index of a source, read from its pages (loaded in one batch), or `null` without index. */
export function useSourceIndex(node: WikiNode | undefined): {
  index: SourceIndexDocument | null;
  loading: boolean;
  error?: string;
} {
  const workspace = useWiki((s) => s.workspace);
  const version = useWiki((s) => s.version);
  const [state, setState] = useState<{
    index: SourceIndexDocument | null;
    loading: boolean;
    error?: string;
  }>({ index: null, loading: Boolean(node?.sourceIndex?.root) });
  const root = node?.sourceIndex?.root?.sha;
  useEffect(() => {
    if (!workspace || !node?.sourceIndex?.root) {
      setState({ index: null, loading: false });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: s.index === null }));
    const pages = sourceIndexPages(workspace.files.keys(), node).flatMap((p) => {
      const file = workspace.files.get(p);
      return file ? [file] : [];
    });
    workspace
      .prefetch(pages)
      .then(() => readSourceIndex(workspace, node))
      .then(
        (index) => !cancelled && setState({ index, loading: false }),
        (error: unknown) =>
          !cancelled && setState({ index: null, loading: false, error: errorMessage(error) }),
      );
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, node?.id, root, version]);
  return state;
}
