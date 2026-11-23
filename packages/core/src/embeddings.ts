/**
 * Page embeddings, for semantic search (§14): one `_embedding.json` file per page, next to
 * its `index.md`, in the private repository only. Publication only copies what it explicitly
 * selected: these files are never published.
 *
 * The vector is quantized to 8 bits (one scale factor per vector): four times less space than
 * 32-bit floats, for a practically identical similarity ranking.
 */
import {
  discussionEmbeddingPath,
  discussionText,
  parseDiscussion,
  type DiscussionMeta,
} from "./discussion.ts";
import { isSearchableDiscussion } from "./hierarchy.ts";
import { markdownToText } from "./markdown.ts";
import type { WikiView } from "./operations.ts";
import { parseFlashcardBody, parsePage } from "./pages.ts";
import { joinPath } from "./paths.ts";
import { base64ToBytes, bytesToBase64, gitBlobSha } from "./sha.ts";
import {
  readSourceIndex,
  sectionEmbeddingText,
  sourceIndexEmbeddingsPath,
  sourceSections,
} from "./source-index.ts";
import { isoTimestamp } from "./time.ts";
import { EMBEDDING_FILE, type WikiNode } from "./tree.ts";
import type { FileChange } from "./types.ts";

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

/** 8-bit quantization of a vector: one scale factor, components in base64. */
function quantize(vector: ArrayLike<number>): { scale: number; vector: string } {
  let max = 0;
  for (let i = 0; i < vector.length; i++) max = Math.max(max, Math.abs(vector[i]!));
  const scale = max > 0 ? max / 127 : 1;
  const quantized = new Int8Array(vector.length);
  for (let i = 0; i < vector.length; i++) {
    quantized[i] = Math.max(-127, Math.min(127, Math.round(vector[i]! / scale)));
  }
  return { scale, vector: bytesToBase64(new Uint8Array(quantized.buffer)) };
}

function dequantize(base64: string, scale: number, dimensions: number): Float32Array {
  const bytes = base64ToBytes(base64);
  if (bytes.length !== dimensions) throw new Error("Inconsistent embedding size.");
  const quantized = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.length);
  return Float32Array.from(quantized, (q) => q * scale);
}

export function serializeEmbedding(doc: EmbeddingDocument): string {
  const { scale, vector } = quantize(doc.vector);
  const data = {
    format: EMBEDDING_FORMAT,
    version: 1,
    model: doc.model,
    text_sha: doc.textSha,
    generated: doc.generated,
    dimensions: doc.vector.length,
    encoding: "int8",
    scale,
    vector,
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
  return {
    model,
    textSha,
    generated: typeof generated === "string" ? generated : "",
    vector: dequantize(vector, scale, dimensions),
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

// ---------------------------------------------------------------------------
// Embeddings of the sections of a source index (`_index/_embeddings.json`)
// ---------------------------------------------------------------------------

export const SECTION_EMBEDDINGS_FORMAT = "eugenia-embeddings";

export interface SectionEmbeddingsDocument {
  model: string;
  generated: string;
  /** Vector of each section, by position (`2.1`), with the fingerprint of its text. */
  items: Map<string, { textSha: string; vector: Float32Array }>;
}

export function serializeSectionEmbeddings(doc: SectionEmbeddingsDocument): string {
  const items = [...doc.items].map(([key, item]) => ({
    key,
    text_sha: item.textSha,
    ...quantize(item.vector),
  }));
  const data = {
    format: SECTION_EMBEDDINGS_FORMAT,
    version: 1,
    model: doc.model,
    generated: doc.generated,
    dimensions: doc.items.values().next().value?.vector.length ?? 0,
    encoding: "int8",
    items,
  };
  return `${JSON.stringify(data, null, 2)}\n`;
}

export function parseSectionEmbeddings(text: string): SectionEmbeddingsDocument {
  const data = JSON.parse(text) as Record<string, unknown>;
  if (
    data.format !== SECTION_EMBEDDINGS_FORMAT ||
    data.version !== 1 ||
    data.encoding !== "int8" ||
    typeof data.model !== "string" ||
    typeof data.dimensions !== "number" ||
    !Array.isArray(data.items)
  ) {
    throw new Error("Unknown embeddings format.");
  }
  const dimensions = data.dimensions;
  const items = new Map<string, { textSha: string; vector: Float32Array }>();
  for (const raw of data.items as Record<string, unknown>[]) {
    if (
      typeof raw.key !== "string" ||
      typeof raw.text_sha !== "string" ||
      typeof raw.scale !== "number" ||
      typeof raw.vector !== "string"
    ) {
      throw new Error("Incomplete embedding.");
    }
    items.set(raw.key, {
      textSha: raw.text_sha,
      vector: dequantize(raw.vector, raw.scale, dimensions),
    });
  }
  return {
    model: data.model,
    generated: typeof data.generated === "string" ? data.generated : "",
    items,
  };
}

// ---------------------------------------------------------------------------
// Catalog of the vectors of the common hierarchy
// ---------------------------------------------------------------------------

/** Kind of element searched by meaning: a page, a discussion, a section of a source index. */
export type VectorKind = "page" | "discussion" | "section";

export interface VectorItem {
  /**
   * Identifier of the element: page or discussion identifier, `<source id>#<position>` for a
   * section of a source index.
   */
  id: string;
  kind: VectorKind;
  title: string;
  /** The page, or the source of a section. */
  node?: WikiNode;
  /** File of a discussion. */
  discussionPath?: string;
  /** Position of a section in the index of its source. */
  sectionKey?: string;
  /** File holding the vector. */
  file: string;
  /** Text sent to the model. */
  text: string;
  textSha: string;
  status: EmbeddingStatus;
  /** Vector recorded by the same model, even if stale (usable for searching). */
  vector?: Float32Array;
  /** Public content (may be sent to a remote provider without restriction). */
  isPublic: boolean;
}

export interface VectorCatalogOptions {
  /** Pages to include (by default all the indexable pages). */
  nodes?: Iterable<WikiNode>;
  /** Discussions to include (by default all of them except quizzes). */
  discussions?: Iterable<{ path: string; meta?: Pick<DiscussionMeta, "kind"> }>;
  /** Include the sections of the source indexes (default: yes). */
  sections?: boolean;
}

async function readEmbedding(
  view: WikiView,
  path: string | undefined,
): Promise<{ doc?: EmbeddingDocument; unreadable: boolean }> {
  if (!path || !view.files.has(path)) return { unreadable: false };
  try {
    return { doc: parseEmbedding(await view.readText(path)), unreadable: false };
  } catch {
    return { unreadable: true };
  }
}

/**
 * Every element of the common hierarchy that can be searched by meaning, with the state of its
 * embedding for a model: pages (categories, knowledge, sources), discussions (except quizzes)
 * and sections of the source indexes.
 */
export async function vectorItems(
  view: WikiView,
  model: string,
  options: VectorCatalogOptions = {},
): Promise<VectorItem[]> {
  const out: VectorItem[] = [];
  const nodes = [...(options.nodes ?? view.tree.nodes.values())].filter(isEmbeddable);
  for (const entry of await embeddingEntries(view, model, nodes)) {
    const item: VectorItem = {
      id: entry.node.id,
      kind: "page",
      title: entry.node.title,
      node: entry.node,
      file: embeddingPath(entry.node),
      text: entry.text,
      textSha: entry.textSha,
      status: entry.status,
      isPublic: entry.node.isPublic,
    };
    if (entry.vector) item.vector = entry.vector;
    out.push(item);
  }

  const discussions: Iterable<{ path: string; meta?: Pick<DiscussionMeta, "kind"> }> =
    options.discussions ?? view.tree.discussions.map((file) => ({ path: file.path }));
  for (const { path, meta } of discussions) {
    if (meta && !isSearchableDiscussion(meta)) continue;
    if (!view.files.has(path)) continue;
    const doc = parseDiscussion(await view.readText(path));
    if (!doc.fields.id || !isSearchableDiscussion({ kind: doc.fields.kind ?? "discussion" })) {
      continue;
    }
    const text = discussionText(doc).slice(0, EMBEDDING_MAX_CHARS);
    const textSha = await embeddingTextSha(text);
    const file = discussionEmbeddingPath(view.config, path);
    const stored = await readEmbedding(view, view.tree.discussionEmbeddings.get(path)?.path);
    const item: VectorItem = {
      id: doc.fields.id,
      kind: "discussion",
      title: doc.fields.title || path,
      discussionPath: path,
      file,
      text,
      textSha,
      status: stored.unreadable ? "stale" : embeddingStatus(stored.doc, textSha, model),
      isPublic: doc.fields.visibility === "public",
    };
    if (stored.doc && stored.doc.model === model) item.vector = stored.doc.vector;
    out.push(item);
  }

  if (options.sections !== false) {
    for (const source of nodes) {
      if (source.type !== "source" || !source.sourceIndex?.root) continue;
      let sections;
      try {
        const index = await readSourceIndex(view, source);
        if (!index) continue;
        sections = sourceSections(source.id, index.root);
      } catch {
        continue;
      }
      let stored: SectionEmbeddingsDocument | undefined;
      if (source.sourceIndex.embeddings) {
        try {
          stored = parseSectionEmbeddings(await view.readText(source.sourceIndex.embeddings.path));
        } catch {
          stored = undefined;
        }
      }
      for (const section of sections) {
        const text = sectionEmbeddingText(source.title, section).slice(0, EMBEDDING_MAX_CHARS);
        const textSha = await embeddingTextSha(text);
        const known = stored?.model === model ? stored.items.get(section.key) : undefined;
        const item: VectorItem = {
          id: section.id,
          kind: "section",
          title: section.name,
          node: source,
          sectionKey: section.key,
          file: sourceIndexEmbeddingsPath(source),
          text,
          textSha,
          status: !known
            ? stored
              ? "stale"
              : "missing"
            : known.textSha === textSha
              ? "current"
              : "stale",
          isPublic: source.isPublic,
        };
        if (known) item.vector = known.vector;
        out.push(item);
      }
    }
  }
  return out;
}

/**
 * Files to write once new vectors are computed (by element identifier): one file per page or
 * discussion, one file per source for the sections of its index (the current vectors of its
 * other sections are kept).
 */
export function embeddingChanges(
  items: readonly VectorItem[],
  vectors: ReadonlyMap<string, ArrayLike<number>>,
  model: string,
  now?: Date,
): FileChange[] {
  const changes: FileChange[] = [];
  const sectionFiles = new Map<string, VectorItem[]>();
  for (const item of items) {
    if (item.kind === "section") {
      sectionFiles.set(item.file, [...(sectionFiles.get(item.file) ?? []), item]);
      continue;
    }
    const vector = vectors.get(item.id);
    if (!vector) continue;
    const doc = newEmbeddingDocument({
      model,
      textSha: item.textSha,
      vector,
      ...(now ? { now } : {}),
    });
    changes.push({ op: "write", path: item.file, content: serializeEmbedding(doc) });
  }
  for (const [file, group] of sectionFiles) {
    if (!group.some((item) => vectors.has(item.id))) continue;
    const doc: SectionEmbeddingsDocument = {
      model,
      generated: isoTimestamp(now),
      items: new Map(),
    };
    for (const item of group) {
      const fresh = vectors.get(item.id);
      if (fresh)
        doc.items.set(item.sectionKey!, {
          textSha: item.textSha,
          vector: Float32Array.from(fresh),
        });
      else if (item.status === "current" && item.vector) {
        doc.items.set(item.sectionKey!, { textSha: item.textSha, vector: item.vector });
      }
    }
    changes.push({ op: "write", path: file, content: serializeSectionEmbeddings(doc) });
  }
  return changes;
}

// ---------------------------------------------------------------------------
// Vector of one element
// ---------------------------------------------------------------------------

/** Stored embedding vector of an element, with its state. */
export interface ElementVector {
  model: string;
  generated: string;
  /** `current`: computed from the current text of the element; `stale` otherwise. */
  status: "current" | "stale";
  values: Float32Array;
}

/** Embedding vector of a page (`_embedding.json`), or `null` if it has none. */
export async function pageVector(view: WikiView, node: WikiNode): Promise<ElementVector | null> {
  if (!node.embedding || !view.files.has(node.embedding.path)) return null;
  const doc = parseEmbedding(await view.readText(node.embedding.path));
  const textSha = await embeddingTextSha(embeddingText(await view.readText(node.indexPath)));
  return {
    model: doc.model,
    generated: doc.generated,
    status: doc.textSha === textSha ? "current" : "stale",
    values: doc.vector,
  };
}

/** Embedding vector of a section of the index of a source, or `null` if it has none. */
export async function sectionVector(
  view: WikiView,
  source: WikiNode,
  key: string,
): Promise<ElementVector | null> {
  const file = source.sourceIndex?.embeddings;
  if (!file || !view.files.has(file.path)) return null;
  const doc = parseSectionEmbeddings(await view.readText(file.path));
  const item = doc.items.get(key);
  if (!item) return null;
  const index = await readSourceIndex(view, source);
  const section = index ? sourceSections(source.id, index.root).find((s) => s.key === key) : null;
  const textSha = section
    ? await embeddingTextSha(
        sectionEmbeddingText(source.title, section).slice(0, EMBEDDING_MAX_CHARS),
      )
    : "";
  return {
    model: doc.model,
    generated: doc.generated,
    status: item.textSha === textSha ? "current" : "stale",
    values: item.vector,
  };
}
