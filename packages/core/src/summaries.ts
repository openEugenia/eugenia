/** Sub-wiki descriptions: format, source fingerprints and staleness detection (§5.5, §11.2). */
import { asString, parseDocument, serializeDocument } from "./frontmatter.ts";
import { joinPath } from "./paths.ts";
import { shaMatches, shortSha } from "./sha.ts";
import { isoTimestamp } from "./time.ts";
import {
  descendants,
  isCategory,
  PUBLIC_SUMMARY_FILE,
  SUMMARY_FILE,
  type WikiNode,
  type WikiTree,
} from "./tree.ts";
import type { SummaryScope } from "./types.ts";

export interface SummaryFields {
  id: string;
  scope: SummaryScope;
  model?: string;
  generated?: string;
  locked: boolean;
  /** Source fingerprint: node id → (short) SHA of the blob used. */
  sources: Record<string, string>;
}

export interface SummaryDocument {
  fields: SummaryFields;
  extra: Record<string, unknown>;
  body: string;
  error?: string;
}

const KNOWN_KEYS = new Set(["id", "type", "scope", "model", "generated", "locked", "sources"]);

export function summaryFileName(scope: SummaryScope): string {
  return scope === "public" ? PUBLIC_SUMMARY_FILE : SUMMARY_FILE;
}

export function summaryPath(node: Pick<WikiNode, "path">, scope: SummaryScope): string {
  return joinPath(node.path, summaryFileName(scope));
}

export function parseSummary(text: string): SummaryDocument {
  const parsed = parseDocument(text);
  const d = parsed.data;
  const sources: Record<string, string> = {};
  if (d.sources && typeof d.sources === "object" && !Array.isArray(d.sources)) {
    for (const [key, value] of Object.entries(d.sources as Record<string, unknown>)) {
      const sha = asString(value);
      if (sha) sources[key] = sha;
    }
  }
  const fields: SummaryFields = {
    id: asString(d.id)?.trim() ?? "",
    scope: d.scope === "public" ? "public" : "private",
    locked: d.locked === true,
    sources,
  };
  const model = asString(d.model);
  if (model) fields.model = model;
  const generated = asString(d.generated);
  if (generated) fields.generated = generated;
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(d)) if (!KNOWN_KEYS.has(key)) extra[key] = value;
  if (d.type !== undefined && d.type !== "summary") extra.type = d.type;
  const doc: SummaryDocument = { fields, extra, body: parsed.body };
  if (parsed.error) doc.error = parsed.error;
  return doc;
}

export function serializeSummary(doc: SummaryDocument): string {
  const f = doc.fields;
  const data: Record<string, unknown> = {
    ...doc.extra,
    id: f.id,
    type: "summary",
    scope: f.scope,
    model: f.model,
    generated: f.generated,
    locked: f.locked,
    sources: f.sources,
  };
  return serializeDocument(data, doc.body);
}

/** Children taken into account for a scope: all of them (private), or only public ones. */
export function scopedChildren(tree: WikiTree, node: WikiNode, scope: SummaryScope): WikiNode[] {
  const out: WikiNode[] = [];
  for (const id of node.childIds) {
    const child = tree.nodes.get(id);
    if (child && (scope === "private" || child.isPublic)) out.push(child);
  }
  return out;
}

/**
 * A wiki category needs a description if it has children (public ones, for the public
 * scope). A knowledge item and its flashcards do not form a sub-wiki.
 */
export function needsSummary(tree: WikiTree, node: WikiNode, scope: SummaryScope): boolean {
  if (!isCategory(node)) return false;
  if (scope === "public" && !node.isPublic) return false;
  return scopedChildren(tree, node, scope).length > 0;
}

/**
 * Source fingerprint of a description: the content of the node itself, then for each
 * child its description (if it has children and a description) or its content.
 */
export function summarySources(
  tree: WikiTree,
  node: WikiNode,
  scope: SummaryScope,
): Map<string, string> {
  const sources = new Map<string, string>();
  if (node.sha) sources.set(node.id, node.sha);
  for (const child of scopedChildren(tree, node, scope)) {
    const summary = scope === "public" ? child.summaries.public : child.summaries.private;
    const sha =
      needsSummary(tree, child, scope) && summary ? summary.sha : (child.sha ?? summary?.sha);
    if (sha) sources.set(child.id, sha);
  }
  return sources;
}

/**
 * A private-scope description depends on the whole branch, through the children's
 * descriptions: it involves private content as soon as a descendant is private. A public
 * description only covers public nodes.
 */
export function summaryInvolvesPrivate(
  tree: WikiTree,
  node: WikiNode,
  scope: SummaryScope,
): boolean {
  if (scope === "public") return false;
  return !node.isPublic || descendants(tree, node.id).some((n) => !n.isPublic);
}

export function sourcesRecord(sources: ReadonlyMap<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, sha] of sources) out[id] = shortSha(sha);
  return out;
}

export function sameSources(
  stored: Record<string, string>,
  current: ReadonlyMap<string, string>,
): boolean {
  const keys = Object.keys(stored);
  if (keys.length !== current.size) return false;
  for (const key of keys) if (!shaMatches(stored[key], current.get(key))) return false;
  return true;
}

export type SummaryStatus = "fresh" | "stale" | "missing" | "locked" | "none";

export interface SummaryState {
  status: SummaryStatus;
  /** The direct sources changed (otherwise, the staleness comes from a descendant). */
  direct: boolean;
}

/**
 * State of the descriptions of a scope for the whole tree. A stale description makes its
 * ancestors' descriptions stale; a locked description is never offered for regeneration
 * and does not propagate its staleness.
 */
export function summaryStates(
  tree: WikiTree,
  scope: SummaryScope,
  documents: ReadonlyMap<string, SummaryDocument>,
): Map<string, SummaryState> {
  const states = new Map<string, SummaryState>();
  const visit = (node: WikiNode): SummaryState => {
    const all = node.childIds.map((id) => tree.nodes.get(id)!);
    const visited = new Map(all.map((child) => [child.id, visit(child)]));
    const childStates = scopedChildren(tree, node, scope).map((c) => visited.get(c.id)!);
    let state: SummaryState;
    if (!needsSummary(tree, node, scope)) {
      state = { status: "none", direct: false };
    } else {
      const file = scope === "public" ? node.summaries.public : node.summaries.private;
      const doc = file ? documents.get(file.path) : undefined;
      if (!file) {
        state = { status: "missing", direct: true };
      } else if (!doc) {
        state = { status: "fresh", direct: false }; // content not loaded: state unknown
      } else if (doc.fields.locked) {
        state = { status: "locked", direct: false };
      } else {
        const direct = !sameSources(doc.fields.sources, summarySources(tree, node, scope));
        const inherited = childStates.some((s) => s.status === "stale" || s.status === "missing");
        state = { status: direct || inherited ? "stale" : "fresh", direct };
      }
    }
    states.set(node.id, state);
    return state;
  };
  const root = tree.nodes.get(tree.rootId);
  if (root) visit(root);
  return states;
}

/** Nodes to (re)generate in a branch, from the deepest to the root. */
export function regenerationOrder(
  tree: WikiTree,
  states: ReadonlyMap<string, SummaryState>,
  branchId: string = tree.rootId,
): WikiNode[] {
  const out: WikiNode[] = [];
  const visit = (id: string): void => {
    const node = tree.nodes.get(id);
    if (!node) return;
    for (const childId of node.childIds) visit(childId);
    const status = states.get(id)?.status;
    if (status === "stale" || status === "missing") out.push(node);
  };
  visit(branchId);
  return out;
}

export function newSummaryDocument(input: {
  id: string;
  scope: SummaryScope;
  body: string;
  sources: ReadonlyMap<string, string>;
  model?: string;
  locked?: boolean;
  now?: Date;
}): SummaryDocument {
  const fields: SummaryFields = {
    id: input.id,
    scope: input.scope,
    generated: isoTimestamp(input.now),
    locked: input.locked ?? false,
    sources: sourcesRecord(input.sources),
  };
  if (input.model) fields.model = input.model;
  return { fields, extra: {}, body: input.body.trim() };
}
