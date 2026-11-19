/**
 * `.notes/index.json` du dépôt public : arbre, titres, types, descriptions courtes et liste
 * des discussions publiées (§6.4).
 */
import type { WikiConfig } from "./config.ts";
import type { DiscussionMeta } from "./discussion.ts";
import type { PageMeta, WikiTree } from "./tree.ts";
import type { DiscussionKind, PageType, RepoFile, SourceKind } from "./types.ts";

export const INDEX_FORMAT = "eugenia-index";
export const INDEX_VERSION = 2;

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
  extracted_from?: string;
  /** Source : nature, auteurs, adresse, date de publication. */
  kind?: SourceKind;
  authors?: string[];
  url?: string;
  published?: string;
  /** Connaissance : sources publiées citées, et présence d'au moins une source. */
  refs?: string[];
  sourced?: boolean;
}

export interface IndexDiscussion {
  path: string;
  id: string;
  kind: DiscussionKind;
  title: string;
  about?: string;
  scope_node?: string;
  created?: string;
  updated?: string;
  messages: number;
  preview?: string;
}

export interface WikiIndex {
  format: typeof INDEX_FORMAT;
  version: number;
  generated: string;
  title: string;
  root: string;
  library: string;
  discussions: string;
  rootId: string;
  /** Tous les fichiers publiés, avec le SHA de leur blob (cache permanent côté client). */
  files: RepoFile[];
  nodes: IndexNode[];
  /** Discussions publiées (hors quiz, jamais publiés). */
  discussionList: IndexDiscussion[];
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
    if (node.extracted_from) meta.extracted_from = node.extracted_from;
    if (node.kind) meta.kind = node.kind;
    if (node.authors) meta.authors = node.authors;
    if (node.url) meta.url = node.url;
    if (node.published) meta.published = node.published;
    if (node.refs) meta.refs = node.refs;
    if (node.sourced) meta.sourced = true;
    metas.set(node.path === "" ? "index.md" : `${node.path}/index.md`, meta);
  }
  return metas;
}

/** Métadonnées des discussions reconstituées depuis `index.json`, indexées par chemin. */
export function discussionsFromIndex(index: WikiIndex): Map<string, DiscussionMeta> {
  const out = new Map<string, DiscussionMeta>();
  for (const d of index.discussionList ?? []) {
    const meta: DiscussionMeta = {
      id: d.id,
      kind: d.kind,
      title: d.title,
      messages: d.messages,
      visibility: "public",
    };
    if (d.about) meta.about = d.about;
    if (d.scope_node) meta.scope_node = d.scope_node;
    if (d.created) meta.created = d.created;
    if (d.updated) meta.updated = d.updated;
    if (d.preview) meta.preview = d.preview;
    out.set(d.path, meta);
  }
  return out;
}

export function buildIndex(input: {
  config: WikiConfig;
  tree: WikiTree;
  files: RepoFile[];
  /** Pages publiées et leurs champs publics (description courte, sources citées publiées). */
  nodes: Iterable<{
    id: string;
    description?: string;
    refs?: string[];
    sourced?: boolean;
    extracted_from?: string;
  }>;
  discussions?: Iterable<{ path: string; meta: DiscussionMeta }>;
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
      parent: parent?.id ?? null,
    };
    if (node.order !== undefined) out.order = node.order;
    if (node.tags.length > 0) out.tags = node.tags;
    if (node.created) out.created = node.created;
    if (node.updated) out.updated = node.updated;
    if (entry.description) out.description = entry.description;
    if (entry.extracted_from) out.extracted_from = entry.extracted_from;
    if (node.type === "source") {
      if (node.sourceKind) out.kind = node.sourceKind;
      if (node.authors.length > 0) out.authors = node.authors;
      if (node.url) out.url = node.url;
      if (node.published) out.published = node.published;
    }
    if (node.type === "knowledge") {
      if (entry.refs?.length) out.refs = entry.refs;
      if (entry.sourced) out.sourced = true;
    }
    nodes.push(out);
  }
  const discussionList: IndexDiscussion[] = [];
  for (const { path, meta } of input.discussions ?? []) {
    const d: IndexDiscussion = {
      path,
      id: meta.id,
      kind: meta.kind,
      title: meta.title,
      messages: meta.messages,
    };
    if (meta.about) d.about = meta.about;
    if (meta.scope_node) d.scope_node = meta.scope_node;
    if (meta.created) d.created = meta.created;
    if (meta.updated) d.updated = meta.updated;
    if (meta.preview) d.preview = meta.preview;
    discussionList.push(d);
  }
  discussionList.sort((a, b) => b.path.localeCompare(a.path));
  return {
    format: INDEX_FORMAT,
    version: INDEX_VERSION,
    generated: (input.now ?? new Date()).toISOString(),
    title: input.config.title,
    root: input.config.root,
    library: input.config.library,
    discussions: input.config.discussions,
    rootId: tree.rootId,
    files: [...input.files].sort((a, b) => a.path.localeCompare(b.path)),
    nodes,
    discussionList,
  };
}
