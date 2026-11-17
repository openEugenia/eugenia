/** Documents des pages (`index.md`) : notes et flashcards (§5.3, §5.4, §5.7). */
import {
  asNumber,
  asString,
  asStringArray,
  parseDocument,
  serializeDocument,
} from "./frontmatter.ts";
import { boldParts, firstParagraph, markdownToText, truncate } from "./markdown.ts";
import type { PageMeta } from "./tree.ts";
import type { SourceRef, Visibility } from "./types.ts";

export interface PageFields {
  id: string;
  type: string;
  title: string;
  visibility?: Visibility;
  created?: string;
  updated?: string;
  tags?: string[];
  order?: number;
  sources?: SourceRef[];
  extracted_from?: string;
}

export interface PageDocument {
  fields: PageFields;
  /** Clés de frontmatter non reconnues, conservées telles quelles. */
  extra: Record<string, unknown>;
  body: string;
  error?: string;
}

const PAGE_KEYS = new Set([
  "id",
  "type",
  "title",
  "visibility",
  "created",
  "updated",
  "tags",
  "order",
  "sources",
  "extracted_from",
]);

export function parseVisibility(value: unknown): Visibility | undefined {
  return value === "public" || value === "private" ? value : undefined;
}

export function parseSources(value: unknown): SourceRef[] {
  if (!Array.isArray(value)) return [];
  const out: SourceRef[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      out.push(/^https?:\/\//.test(item) ? { url: item } : { description: item });
    } else if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const source: SourceRef = {};
      const description = asString(o.description);
      const url = asString(o.url);
      const file = asString(o.file);
      if (description) source.description = description;
      if (url) source.url = url;
      if (file) source.file = file;
      if (description || url || file) out.push(source);
    }
  }
  return out;
}

export function parsePage(text: string): PageDocument {
  const parsed = parseDocument(text);
  const d = parsed.data;
  const fields: PageFields = {
    id: asString(d.id)?.trim() ?? "",
    type: asString(d.type)?.trim() || "note",
    title: asString(d.title)?.trim() ?? "",
  };
  const visibility = parseVisibility(d.visibility);
  if (visibility) fields.visibility = visibility;
  const created = asString(d.created);
  if (created) fields.created = created;
  const updated = asString(d.updated);
  if (updated) fields.updated = updated;
  const tags = asStringArray(d.tags);
  if (tags.length > 0) fields.tags = tags;
  const order = asNumber(d.order);
  if (order !== undefined) fields.order = order;
  const sources = parseSources(d.sources);
  if (sources.length > 0) fields.sources = sources;
  const extractedFrom = asString(d.extracted_from);
  if (extractedFrom) fields.extracted_from = extractedFrom;
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(d)) if (!PAGE_KEYS.has(key)) extra[key] = value;
  const doc: PageDocument = { fields, extra, body: parsed.body };
  if (parsed.error) doc.error = parsed.error;
  else if (!parsed.hasFrontmatter) doc.error = "Pas de frontmatter YAML.";
  return doc;
}

export function serializePage(doc: PageDocument): string {
  const data: Record<string, unknown> = { ...doc.extra };
  const f = doc.fields;
  data.id = f.id;
  data.type = f.type;
  data.title = f.title;
  data.visibility = f.visibility;
  data.created = f.created;
  data.updated = f.updated;
  data.tags = f.tags;
  data.order = f.order;
  data.extracted_from = f.extracted_from;
  data.sources = f.sources?.map((s) => {
    const o: Record<string, string> = {};
    if (s.description) o.description = s.description;
    if (s.url) o.url = s.url;
    if (s.file) o.file = s.file;
    return o;
  });
  return serializeDocument(data, doc.body);
}

// ---------------------------------------------------------------------------
// Flashcards : sections « Connaissance », « Question », « Réponse attendue »
// ---------------------------------------------------------------------------

export interface FlashcardContent {
  /** Énoncé autonome ; la partie en gras est la cible d'apprentissage. */
  knowledge: string;
  question: string;
  answer: string;
  /** Texte avant la première section reconnue. */
  preamble?: string;
  /** Sections non reconnues, avec leur titre. */
  others?: string;
}

export const FLASHCARD_HEADINGS = {
  knowledge: "Connaissance",
  question: "Question",
  answer: "Réponse attendue",
} as const;

function normalizeHeading(heading: string): string {
  return heading
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const HEADING_ALIASES: Record<string, keyof typeof FLASHCARD_HEADINGS> = {
  connaissance: "knowledge",
  "connaissance atomique": "knowledge",
  enonce: "knowledge",
  knowledge: "knowledge",
  "atomic knowledge": "knowledge",
  question: "question",
  "reponse attendue": "answer",
  reponse: "answer",
  "expected answer": "answer",
  answer: "answer",
};

export function parseFlashcardBody(body: string): FlashcardContent {
  const lines = body.split(/\r?\n/);
  const sections: Record<"knowledge" | "question" | "answer", string[]> = {
    knowledge: [],
    question: [],
    answer: [],
  };
  const preamble: string[] = [];
  const others: string[] = [];
  let current: "knowledge" | "question" | "answer" | "other" | "preamble" = "preamble";
  let inFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const heading = inFence ? null : /^##\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      const key = HEADING_ALIASES[normalizeHeading(heading[1]!)];
      if (key && sections[key].length === 0) {
        current = key;
        continue;
      }
      current = "other";
      others.push(line);
      continue;
    }
    if (current === "preamble") preamble.push(line);
    else if (current === "other") others.push(line);
    else sections[current].push(line);
  }
  const join = (l: string[]): string => l.join("\n").trim();
  const content: FlashcardContent = {
    knowledge: join(sections.knowledge),
    question: join(sections.question),
    answer: join(sections.answer),
  };
  const pre = join(preamble);
  if (pre) content.preamble = pre;
  const other = join(others);
  if (other) content.others = other;
  // Flashcard sans sections : tout le texte est l'énoncé.
  if (!content.knowledge && !content.question && !content.answer && pre) {
    content.knowledge = pre;
    delete content.preamble;
  }
  return content;
}

export function serializeFlashcardBody(content: FlashcardContent): string {
  const parts: string[] = [];
  if (content.preamble?.trim()) parts.push(content.preamble.trim());
  parts.push(`## ${FLASHCARD_HEADINGS.knowledge}\n${content.knowledge.trim()}`);
  parts.push(`## ${FLASHCARD_HEADINGS.question}\n${content.question.trim()}`);
  parts.push(`## ${FLASHCARD_HEADINGS.answer}\n${content.answer.trim()}`);
  if (content.others?.trim()) parts.push(content.others.trim());
  return parts.join("\n\n") + "\n";
}

/** Cibles d'apprentissage : parties en gras de l'énoncé. */
export function learningTargets(knowledge: string): string[] {
  return boldParts(knowledge);
}

export const DESCRIPTION_LENGTH = 220;

/** Description courte d'une page : énoncé pour une flashcard, premier paragraphe sinon. */
export function shortDescription(doc: Pick<PageDocument, "fields" | "body">): string | undefined {
  const text =
    doc.fields.type === "flashcard"
      ? markdownToText(parseFlashcardBody(doc.body).knowledge)
      : firstParagraph(doc.body);
  const short = truncate(text, DESCRIPTION_LENGTH);
  return short === "" ? undefined : short;
}

/** Métadonnées d'arbre extraites d'un `index.md`. */
export function pageMeta(text: string): PageMeta {
  const doc = parsePage(text);
  const f = doc.fields;
  const meta: PageMeta = { type: f.type };
  if (f.id) meta.id = f.id;
  if (f.title) meta.title = f.title;
  if (f.visibility) meta.visibility = f.visibility;
  if (f.order !== undefined) meta.order = f.order;
  if (f.tags) meta.tags = f.tags;
  if (f.created) meta.created = f.created;
  if (f.updated) meta.updated = f.updated;
  if (f.extracted_from) meta.extracted_from = f.extracted_from;
  const description = shortDescription(doc);
  if (description) meta.description = description;
  if (doc.error) meta.error = doc.error;
  return meta;
}
