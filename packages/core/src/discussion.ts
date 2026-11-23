/**
 * Discussions: free discussions, questions about the tree, quizzes and quick notes. One file
 * per discussion in the discussions folder, one section per message (§5.6).
 */
import type { WikiConfig } from "./config.ts";
import { asString, parseDocument, serializeDocument } from "./frontmatter.ts";
import { markdownToText, truncate } from "./markdown.ts";
import { parseVisibility } from "./pages.ts";
import { joinPath } from "./paths.ts";
import { slugify, uniqueName } from "./slug.ts";
import { fileStamp } from "./time.ts";
import { parseDiscussionKind, type DiscussionKind, type Visibility } from "./types.ts";

export type DiscussionRole = "user" | "eugenia";

export interface DiscussionMessage {
  role: DiscussionRole;
  /** ISO 8601 timestamp. */
  timestamp: string;
  content: string;
  /** Metadata carried by an HTML comment (`<!-- eugenia: {...} -->`). */
  meta?: Record<string, unknown>;
}

export interface DiscussionFields {
  id: string;
  title: string;
  /** Discussion kind; absent for a free discussion. */
  kind?: Exclude<DiscussionKind, "discussion">;
  /** Page the discussion started from. */
  about?: string;
  /** Scope: category being quizzed (quiz) or branch of a question. */
  scope_node?: string;
  visibility?: Visibility;
  created?: string;
  updated?: string;
}

export interface DiscussionDocument {
  fields: DiscussionFields;
  extra: Record<string, unknown>;
  messages: DiscussionMessage[];
  error?: string;
}

const HEADER_RE = /^##\s+(user|eugenia)\s+[·•|—–-]\s+(\S+)\s*$/i;
const ESCAPED_HEADER_RE = /^\\(##\s+(?:user|eugenia)\s+[·•|—–-]\s+\S+\s*)$/i;
const META_RE = /^\s*<!--\s*eugenia:\s*([\s\S]*?)\s*-->\s*$/;
const KNOWN_KEYS = new Set([
  "id",
  "type",
  "kind",
  "title",
  "about",
  "scope_node",
  "visibility",
  "created",
  "updated",
]);

export function parseDiscussion(text: string): DiscussionDocument {
  const parsed = parseDocument(text);
  const d = parsed.data;
  const fields: DiscussionFields = {
    id: asString(d.id)?.trim() ?? "",
    title: asString(d.title)?.trim() ?? "",
  };
  const kind = parseDiscussionKind(d.kind);
  if (kind !== "discussion") fields.kind = kind;
  const about = asString(d.about);
  if (about) fields.about = about;
  const scopeNode = asString(d.scope_node);
  if (scopeNode) fields.scope_node = scopeNode;
  const visibility = parseVisibility(d.visibility);
  if (visibility) fields.visibility = visibility;
  const created = asString(d.created);
  if (created) fields.created = created;
  const updated = asString(d.updated);
  if (updated) fields.updated = updated;
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(d)) if (!KNOWN_KEYS.has(key)) extra[key] = value;

  const messages: DiscussionMessage[] = [];
  let current: { role: DiscussionRole; timestamp: string; lines: string[] } | null = null;
  const flush = (): void => {
    if (!current) return;
    const lines = [...current.lines];
    while (lines.length > 0 && lines[0]!.trim() === "") lines.shift();
    let meta: Record<string, unknown> | undefined;
    const metaMatch = lines.length > 0 ? META_RE.exec(lines[0]!) : null;
    if (metaMatch) {
      try {
        const value: unknown = JSON.parse(metaMatch[1]!);
        if (value && typeof value === "object" && !Array.isArray(value)) {
          meta = value as Record<string, unknown>;
          lines.shift();
        }
      } catch {
        // unreadable comment: kept in the content
      }
    }
    const message: DiscussionMessage = {
      role: current.role,
      timestamp: current.timestamp,
      content: lines
        .map((l) => l.replace(ESCAPED_HEADER_RE, "$1"))
        .join("\n")
        .trim(),
    };
    if (meta) message.meta = meta;
    messages.push(message);
  };
  for (const line of parsed.body.split(/\r?\n/)) {
    const header = HEADER_RE.exec(line);
    if (header) {
      flush();
      current = {
        role: header[1]!.toLowerCase() as DiscussionRole,
        timestamp: header[2]!,
        lines: [],
      };
    } else if (current) {
      current.lines.push(line);
    }
  }
  flush();
  const doc: DiscussionDocument = { fields, extra, messages };
  if (parsed.error) doc.error = parsed.error;
  return doc;
}

export function serializeDiscussion(doc: DiscussionDocument): string {
  const data: Record<string, unknown> = { ...doc.extra };
  const f = doc.fields;
  data.id = f.id;
  data.type = "discussion";
  data.kind = f.kind;
  data.title = f.title;
  data.about = f.about;
  data.scope_node = f.scope_node;
  data.visibility = f.visibility;
  data.created = f.created;
  data.updated = f.updated;
  const body = doc.messages
    .map((m) => {
      const lines = [`## ${m.role} · ${m.timestamp}`];
      if (m.meta && Object.keys(m.meta).length > 0) {
        lines.push(`<!-- eugenia: ${formatMeta(m.meta)} -->`);
      }
      const content = m.content
        .split("\n")
        .map((l) => (HEADER_RE.test(l) ? `\\${l}` : l))
        .join("\n")
        .trim();
      if (content) lines.push(content);
      return lines.join("\n");
    })
    .join("\n\n");
  return serializeDocument(data, body);
}

/** Single-line JSON, spaced as in the specification: `{"card": "…", "score": 0.3}`. */
export function formatMeta(meta: Record<string, unknown>): string {
  const body = Object.entries(meta)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`)
    .join(", ");
  // `--` is not allowed in an HTML comment.
  return `{${body}}`.replace(/--/g, "\\u002d\\u002d");
}

/** Evaluation recorded in a quiz: the review trace of a flashcard. */
export interface QuizEvent {
  card: string;
  score: number;
  /** ISO timestamp of the feedback message. */
  at: string;
  /** Quiz file it comes from. */
  source?: string;
  /** Self-assessment (offline mode). */
  self?: boolean;
}

/** Evaluations of a quiz (other discussion kinds carry none). */
export function quizEvents(doc: DiscussionDocument, source?: string): QuizEvent[] {
  const events: QuizEvent[] = [];
  if (doc.fields.kind !== "quiz") return events;
  for (const message of doc.messages) {
    const meta = message.meta;
    if (message.role !== "eugenia" || !meta || meta.role !== "feedback") continue;
    const card = typeof meta.card === "string" ? meta.card : undefined;
    const score = typeof meta.score === "number" ? meta.score : Number(meta.score);
    if (!card || !Number.isFinite(score)) continue;
    const event: QuizEvent = {
      card,
      score: Math.min(1, Math.max(0, score)),
      at: message.timestamp,
    };
    if (source) event.source = source;
    if (meta.self === true) event.self = true;
    events.push(event);
  }
  return events;
}

/** Path of a new discussion: `<discussions>/<date>-<time>-<title>.md` (UTC). */
export function newDiscussionPath(
  config: Pick<WikiConfig, "discussions">,
  title: string,
  existing: ReadonlySet<string>,
  date: Date = new Date(),
): string {
  const slug = slugify(title, 40);
  const base = slug ? `${fileStamp(date)}-${slug}` : fileStamp(date);
  const taken = new Set([...existing].map((p) => p.replace(/\.md$/, "")));
  return joinPath(config.discussions, `${uniqueName(base, taken)}.md`);
}

// ---------------------------------------------------------------------------
// Metadata (list of discussions, attachment to pages)
// ---------------------------------------------------------------------------

export interface DiscussionMeta {
  id: string;
  kind: DiscussionKind;
  title: string;
  about?: string;
  scope_node?: string;
  visibility?: Visibility;
  created?: string;
  updated?: string;
  /** Number of messages. */
  messages: number;
  /** Start of the user's first message (or of the first message). */
  preview?: string;
  error?: string;
}

export const DISCUSSION_PREVIEW_LENGTH = 160;

export function discussionMeta(text: string): DiscussionMeta {
  const doc = parseDiscussion(text);
  const f = doc.fields;
  const meta: DiscussionMeta = {
    id: f.id,
    kind: f.kind ?? "discussion",
    title: f.title,
    messages: doc.messages.length,
  };
  if (f.about) meta.about = f.about;
  if (f.scope_node) meta.scope_node = f.scope_node;
  if (f.visibility) meta.visibility = f.visibility;
  if (f.created) meta.created = f.created;
  if (f.updated) meta.updated = f.updated;
  const first = doc.messages.find((m) => m.role === "user") ?? doc.messages[0];
  const preview = first ? truncate(markdownToText(first.content), DISCUSSION_PREVIEW_LENGTH) : "";
  if (preview) meta.preview = preview;
  if (doc.error) meta.error = doc.error;
  return meta;
}

/** Pages a discussion is attached to (originating page, scope). */
export function discussionNodes(meta: Pick<DiscussionMeta, "about" | "scope_node">): string[] {
  return [...new Set([meta.about, meta.scope_node].filter((id): id is string => Boolean(id)))];
}

export const DISCUSSION_KIND_LABELS: Record<DiscussionKind, string> = {
  discussion: "Discussion",
  question: "Question",
  quiz: "Quiz",
  note: "Quick note",
};
