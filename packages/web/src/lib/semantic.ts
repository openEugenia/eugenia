/**
 * Search by meaning (§14) across the common hierarchy: embeddings of the pages
 * (`_embedding.json`), of the discussions (`<discussions>/_embeddings/`) and of the sections of
 * the source indexes (`_tree.embeddings.json`), in the private repository; computation of the
 * missing or stale ones by the embedding provider (Mistral by default), and ranking of the
 * elements by closeness of meaning to a query.
 */
import {
  embeddingChanges,
  isEmbeddable,
  rankBySimilarity,
  vectorItems,
  type FileChange,
  type RepoFile,
  type SimilarityHit,
  type VectorItem,
} from "@openeugenia/core";
import { useWiki } from "../store/wiki.ts";
import { embeddingAccess } from "./ai.ts";
import type { Derived } from "./workspace.ts";

export interface SemanticIndex {
  model: string;
  items: VectorItem[];
}

export function pendingItems(index: SemanticIndex): VectorItem[] {
  return index.items.filter((e) => e.status !== "current");
}

/** Files read to build the catalog: contents and their embeddings. */
function catalogFiles(derived: Derived): RepoFile[] {
  const files: RepoFile[] = [];
  const add = (file: RepoFile | undefined): void => {
    if (file) files.push(file);
  };
  for (const node of derived.tree.nodes.values()) {
    if (!isEmbeddable(node)) continue;
    add(derived.files.get(node.indexPath));
    add(node.embedding);
    for (const page of node.sourceIndex?.pages ?? []) add(page);
    add(node.sourceIndex?.embeddings);
  }
  for (const entry of derived.discussions) {
    if (entry.meta.kind === "quiz") continue;
    add(derived.files.get(entry.path));
    add(derived.tree.discussionEmbeddings.get(entry.path));
  }
  return files;
}

/** Loads the embeddings (batched reads) and compares each element with its current text. */
export async function loadSemanticIndex(model: string): Promise<SemanticIndex> {
  const { workspace, derived } = useWiki.getState();
  if (!workspace || !derived) throw new Error("Wiki not loaded.");
  await workspace.prefetch(catalogFiles(derived));
  const items = await vectorItems(workspace, model, {
    discussions: derived.discussions.map((d) => ({ path: d.path, meta: d.meta })),
  });
  return { model, items };
}

let cached: { derived: Derived; model: string; index: Promise<SemanticIndex> } | null = null;

/** Catalog of the current state of the wiki, reused until the next change. */
export function currentSemanticIndex(model: string): Promise<SemanticIndex> {
  const derived = useWiki.getState().derived;
  if (cached && cached.derived === derived && cached.model === model) return cached.index;
  const index = loadSemanticIndex(model);
  if (derived) cached = { derived, model, index };
  index.catch(() => {
    if (cached?.index === index) cached = null;
  });
  return index;
}

export interface IndexingResult {
  indexed: number;
  /** Private elements not sent: private content is kept for a local AI. */
  skippedPrivate: number;
}

/** Computes the missing or stale embeddings of `items` and stages them (no commit). */
export async function stageEmbeddings(
  items: readonly VectorItem[],
  all: readonly VectorItem[],
  options: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ changes: FileChange[]; skippedPrivate: number; indexed: number }> {
  const todo = items.filter((e) => e.status !== "current");
  if (todo.length === 0) return { changes: [], skippedPrivate: 0, indexed: 0 };
  const { provider, allowsPrivate } = await embeddingAccess(todo.some((e) => !e.isPublic));
  const plan = allowsPrivate ? todo : todo.filter((e) => e.isPublic);
  const { embedTexts } = await import("@openeugenia/ai");
  const vectors = await embedTexts(
    provider,
    plan.map((e) => e.text),
    options,
  );
  const computed = new Map(plan.map((e, i) => [e.id, vectors[i]!]));
  const changes = embeddingChanges(all, computed, provider.info.model);
  if (changes.length > 0) {
    await useWiki.getState().stage(changes, `Semantic index: ${plan.length} element(s)`);
  }
  return { changes, skippedPrivate: todo.length - plan.length, indexed: plan.length };
}

/** Computes the missing or stale embeddings and saves them in a single commit. */
export async function indexEmbeddings(
  index: SemanticIndex,
  options: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<IndexingResult> {
  const { changes, skippedPrivate, indexed } = await stageEmbeddings(
    index.items,
    index.items,
    options,
  );
  if (changes.length > 0) {
    await useWiki.getState().commit(
      `Semantic index: ${indexed} element(s)`,
      changes.map((c) => c.path),
    );
  }
  return { indexed, skippedPrivate };
}

/** Elements closest to a query, according to their recorded embeddings. */
export async function semanticSearch(
  index: SemanticIndex,
  query: string,
  signal?: AbortSignal,
  limit = 20,
): Promise<SimilarityHit[]> {
  const { provider } = await embeddingAccess();
  const { embedQuery } = await import("@openeugenia/ai");
  const vector = await embedQuery(provider, query, signal);
  return rankBySimilarity(
    vector,
    index.items.flatMap((e) => (e.vector ? [{ id: e.id, vector: e.vector }] : [])),
    limit,
  );
}
