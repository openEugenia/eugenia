/** Discussions et quiz : un fichier, une section par message (§5.6). */
import { asString, parseDocument, serializeDocument } from "./frontmatter.ts";
import { parseVisibility } from "./pages.ts";
import { joinPath } from "./paths.ts";
import { slugify, uniqueName } from "./slug.ts";
import { fileStamp, isoDay } from "./time.ts";
import { DISCUSSIONS_DIR, QUIZZES_DIR } from "./tree.ts";
import type { Visibility } from "./types.ts";

export type DiscussionRole = "user" | "eugenia";

export interface DiscussionMessage {
  role: DiscussionRole;
  /** Horodatage ISO 8601. */
  timestamp: string;
  content: string;
  /** Métadonnées portées par un commentaire HTML (`<!-- eugenia: {...} -->`). */
  meta?: Record<string, unknown>;
}

export interface DiscussionFields {
  id: string;
  title: string;
  kind?: "quiz";
  /** Nœud à l'origine de la discussion. */
  about?: string;
  /** Catégorie interrogée (quiz). */
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
  if (asString(d.kind) === "quiz") fields.kind = "quiz";
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
        // commentaire illisible : conservé dans le contenu
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

/** JSON sur une ligne, espacé comme dans la spécification : `{"card": "…", "score": 0.3}`. */
export function formatMeta(meta: Record<string, unknown>): string {
  const body = Object.entries(meta)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`)
    .join(", ");
  // `--` est interdit dans un commentaire HTML.
  return `{${body}}`.replace(/--/g, "\\u002d\\u002d");
}

/** Évaluation enregistrée dans un quiz : la trace de révision d'une flashcard. */
export interface QuizEvent {
  card: string;
  score: number;
  /** Horodatage ISO du message de retour. */
  at: string;
  /** Fichier de quiz d'origine. */
  source?: string;
  /** Auto-évaluation (mode hors ligne). */
  self?: boolean;
}

export function quizEvents(doc: DiscussionDocument, source?: string): QuizEvent[] {
  const events: QuizEvent[] = [];
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

/** Chemin d'une nouvelle discussion : `_discussions/<date>-<slug>.md`. */
export function newDiscussionPath(
  pageDir: string,
  title: string,
  existing: ReadonlySet<string>,
  date: Date = new Date(),
): string {
  const base = `${isoDay(date)}-${slugify(title, 40)}`;
  const taken = new Set([...existing].map((p) => p.replace(/\.md$/, "")));
  return joinPath(pageDir, DISCUSSIONS_DIR, `${uniqueName(base, taken)}.md`);
}

/** Chemin d'un nouveau quiz : `_quizzes/<date>-<heure>.md`. */
export function newQuizPath(
  categoryDir: string,
  existing: ReadonlySet<string>,
  date: Date = new Date(),
): string {
  const taken = new Set([...existing].map((p) => p.replace(/\.md$/, "")));
  return joinPath(categoryDir, QUIZZES_DIR, `${uniqueName(fileStamp(date), taken)}.md`);
}
