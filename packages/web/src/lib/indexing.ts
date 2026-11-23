/**
 * Indexes of sources (§8.6) in the app: their indexing in the background (see `tasks.ts`), the
 * reading of an index, and the knowledge it proposes, which the user adds to the wiki when they
 * wish — in one click, without review, filed in the category of the source or below it.
 */
import { useEffect, useState } from "react";
import {
  extractionChanges,
  findIndexNode,
  indexKnowledge,
  isAncestorOf,
  isCategory,
  knowledgeKey,
  newCandidates,
  readSourceIndex,
  sourceIndexPages,
  sourceIndexState,
  type ExtractionPlan,
  type KnowledgeCandidate,
  type SourceIndexDocument,
  type WikiNode,
} from "@openeugenia/core";
import type { TaskContext } from "@openeugenia/ai";
import { useSettings } from "../store/settings.ts";
import { errorMessage } from "../store/ui.ts";
import { useWiki } from "../store/wiki.ts";
import { indexingContext, taskContext } from "./ai.ts";
import { hasAI, hasIndexing, indexingConfig } from "./settings.ts";
import { cancelTasks, exclusive, queueTasks } from "./tasks.ts";

/**
 * Queues the indexing of sources, in the background; `preset` chooses another model than that
 * of the settings.
 */
export function queueIndexing(sourceIds: readonly string[], preset?: string): void {
  const tree = useWiki.getState().derived?.tree;
  queueTasks(
    sourceIds.flatMap((id) => {
      const node = tree?.nodes.get(id);
      return node?.type === "source"
        ? [
            {
              key: id,
              kind: "index" as const,
              nodeId: id,
              title: node.title,
              ...(preset ? { preset } : {}),
            },
          ]
        : [];
    }),
  );
}

/** Indexes one source, in the background. */
export function indexSourceNode(sourceId: string, preset?: string): void {
  queueIndexing([sourceId], preset);
}

/** Stops the indexing of a source, or of all of them. */
export function cancelIndexing(sourceId?: string): void {
  cancelTasks(sourceId ? { key: sourceId } : { kind: "index" });
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

/**
 * Context to file knowledge in the categories of the wiki (their titles and descriptions are
 * sent): the indexing model, otherwise the main one; `null` if neither may receive them.
 */
async function categorizationContext(involvesPrivate: boolean): Promise<TaskContext | null> {
  const settings = useSettings.getState().settings;
  try {
    if (hasIndexing(settings)) return await indexingContext(involvesPrivate);
    if (hasAI(settings)) return await taskContext(involvesPrivate);
  } catch (error) {
    const { isAbortError } = await import("@openeugenia/ai");
    if (isAbortError(error)) throw error;
  }
  return null;
}

/**
 * Where knowledge proposed by a source goes: in the category of the source or below it, filed
 * by Eugenia; otherwise in the category of the source itself.
 */
async function filingPlan(
  source: WikiNode,
  candidates: readonly KnowledgeCandidate[],
  summary: string,
): Promise<ExtractionPlan> {
  const workspace = useWiki.getState().workspace!;
  const tree = workspace.tree;
  // Sent: the knowledge of the source and the categories of its branch.
  const branch = source.filedIn ?? tree.rootId;
  const involvesPrivate =
    !source.isPublic ||
    [...tree.nodes.values()].some(
      (n) => isCategory(n) && !n.isPublic && (n.id === branch || isAncestorOf(tree, branch, n.id)),
    );
  const context = await categorizationContext(involvesPrivate);
  if (!context) {
    const category = source.filedIn ?? workspace.tree.rootId;
    return { sourceId: source.id, knowledge: candidates.map((c) => ({ ...c, category })) };
  }
  const { indexExtractionPlan } = await import("@openeugenia/ai");
  return indexExtractionPlan(context, workspace, source, candidates, summary);
}

/**
 * Adds to the wiki, without review, the knowledge proposed by the index of a source: that of a
 * node and of the nodes below it, or only the item titled `title`. It is filed in the category
 * of the source or below it, then committed. Returns the number of knowledge items added
 * (those already in the wiki are left out).
 */
export async function addProposedKnowledge(
  sourceId: string,
  key = "",
  title?: string,
): Promise<number> {
  const { workspace } = useWiki.getState();
  const source = workspace?.tree.nodes.get(sourceId);
  if (!workspace || !source) return 0;
  const index = await readSourceIndex(workspace, source);
  const start = index ? findIndexNode(index.root, key) : undefined;
  if (!index || !start) return 0;
  const proposed = indexKnowledge(start)
    .map((k) => k.candidate)
    .filter((c) => title === undefined || knowledgeKey(c.title) === knowledgeKey(title));
  const candidates = newCandidates(workspace.tree, sourceId, proposed);
  if (candidates.length === 0) return 0;
  const plan = await filingPlan(source, candidates, index.root.description);
  return exclusive(async () => {
    const ws = useWiki.getState().workspace!;
    const { changes, knowledge } = await extractionChanges(ws, plan);
    const message =
      knowledge.length === 1
        ? `Knowledge "${knowledge[0]!.title}", from "${source.title}"`
        : `Extraction: ${knowledge.length} knowledge item(s) from the index of "${source.title}"`;
    await useWiki.getState().stage(changes, message);
    await useWiki.getState().commit(
      message,
      changes.map((c) => c.path),
    );
    return knowledge.length;
  });
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
