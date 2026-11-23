/**
 * Indexing of sources (§8.6) in the app: a large model (Mistral Large by default) describes a
 * source as a knowledge tree, saved in `_tree.json` next to it, with the embeddings of its
 * sections if search by meaning is set up. A job keeps running when the user leaves the page;
 * its progress is shared by every view.
 */
import { create } from "zustand";
import {
  newSourceTreeDocument,
  serializeSourceTree,
  sourceTreePath,
  sourceTreeState,
  vectorItems,
  type FileChange,
} from "@openeugenia/core";
import { useSettings } from "../store/settings.ts";
import { errorMessage, toast } from "../store/ui.ts";
import { useWiki } from "../store/wiki.ts";
import { indexingContext } from "./ai.ts";
import { uncommittedPaths } from "./pending.ts";
import { stageEmbeddings } from "./semantic.ts";
import { hasEmbeddings, indexingConfig } from "./settings.ts";

export interface IndexJob {
  sourceId: string;
  title: string;
  done: number;
  total: number;
  assembling: boolean;
  controller: AbortController;
}

export const useIndexing = create<{ jobs: Record<string, IndexJob> }>(() => ({ jobs: {} }));

function setJob(id: string, job: IndexJob | null): void {
  useIndexing.setState((s) => {
    const jobs = { ...s.jobs };
    if (job) jobs[id] = job;
    else delete jobs[id];
    return { jobs };
  });
}

let queue: Promise<unknown> = Promise.resolve();

/** Indexes a source, then commits its index. Jobs run one after the other. */
export function indexSourceNode(sourceId: string): Promise<boolean> {
  const run = queue.then(() => runIndexing(sourceId));
  queue = run.catch(() => undefined);
  return run;
}

async function runIndexing(sourceId: string): Promise<boolean> {
  const { workspace, derived } = useWiki.getState();
  const node = derived?.tree.nodes.get(sourceId);
  if (!workspace || !node || node.type !== "source" || useIndexing.getState().jobs[sourceId]) {
    return false;
  }
  const controller = new AbortController();
  const job: IndexJob = {
    sourceId,
    title: node.title,
    done: 0,
    total: 1,
    assembling: false,
    controller,
  };
  setJob(sourceId, job);
  try {
    await workspace.prefetch([derived!.files.get(node.indexPath)!]);
    const state = await sourceTreeState(workspace, node);
    const context = await indexingContext(!node.isPublic, controller.signal);
    const { indexSource } = await import("@openeugenia/ai");
    const root = await indexSource(
      context,
      { title: node.title, text: state.text },
      {
        onProgress: (p) =>
          setJob(sourceId, {
            ...job,
            done: p.done,
            total: Math.max(1, p.total),
            assembling: p.assembling === true,
          }),
      },
    );
    if (controller.signal.aborted) return false;
    // The source may have been renamed in the meantime: the index goes next to its page.
    const current = useWiki.getState().derived?.tree.nodes.get(sourceId) ?? node;
    const doc = newSourceTreeDocument({
      model: context.provider.info.model,
      textSha: state.textSha,
      root,
    });
    const change: FileChange = {
      op: "write",
      path: sourceTreePath(current),
      content: serializeSourceTree(doc),
    };
    const { stage, commit } = useWiki.getState();
    const message = `Index of "${current.title}"`;
    await stage([change], message);
    const paths = [change.path];
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
          const staged = await stageEmbeddings(sections, sections, { signal: controller.signal });
          paths.push(...staged.changes.map((c) => c.path));
        }
      } catch (error) {
        toast(
          `Index saved, without the embeddings of its sections: ${errorMessage(error)}`,
          "error",
        );
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
    return true;
  } catch (error) {
    const { isAbortError } = await import("@openeugenia/ai");
    if (!isAbortError(error)) toast(`Indexing "${node.title}": ${errorMessage(error)}`, "error");
    return false;
  } finally {
    setJob(sourceId, null);
  }
}

export function cancelIndexing(sourceId: string): void {
  useIndexing.getState().jobs[sourceId]?.controller.abort();
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
  for (const id of sourceIds) {
    const node = derived.tree.nodes.get(id);
    if (!node || node.type !== "source" || node.virtual) continue;
    if (!node.isPublic && remote && settings.ai.localOnlyForPrivate === true) continue;
    // Only a new or changed text is indexed again.
    const state = await sourceTreeState(workspace, node).catch(() => null);
    if (state?.status === "current") continue;
    void indexSourceNode(id);
  }
}
