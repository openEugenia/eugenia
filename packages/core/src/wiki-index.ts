/** `.notes/index.json` du dépôt public : arbre, titres, types, descriptions courtes (§6.4). */
import type { WikiConfig } from "./config.ts";
import type { PageMeta, WikiTree } from "./tree.ts";
import type { PageType, RepoFile } from "./types.ts";

export const INDEX_FORMAT = "eugenia-index";
export const INDEX_VERSION = 1;

export interface IndexNode {
  id: string;
  /** Dossier de la page. */
  path: string;
  type: PageType;
  title: string;
  visibility: "public";
  parent: string | null;
  order?: number;
  tags?: string[];
  created?: string;
  updated?: string;
  description?: string;
}

export interface WikiIndex {
  format: typeof INDEX_FORMAT;
  version: number;
  generated: string;
  title: string;
  root: string;
  rootId: string;
  /** Tous les fichiers publiés, avec le SHA de leur blob (cache permanent côté client). */
  files: RepoFile[];
  nodes: IndexNode[];
}

export function isWikiIndex(value: unknown): value is WikiIndex {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.format === INDEX_FORMAT && Array.isArray(v.files) && Array.isArray(v.nodes);
}

/** Métadonnées de pages reconstituées depuis `index.json`, indexées par `index.md`. */
export function metasFromIndex(index: WikiIndex): Map<string, PageMeta> {
  const metas = new Map<string, PageMeta>();
  for (const node of index.nodes) {
    const meta: PageMeta = {
      id: node.id,
      type: node.type,
      title: node.title,
      visibility: "public",
    };
    if (node.order !== undefined) meta.order = node.order;
    if (node.tags) meta.tags = node.tags;
    if (node.created) meta.created = node.created;
    if (node.updated) meta.updated = node.updated;
    if (node.description) meta.description = node.description;
    metas.set(node.path === "" ? "index.md" : `${node.path}/index.md`, meta);
  }
  return metas;
}

export function buildIndex(input: {
  config: WikiConfig;
  tree: WikiTree;
  files: RepoFile[];
  /** Pages publiées et leur description courte. */
  nodes: Iterable<{ id: string; description?: string }>;
  now?: Date;
}): WikiIndex {
  const { tree } = input;
  const nodes: IndexNode[] = [];
  for (const entry of input.nodes) {
    const node = tree.nodes.get(entry.id);
    if (!node || node.virtual) continue;
    const parent = node.parentId ? tree.nodes.get(node.parentId) : undefined;
    const out: IndexNode = {
      id: node.id,
      path: node.path,
      type: node.type,
      title: node.title,
      visibility: "public",
      parent: parent && !parent.virtual ? parent.id : (parent?.id ?? null),
    };
    if (node.order !== undefined) out.order = node.order;
    if (node.tags.length > 0) out.tags = node.tags;
    if (node.created) out.created = node.created;
    if (node.updated) out.updated = node.updated;
    if (entry.description) out.description = entry.description;
    nodes.push(out);
  }
  return {
    format: INDEX_FORMAT,
    version: INDEX_VERSION,
    generated: (input.now ?? new Date()).toISOString(),
    title: input.config.title,
    root: input.config.root,
    rootId: tree.rootId,
    files: [...input.files].sort((a, b) => a.path.localeCompare(b.path)),
    nodes,
  };
}
