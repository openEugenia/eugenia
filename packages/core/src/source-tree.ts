/**
 * Index of a source (`_tree.json`, next to its `index.md`): a knowledge tree that describes the
 * whole content of the source, generated once by a large model. Eugenia then reads it at low
 * cost, even with a small model: going down from the root to the relevant sections (tree
 * search), or comparing the meaning of a question with each section (exhaustive search, with
 * the embeddings of `_tree.embeddings.json`).
 *
 * Each node has a name, a self-contained description and children. The root sums up the whole
 * source; the other nodes are its **sections**, addressed by their position (`2.1` = first
 * child of the second child of the root).
 */
import type { WikiView } from "./operations.ts";
import { parsePage } from "./pages.ts";
import { joinPath } from "./paths.ts";
import { gitBlobSha } from "./sha.ts";
import { isoTimestamp } from "./time.ts";
import { SOURCE_TREE_EMBEDDINGS_FILE, SOURCE_TREE_FILE, type WikiNode } from "./tree.ts";

export const SOURCE_TREE_FORMAT = "eugenia-source-tree";

/** Node of the knowledge tree of a source. */
export interface KnowledgeNode {
  /** Title of the concept. */
  name: string;
  /** Self-contained explanation of the concept. */
  description: string;
  children: KnowledgeNode[];
}

export interface SourceTreeDocument {
  /** Model that generated the tree. */
  model: string;
  /** Fingerprint (git blob SHA, 7 characters) of the text of the source that was indexed. */
  textSha: string;
  generated: string;
  root: KnowledgeNode;
}

/** `missing`: no index; `stale`: the text of the source changed since; `invalid`: unreadable. */
export type SourceTreeStatus = "current" | "stale" | "missing" | "invalid";

/** Separator between the identifier of a source and the position of one of its sections. */
export const SECTION_SEPARATOR = "#";

export function sourceTreePath(node: Pick<WikiNode, "path">): string {
  return joinPath(node.path, SOURCE_TREE_FILE);
}

export function sourceTreeEmbeddingsPath(node: Pick<WikiNode, "path">): string {
  return joinPath(node.path, SOURCE_TREE_EMBEDDINGS_FILE);
}

/**
 * Text of a source sent to the model to index it: its bibliographic record, then its content in
 * Markdown (headings show the plan of the source, which the tree follows).
 */
export function sourceIndexText(indexContent: string): string {
  const doc = parsePage(indexContent);
  const f = doc.fields;
  const head = [`# ${f.title}`];
  if (f.authors?.length) head.push(`Authors: ${f.authors.join(", ")}`);
  if (f.published) head.push(`Published: ${f.published}`);
  if (f.url) head.push(`URL: ${f.url}`);
  return `${head.join("\n")}\n\n${doc.body.trim()}`.trim();
}

export async function sourceIndexTextSha(text: string): Promise<string> {
  return (await gitBlobSha(text)).slice(0, 7);
}

/** Cleans a tree: trimmed texts, nodes without a name dropped (their children move up). */
export function normalizeKnowledgeTree(node: KnowledgeNode): KnowledgeNode {
  const clean = (n: KnowledgeNode): KnowledgeNode[] => {
    const children = (Array.isArray(n.children) ? n.children : []).flatMap(clean);
    const name = String(n.name ?? "")
      .replace(/\s+/g, " ")
      .trim();
    const description = String(n.description ?? "").trim();
    if (!name) return children;
    return [{ name, description, children }];
  };
  const [root] = clean(node);
  return root ?? { name: "", description: "", children: [] };
}

export function newSourceTreeDocument(input: {
  model: string;
  textSha: string;
  root: KnowledgeNode;
  now?: Date;
}): SourceTreeDocument {
  return {
    model: input.model,
    textSha: input.textSha,
    generated: isoTimestamp(input.now),
    root: normalizeKnowledgeTree(input.root),
  };
}

/** Readable JSON, one key per line: the index can be read and reviewed in a diff. */
export function serializeSourceTree(doc: SourceTreeDocument): string {
  const data = {
    format: SOURCE_TREE_FORMAT,
    version: 1,
    model: doc.model,
    text_sha: doc.textSha,
    generated: doc.generated,
    root: doc.root,
  };
  return `${JSON.stringify(data, null, 2)}\n`;
}

function readNode(value: unknown, depth: number): KnowledgeNode {
  if (depth > 64) throw new Error("Index too deep.");
  if (!value || typeof value !== "object") throw new Error("Invalid node in the index.");
  const v = value as Record<string, unknown>;
  if (typeof v.name !== "string") throw new Error("Node without a name in the index.");
  const children = v.children === undefined ? [] : v.children;
  if (!Array.isArray(children)) throw new Error("Invalid children in the index.");
  return {
    name: v.name,
    description: typeof v.description === "string" ? v.description : "",
    children: children.map((c) => readNode(c, depth + 1)),
  };
}

export function parseSourceTree(text: string): SourceTreeDocument {
  const data = JSON.parse(text) as Record<string, unknown>;
  if (data.format !== SOURCE_TREE_FORMAT || data.version !== 1) {
    throw new Error("Unknown index format.");
  }
  if (typeof data.text_sha !== "string") throw new Error("Index without a text fingerprint.");
  return {
    model: typeof data.model === "string" ? data.model : "",
    textSha: data.text_sha,
    generated: typeof data.generated === "string" ? data.generated : "",
    root: readNode(data.root, 0),
  };
}

export function sourceTreeStatus(
  doc: SourceTreeDocument | undefined,
  textSha: string,
): Exclude<SourceTreeStatus, "invalid"> {
  if (!doc) return "missing";
  return doc.textSha === textSha ? "current" : "stale";
}

/** Section of the index of a source: a node below the root. */
export interface SourceSection {
  /** Position in the tree: `2.1`. */
  key: string;
  /** Identifier of the section in the common hierarchy: `<source id>#<key>`. */
  id: string;
  name: string;
  description: string;
  /** Names of the enclosing sections, from the top. */
  path: string[];
  /** Positions of the child sections. */
  childKeys: string[];
}

export function sectionId(sourceId: string, key: string): string {
  return `${sourceId}${SECTION_SEPARATOR}${key}`;
}

/** Source and position of a section identifier, or `null` for another identifier. */
export function parseSectionId(id: string): { sourceId: string; key: string } | null {
  const i = id.indexOf(SECTION_SEPARATOR);
  if (i <= 0) return null;
  const key = id.slice(i + 1);
  return /^\d+(\.\d+)*$/.test(key) ? { sourceId: id.slice(0, i), key } : null;
}

function childKey(parent: string, index: number): string {
  return parent === "" ? String(index + 1) : `${parent}.${index + 1}`;
}

/** Node at a position (`""` = the root). */
export function findKnowledgeNode(root: KnowledgeNode, key: string): KnowledgeNode | undefined {
  if (key === "") return root;
  let node: KnowledgeNode | undefined = root;
  for (const part of key.split(".")) {
    node = node?.children[Number(part) - 1];
    if (!node) return undefined;
  }
  return node;
}

/** All the sections of an index, depth-first (pre-order). */
export function sourceSections(sourceId: string, root: KnowledgeNode): SourceSection[] {
  const out: SourceSection[] = [];
  const visit = (node: KnowledgeNode, key: string, path: string[]): void => {
    node.children.forEach((child, i) => {
      const k = childKey(key, i);
      out.push({
        key: k,
        id: sectionId(sourceId, k),
        name: child.name,
        description: child.description,
        path,
        childKeys: child.children.map((_, j) => childKey(k, j)),
      });
      visit(child, k, [...path, child.name]);
    });
  };
  visit(root, "", []);
  return out;
}

/** Number of nodes of a tree, root included. */
export function countKnowledgeNodes(root: KnowledgeNode): number {
  return 1 + root.children.reduce((n, c) => n + countKnowledgeNodes(c), 0);
}

/** Text of a section for its embedding: where it is in the source, then its description. */
export function sectionEmbeddingText(sourceTitle: string, section: SourceSection): string {
  return [[sourceTitle, ...section.path, section.name].join(" › "), section.description]
    .filter((p) => p.trim() !== "")
    .join("\n\n");
}

export interface SourceTreeState {
  node: WikiNode;
  /** Text of the source to index. */
  text: string;
  textSha: string;
  status: SourceTreeStatus;
  /** Current index, if readable. */
  doc?: SourceTreeDocument;
}

/** State of the index of a source: current, stale (the source changed), missing or unreadable. */
export async function sourceTreeState(
  view: Pick<WikiView, "readText" | "files">,
  node: WikiNode,
): Promise<SourceTreeState> {
  const text = sourceIndexText(await view.readText(node.indexPath));
  const textSha = await sourceIndexTextSha(text);
  const file = node.sourceTree;
  if (!file || !view.files.has(file.path)) return { node, text, textSha, status: "missing" };
  try {
    const doc = parseSourceTree(await view.readText(file.path));
    return { node, text, textSha, status: sourceTreeStatus(doc, textSha), doc };
  } catch {
    return { node, text, textSha, status: "invalid" };
  }
}
