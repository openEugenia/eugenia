/**
 * `.notes/index.json` of the public repository: tree, titles, types, short descriptions and
 * list of published discussions (§6.4).
 */
import type { WikiConfig } from "./config.ts";
import type { DiscussionMeta } from "./discussion.ts";
import type { PageMeta, WikiTree } from "./tree.ts";
import type { DiscussionKind, PageType, RepoFile, SourceKind, Visibility } from "./types.ts";

export const INDEX_FORMAT = "eugenia-index";
/**
 * Version 3: private sources may be listed, with their bibliographic record only. Version 4:
 * sources carry the category they are filed in (common hierarchy).
 */
export const INDEX_VERSION = 4;

export interface IndexNode {
  id: string;
  /** Folder of the page. */
  path: string;
  type: PageType;
  title: string;
  /** `private` only for a private source, published as its bibliographic record (§6.2). */
  visibility: Visibility;
  parent: string | null;
  order?: number;
  tags?: string[];
  created?: string;
  updated?: string;
  description?: string;
  extracted_from?: string;
  /** Source: kind, authors, URL, publication date. */
  kind?: SourceKind;
  authors?: string[];
  url?: string;
  published?: string;
  /** Source: published category it is filed in. */
  category?: string;
  /** Knowledge: cited published sources, and whether at least one source is given. */
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
  /** All published files, with their blob SHA (permanent client-side cache). */
  files: RepoFile[];
  nodes: IndexNode[];
  /** Published discussions (quizzes are never published). */
  discussionList: IndexDiscussion[];
}

export function isWikiIndex(value: unknown): value is WikiIndex {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.format === INDEX_FORMAT && Array.isArray(v.files) && Array.isArray(v.nodes);
}

/** Page metadata rebuilt from `index.json`, indexed by `index.md` path. */
export function metasFromIndex(index: WikiIndex): Map<string, PageMeta> {
  const metas = new Map<string, PageMeta>();
  for (const node of index.nodes) {
    const meta: PageMeta = {
      id: node.id,
      type: node.type,
      title: node.title,
      visibility: node.visibility === "private" ? "private" : "public",
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
    if (node.category) meta.category = node.category;
    if (node.refs) meta.refs = node.refs;
    if (node.sourced) meta.sourced = true;
    metas.set(node.path === "" ? "index.md" : `${node.path}/index.md`, meta);
  }
  return metas;
}

/** Discussion metadata rebuilt from `index.json`, indexed by path. */
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
  /** Published pages and their public fields (short description, published cited sources). */
  nodes: Iterable<{
    id: string;
    description?: string;
    refs?: string[];
    sourced?: boolean;
    extracted_from?: string;
    category?: string;
  }>;
  discussions?: Iterable<{ path: string; meta: DiscussionMeta }>;
  now?: Date;
}): WikiIndex {
  const { tree } = input;
  const nodes: IndexNode[] = [];
  for (const entry of input.nodes) {
    const node = tree.nodes.get(entry.id);
    // Only public pages, and private sources as their bibliographic record.
    if (!node || node.virtual || (!node.isPublic && node.type !== "source")) continue;
    const parent = node.parentId ? tree.nodes.get(node.parentId) : undefined;
    const out: IndexNode = {
      id: node.id,
      path: node.path,
      type: node.type,
      title: node.title,
      visibility: node.isPublic ? "public" : "private",
      parent: parent?.id ?? null,
    };
    // A private source only shows its bibliographic record: no tags, dates or description.
    if (node.isPublic) {
      if (node.order !== undefined) out.order = node.order;
      if (node.tags.length > 0) out.tags = node.tags;
      if (node.created) out.created = node.created;
      if (node.updated) out.updated = node.updated;
    }
    if (entry.description) out.description = entry.description;
    if (entry.extracted_from) out.extracted_from = entry.extracted_from;
    if (node.type === "source") {
      if (node.sourceKind) out.kind = node.sourceKind;
      if (node.authors.length > 0) out.authors = node.authors;
      if (node.url) out.url = node.url;
      if (node.published) out.published = node.published;
      if (entry.category) out.category = entry.category;
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
