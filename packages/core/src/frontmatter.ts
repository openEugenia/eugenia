/** Lecture et écriture des documents Markdown avec frontmatter YAML (§5.3). */
import { Document, isCollection, parse as parseYaml } from "yaml";

export interface ParsedDocument {
  data: Record<string, unknown>;
  body: string;
  hasFrontmatter: boolean;
  /** Erreur de syntaxe YAML, le cas échéant (les données sont alors vides). */
  error?: string;
}

/** Ordre d'écriture des clés connues ; les clés inconnues sont conservées à la suite. */
export const KEY_ORDER: readonly string[] = [
  "id",
  "type",
  "kind",
  "title",
  "about",
  "scope_node",
  "visibility",
  "scope",
  "created",
  "updated",
  "tags",
  "order",
  "model",
  "generated",
  "locked",
  "extracted_from",
  "sources",
];

/** Clés écrites en style YAML « flow » (`tags: [a, b]`). */
const FLOW_KEYS = new Set(["tags"]);

const FRONTMATTER_RE = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

export function parseDocument(text: string): ParsedDocument {
  const source = text.replace(/^﻿/, "");
  const match = FRONTMATTER_RE.exec(source);
  if (!match) return { data: {}, body: source, hasFrontmatter: false };
  const body = source.slice(match[0].length).replace(/^(?:[ \t]*\r?\n)+/, "");
  let data: Record<string, unknown> = {};
  let error: string | undefined;
  try {
    const parsed: unknown = parseYaml(match[1] ?? "");
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      data = parsed as Record<string, unknown>;
    } else if (parsed !== null && parsed !== undefined) {
      error = "Le frontmatter doit être un dictionnaire YAML.";
    }
  } catch (e) {
    error = `Frontmatter YAML invalide : ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`;
  }
  return error === undefined
    ? { data, body, hasFrontmatter: true }
    : { data, body, hasFrontmatter: true, error };
}

function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as object).length === 0;
  if (typeof value === "string") return value === "";
  return false;
}

/** Ordonne les clés et retire les valeurs vides (tableaux, objets, chaînes vides, null). */
export function orderedData(
  data: Record<string, unknown>,
  order: readonly string[] = KEY_ORDER,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of order) {
    if (key in data && !isEmptyValue(data[key])) out[key] = data[key];
  }
  for (const [key, value] of Object.entries(data)) {
    if (!(key in out) && !order.includes(key) && !isEmptyValue(value)) out[key] = value;
  }
  return out;
}

export function stringifyYaml(data: Record<string, unknown>): string {
  if (Object.keys(data).length === 0) return "";
  const doc = new Document(data);
  for (const key of FLOW_KEYS) {
    const node = doc.get(key, true);
    if (isCollection(node)) node.flow = true;
  }
  return doc.toString({ lineWidth: 0, minContentWidth: 0, flowCollectionPadding: false });
}

/** Sérialise un document : frontmatter ordonné, ligne vide, corps terminé par un saut de ligne. */
export function serializeDocument(
  data: Record<string, unknown>,
  body: string,
  order: readonly string[] = KEY_ORDER,
): string {
  const yaml = stringifyYaml(orderedData(data, order));
  const cleanBody = body.replace(/^(?:[ \t]*\r?\n)+/, "").replace(/\s+$/, "");
  return `---\n${yaml}---\n` + (cleanBody ? `\n${cleanBody}\n` : "");
}

/** Lecture tolérante d'une chaîne de caractères. */
export function asString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

export function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(asString).filter((v): v is string => v !== undefined && v !== "");
  }
  const single = asString(value);
  return single ? [single] : [];
}

export function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}
