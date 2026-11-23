/**
 * Page embeddings, for semantic search (§14): one `_embedding.json` file per page, next to
 * its `index.md`, in the private repository only. Publication only copies what it explicitly
 * selected: these files are never published.
 *
 * The vector is quantized to 8 bits (one scale factor per vector): four times less space than
 * 32-bit floats, for a practically identical similarity ranking.
 */
import { markdownToText } from "./markdown.ts";
import type { WikiView } from "./operations.ts";
import { parseFlashcardBody, parsePage } from "./pages.ts";
import { joinPath } from "./paths.ts";
import { base64ToBytes, bytesToBase64, gitBlobSha } from "./sha.ts";
import { isoTimestamp } from "./time.ts";
import { EMBEDDING_FILE, type WikiNode } from "./tree.ts";

export const EMBEDDING_FORMAT = "eugenia-embedding";
/** Maximum length of the text sent to the model (mistral-embed accepts 8,192 tokens). */
export const EMBEDDING_MAX_CHARS = 16_000;

export interface EmbeddingDocument {
  model: string;
  /** Fingerprint (git blob SHA, 7 characters) of the text sent to the model. */
  textSha: string;
  generated: string;
  vector: Float32Array;
}

/** `stale`: different text or model, or unreadable file. */
export type EmbeddingStatus = "current" | "stale" | "missing";

export function embeddingPath(node: Pick<WikiNode, "path">): string {
  return joinPath(node.path, EMBEDDING_FILE);
}

/**
 * Text of a page sent to the model: title, tags, then content as plain text. Link URLs and
 * the frontmatter (dates, visibility…) are not part of it: moving or republishing a page
 * does not make its embedding stale.
 */
export function embeddingText(indexContent: string): string {
  const doc = parsePage(indexContent);
  let parts: string[];
  if (doc.fields.type === "flashcard") {
    const card = parseFlashcardBody(doc.body);
    parts = [card.preamble, card.knowledge, card.question, card.answer, card.others]
      .filter((p): p is string => Boolean(p?.trim()))
      .map((p) => markdownToText(p).trim());
  } else {
    parts = [markdownToText(doc.body).trim()];
  }
  const head = [doc.fields.title];
  if (doc.fields.authors?.length) head.push(`Authors: ${doc.fields.authors.join(", ")}`);
  if (doc.fields.tags?.length) head.push(`Tags: ${doc.fields.tags.join(", ")}`);
  const text = [head.join("\n"), ...parts.filter(Boolean)].join("\n\n").trim();
  return text.length > EMBEDDING_MAX_CHARS ? text.slice(0, EMBEDDING_MAX_CHARS) : text;
}

export async function embeddingTextSha(text: string): Promise<string> {
  return (await gitBlobSha(text)).slice(0, 7);
}

export function newEmbeddingDocument(input: {
  model: string;
  textSha: string;
  vector: ArrayLike<number>;
  now?: Date;
}): EmbeddingDocument {
  return {
    model: input.model,
    textSha: input.textSha,
    generated: isoTimestamp(input.now),
    vector: Float32Array.from(input.vector),
  };
}

export function serializeEmbedding(doc: EmbeddingDocument): string {
  let max = 0;
  for (const v of doc.vector) max = Math.max(max, Math.abs(v));
  const scale = max > 0 ? max / 127 : 1;
  const quantized = new Int8Array(doc.vector.length);
  for (let i = 0; i < doc.vector.length; i++) {
    quantized[i] = Math.max(-127, Math.min(127, Math.round(doc.vector[i]! / scale)));
  }
  const data = {
    format: EMBEDDING_FORMAT,
    version: 1,
    model: doc.model,
    text_sha: doc.textSha,
    generated: doc.generated,
    dimensions: doc.vector.length,
    encoding: "int8",
    scale,
    vector: bytesToBase64(new Uint8Array(quantized.buffer)),
  };
  return `${JSON.stringify(data, null, 2)}\n`;
}

export function parseEmbedding(text: string): EmbeddingDocument {
  const data = JSON.parse(text) as Record<string, unknown>;
  if (data.format !== EMBEDDING_FORMAT || data.version !== 1 || data.encoding !== "int8") {
    throw new Error("Unknown embedding format.");
  }
  const { model, text_sha: textSha, generated, dimensions, scale, vector } = data;
  if (
    typeof model !== "string" ||
    typeof textSha !== "string" ||
    typeof vector !== "string" ||
    typeof scale !== "number" ||
    typeof dimensions !== "number"
  ) {
    throw new Error("Incomplete embedding.");
  }
  const bytes = base64ToBytes(vector);
  if (bytes.length !== dimensions) throw new Error("Inconsistent embedding size.");
  const quantized = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.length);
  return {
    model,
    textSha,
    generated: typeof generated === "string" ? generated : "",
    vector: Float32Array.from(quantized, (q) => q * scale),
  };
}

export function embeddingStatus(
  doc: EmbeddingDocument | undefined,
  textSha: string,
  model: string,
): EmbeddingStatus {
  if (!doc) return "missing";
  return doc.model === model && doc.textSha === textSha ? "current" : "stale";
}

export interface EmbeddingEntry {
  node: WikiNode;
  text: string;
  textSha: string;
  status: EmbeddingStatus;
  /** Vector recorded by the same model, even if stale (usable for searching). */
  vector?: Float32Array;
}

/**
 * Pages indexed for search by meaning: categories, knowledge and sources. A flashcard
 * repeats its knowledge item: indexing it would duplicate results.
 */
export function isEmbeddable(node: Pick<WikiNode, "virtual" | "type">): boolean {
  return !node.virtual && node.type !== "flashcard";
}

/** Embedding state of each indexable page for a model. */
export async function embeddingEntries(
  view: WikiView,
  model: string,
  nodes: Iterable<WikiNode> = view.tree.nodes.values(),
): Promise<EmbeddingEntry[]> {
  const out: EmbeddingEntry[] = [];
  for (const node of nodes) {
    if (!isEmbeddable(node)) continue;
    const text = embeddingText(await view.readText(node.indexPath));
    const textSha = await embeddingTextSha(text);
    let doc: EmbeddingDocument | undefined;
    let unreadable = false;
    if (node.embedding) {
      try {
        doc = parseEmbedding(await view.readText(node.embedding.path));
      } catch {
        unreadable = true;
      }
    }
    const entry: EmbeddingEntry = {
      node,
      text,
      textSha,
      status: unreadable ? "stale" : embeddingStatus(doc, textSha, model),
    };
    if (doc && doc.model === model) entry.vector = doc.vector;
    out.push(entry);
  }
  return out;
}

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || a.length === 0) return Number.NaN;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

export interface SimilarityHit {
  id: string;
  score: number;
}

/** The items closest to the query, from most to least similar. */
export function rankBySimilarity(
  query: ArrayLike<number>,
  items: Iterable<{ id: string; vector: ArrayLike<number> }>,
  limit = 20,
): SimilarityHit[] {
  const hits: SimilarityHit[] = [];
  for (const item of items) {
    const score = cosineSimilarity(query, item.vector);
    if (Number.isFinite(score)) hits.push({ id: item.id, score });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
