/**
 * Recherche sémantique (§14) : embeddings des pages (`_embedding.json` du dépôt privé),
 * calcul des manquants ou périmés par le fournisseur d'embeddings (Mistral par défaut), et
 * classement des pages par proximité de sens avec une requête.
 */
import {
  embeddingEntries,
  embeddingPath,
  newEmbeddingDocument,
  rankBySimilarity,
  serializeEmbedding,
  type EmbeddingEntry,
  type FileChange,
  type RepoFile,
  type SimilarityHit,
} from "@openeugenia/core";
import { useWiki } from "../store/wiki.ts";
import { embeddingAccess } from "./ai.ts";

export interface SemanticIndex {
  model: string;
  entries: EmbeddingEntry[];
}

export function pendingEntries(index: SemanticIndex): EmbeddingEntry[] {
  return index.entries.filter((e) => e.status !== "current");
}

/** Charge les embeddings du wiki (lecture groupée) et compare chaque page à son texte actuel. */
export async function loadSemanticIndex(model: string): Promise<SemanticIndex> {
  const { workspace, derived } = useWiki.getState();
  if (!workspace || !derived) throw new Error("Wiki non chargé.");
  const files: RepoFile[] = [];
  for (const node of derived.tree.nodes.values()) {
    if (node.virtual) continue;
    const page = derived.files.get(node.indexPath);
    if (page) files.push(page);
    if (node.embedding) files.push(node.embedding);
  }
  await workspace.prefetch(files);
  return { model, entries: await embeddingEntries(workspace, model) };
}

export interface IndexingResult {
  indexed: number;
  /** Pages privées non envoyées : le privé est réservé à une IA locale. */
  skippedPrivate: number;
}

/** Calcule les embeddings manquants ou périmés et les enregistre en un seul commit. */
export async function indexPages(
  index: SemanticIndex,
  options: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<IndexingResult> {
  const todo = pendingEntries(index);
  const { provider, allowsPrivate } = await embeddingAccess(todo.some((e) => !e.node.isPublic));
  const plan = allowsPrivate ? todo : todo.filter((e) => e.node.isPublic);
  const { embedTexts } = await import("@openeugenia/ai");
  const vectors = await embedTexts(
    provider,
    plan.map((e) => e.text),
    options,
  );
  const changes: FileChange[] = plan.map((entry, i) => ({
    op: "write",
    path: embeddingPath(entry.node),
    content: serializeEmbedding(
      newEmbeddingDocument({
        model: provider.info.model,
        textSha: entry.textSha,
        vector: vectors[i]!,
      }),
    ),
  }));
  if (changes.length > 0) {
    const { stage, commit } = useWiki.getState();
    const message = `Index sémantique : ${changes.length} page(s)`;
    await stage(changes, message);
    await commit(
      message,
      changes.map((c) => c.path),
    );
  }
  return { indexed: changes.length, skippedPrivate: todo.length - plan.length };
}

/** Pages les plus proches d'une requête, d'après leurs embeddings enregistrés. */
export async function semanticSearch(
  index: SemanticIndex,
  query: string,
  signal?: AbortSignal,
): Promise<SimilarityHit[]> {
  const { provider } = await embeddingAccess();
  const { embedQuery } = await import("@openeugenia/ai");
  const vector = await embedQuery(provider, query, signal);
  return rankBySimilarity(
    vector,
    index.entries.flatMap((e) => (e.vector ? [{ id: e.node.id, vector: e.vector }] : [])),
    20,
  );
}
