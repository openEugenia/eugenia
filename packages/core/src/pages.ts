/**
 * Page documents (`index.md`): categories, atomic knowledge, flashcards and library
 * sources (§5.3, §5.4, §5.7).
 */
import {
  asNumber,
  asString,
  asStringArray,
  parseDocument,
  serializeDocument,
} from "./frontmatter.ts";
import { boldParts, firstParagraph, markdownToText, truncate } from "./markdown.ts";
import type { PageMeta } from "./tree.ts";
import { parseSourceKind, type SourceKind, type SourceRef, type Visibility } from "./types.ts";

export interface PageFields {
  id: string;
  type: string;
  title: string;
  visibility?: Visibility;
  created?: string;
  updated?: string;
  tags?: string[];
  order?: number;
  /** Knowledge: cited sources. */
  sources?: SourceRef[];
  /** Knowledge: source or discussion it was extracted from. */
  extracted_from?: string;
  /** Source: kind (book, article, website…). */
  kind?: SourceKind;
  /** Source: authors. */
  authors?: string[];
  /** Source: URL. */
  url?: string;
  /** Source: publication date or year (free text). */
  published?: string;
  /** Source: attached personal file (PDF…), relative to the page folder, never published. */
  file?: string;
  /** Source: wiki category it is filed in (identifier), in the common hierarchy. */
  category?: string;
}

export interface PageDocument {
  fields: PageFields;
  /** Unrecognized frontmatter keys, kept as is. */
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
  "kind",
  "authors",
  "url",
  "published",
  "file",
  "category",
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
      const ref = asString(o.ref)?.trim();
      const locator = asString(o.locator)?.trim() ?? asNumber(o.locator)?.toString();
      const description = asString(o.description);
      const url = asString(o.url);
      if (ref) source.ref = ref;
      if (locator) source.locator = locator;
      if (description) source.description = description;
      if (url) source.url = url;
      if (ref || description || url) out.push(source);
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
  const kind = parseSourceKind(d.kind);
  if (kind) fields.kind = kind;
  const authors = asStringArray(d.authors);
  if (authors.length > 0) fields.authors = authors;
  else if (asString(d.authors)) fields.authors = [asString(d.authors)!];
  const url = asString(d.url);
  if (url) fields.url = url;
  const published = asString(d.published) ?? asNumber(d.published)?.toString();
  if (published) fields.published = published;
  const file = asString(d.file);
  if (file) fields.file = file;
  const category = asString(d.category)?.trim();
  if (category) fields.category = category;
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(d)) if (!PAGE_KEYS.has(key)) extra[key] = value;
  const doc: PageDocument = { fields, extra, body: parsed.body };
  if (parsed.error) doc.error = parsed.error;
  else if (!parsed.hasFrontmatter) doc.error = "No YAML frontmatter.";
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
  data.kind = f.kind;
  data.authors = f.authors;
  data.url = f.url;
  data.published = f.published;
  data.file = f.file;
  data.category = f.category;
  data.extracted_from = f.extracted_from;
  data.sources = f.sources?.map(serializeSourceRef);
  return serializeDocument(data, doc.body);
}

function serializeSourceRef(s: SourceRef): Record<string, string> {
  const o: Record<string, string> = {};
  if (s.ref) o.ref = s.ref;
  if (s.locator) o.locator = s.locator;
  if (s.description) o.description = s.description;
  if (s.url) o.url = s.url;
  return o;
}

/** Label of a free reference (without a library source). */
export function sourceRefLabel(s: SourceRef): string {
  return s.description || s.url || s.ref || "";
}

// ---------------------------------------------------------------------------
// Flashcards: "Question" and "Expected answer" sections
// ---------------------------------------------------------------------------

/**
 * Body of a flashcard. The tested knowledge is the parent page; format-v1 flashcards also
 * carried the statement ("Knowledge" section), read into `knowledge`.
 */
export interface FlashcardContent {
  question: string;
  answer: string;
  /** Statement (format v1, or standalone flashcard). */
  knowledge?: string;
  /** Text before the first recognized section. */
  preamble?: string;
  /** Unrecognized sections, with their heading. */
  others?: string;
}

export const FLASHCARD_HEADINGS = {
  knowledge: "Knowledge",
  question: "Question",
  answer: "Expected answer",
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

/** Recognized headings, normalized. The French ones are read for wikis written in French. */
const HEADING_ALIASES: Record<string, keyof typeof FLASHCARD_HEADINGS> = {
  knowledge: "knowledge",
  "atomic knowledge": "knowledge",
  statement: "knowledge",
  question: "question",
  "expected answer": "answer",
  answer: "answer",
  connaissance: "knowledge",
  "connaissance atomique": "knowledge",
  enonce: "knowledge",
  "reponse attendue": "answer",
  reponse: "answer",
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
    question: join(sections.question),
    answer: join(sections.answer),
  };
  const knowledge = join(sections.knowledge);
  if (knowledge) content.knowledge = knowledge;
  const pre = join(preamble);
  if (pre) content.preamble = pre;
  const other = join(others);
  if (other) content.others = other;
  return content;
}

export function serializeFlashcardBody(content: FlashcardContent): string {
  const parts: string[] = [];
  if (content.preamble?.trim()) parts.push(content.preamble.trim());
  if (content.knowledge?.trim()) {
    parts.push(`## ${FLASHCARD_HEADINGS.knowledge}\n${content.knowledge.trim()}`);
  }
  parts.push(`## ${FLASHCARD_HEADINGS.question}\n${content.question.trim()}`);
  parts.push(`## ${FLASHCARD_HEADINGS.answer}\n${content.answer.trim()}`);
  if (content.others?.trim()) parts.push(content.others.trim());
  return parts.join("\n\n") + "\n";
}

/** Title of a flashcard, taken from its question. */
export function flashcardTitle(question: string, max = 80): string {
  const text = markdownToText(question).replace(/\s+/g, " ").trim();
  return truncate(text, max) || "Flashcard";
}

// ---------------------------------------------------------------------------
// Atomic knowledge: the statement is the page body
// ---------------------------------------------------------------------------

export interface KnowledgeContent {
  /** Self-contained statement; the bold part is the learning target. */
  statement: string;
  /** Free sections following the statement (`## Notes`…), with their heading. */
  notes?: string;
}

/** Body of a knowledge item: the statement, then optional free sections. */
export function parseKnowledgeBody(body: string): KnowledgeContent {
  const lines = body.split(/\r?\n/);
  let inFence = false;
  let at = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i]!)) inFence = !inFence;
    if (!inFence && /^##\s+\S/.test(lines[i]!)) {
      at = i;
      break;
    }
  }
  const statement = lines.slice(0, at).join("\n").trim();
  const notes = lines.slice(at).join("\n").trim();
  return notes ? { statement, notes } : { statement };
}

export function serializeKnowledgeBody(content: KnowledgeContent): string {
  const parts = [content.statement.trim()];
  if (content.notes?.trim()) parts.push(content.notes.trim());
  return parts.join("\n\n") + "\n";
}

/** Statement of a knowledge item (without its notes). */
export function knowledgeStatement(body: string): string {
  return parseKnowledgeBody(body).statement;
}

/** Learning targets: bold parts of the statement. */
export function learningTargets(knowledge: string): string[] {
  return boldParts(knowledge);
}

export const DESCRIPTION_LENGTH = 220;

/**
 * Short description of a page: statement of a knowledge item, question of a flashcard,
 * first paragraph otherwise.
 */
export function shortDescription(doc: Pick<PageDocument, "fields" | "body">): string | undefined {
  let text: string;
  if (doc.fields.type === "flashcard") {
    const card = parseFlashcardBody(doc.body);
    text = markdownToText(card.question || card.knowledge || "");
  } else if (doc.fields.type === "knowledge") {
    text = markdownToText(knowledgeStatement(doc.body));
  } else {
    text = firstParagraph(doc.body);
  }
  const short = truncate(text, DESCRIPTION_LENGTH);
  return short === "" ? undefined : short;
}

/** Tree metadata extracted from an `index.md`. */
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
  // Source fields (read whatever the type: the space decides).
  if (f.kind) meta.kind = f.kind;
  if (f.authors) meta.authors = f.authors;
  if (f.url) meta.url = f.url;
  if (f.published) meta.published = f.published;
  if (f.file) meta.file = f.file;
  if (f.category) meta.category = f.category;
  const refs = (f.sources ?? []).map((s) => s.ref).filter((r): r is string => Boolean(r));
  if (refs.length > 0) meta.refs = [...new Set(refs)];
  if ((f.sources ?? []).length > 0) meta.sourced = true;
  const description = shortDescription(doc);
  if (description) meta.description = description;
  if (doc.error) meta.error = doc.error;
  return meta;
}
