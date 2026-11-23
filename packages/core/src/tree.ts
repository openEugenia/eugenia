/**
 * Builds the tree from the list of files (§5.1). The repository has three spaces: the wiki
 * (categories, atomic knowledge and its flashcards), the library (sources, flat) and the
 * discussions (one file per discussion, question, quiz or quick note).
 */
import type { WikiConfig } from "./config.ts";
import { basename, dirname, isReservedName, isUnder, joinPath, segmentsUnder } from "./paths.ts";
import { humanize } from "./slug.ts";
import type { PageType, Problem, RepoFile, SourceKind, Space, Visibility } from "./types.ts";

/** Metadata of a page, read from its `index.md` or from `index.json`. */
export interface PageMeta {
  id?: string;
  type?: string;
  title?: string;
  visibility?: Visibility;
  order?: number;
  tags?: string[];
  created?: string;
  updated?: string;
  extracted_from?: string;
  /** Short description (first paragraph, statement of a knowledge item, question of a flashcard). */
  description?: string;
  /** Source: kind, authors, URL, publication date, personal file. */
  kind?: SourceKind;
  authors?: string[];
  url?: string;
  published?: string;
  file?: string;
  /** Source: wiki category it is filed in. */
  category?: string;
  /** Knowledge: cited library sources. */
  refs?: string[];
  /** Knowledge: at least one source is given (library or free reference). */
  sourced?: boolean;
  /** Error while reading the frontmatter. */
  error?: string;
}

export interface WikiNode {
  id: string;
  /** Folder of the page. */
  path: string;
  /** Path of its `index.md`. */
  indexPath: string;
  /** Folder name. */
  name: string;
  /** Space of the page: wiki or library. */
  space: Space;
  type: PageType;
  title: string;
  /** Visibility written in the frontmatter. */
  declaredVisibility?: Visibility;
  /** Effective visibility (inherited from the parent if absent). */
  visibility: Visibility;
  /** True if the page and all its ancestors are public. */
  isPublic: boolean;
  order?: number;
  tags: string[];
  created?: string;
  updated?: string;
  /** Source or discussion the knowledge was extracted from. */
  extractedFrom?: string;
  description?: string;
  parentId: string | null;
  childIds: string[];
  depth: number;
  /** Blob SHA of `index.md`. */
  sha?: string;
  /** Folder without `index.md`, ancestor of other pages. */
  virtual: boolean;
  summaries: { private?: RepoFile; public?: RepoFile };
  /** Embedding of the page for semantic search (`_embedding.json`), never published. */
  embedding?: RepoFile;
  /**
   * Source: its index, a knowledge tree describing its content, stored like the wiki in its
   * `_index/` folder (one `index.md` per node), and the embeddings of its sections.
   */
  sourceIndex?: SourceIndexFiles;
  /** Attached files (PDF, images…), including in subfolders that are not pages. */
  attachments: RepoFile[];
  /** Source: kind, authors, URL, publication date and personal file. */
  sourceKind?: SourceKind;
  authors: string[];
  url?: string;
  published?: string;
  file?: string;
  /** Source: category declared in its frontmatter (identifier of a wiki category). */
  category?: string;
  /**
   * Source: category it is filed in, in the common hierarchy of the wiki, the library and the
   * discussions: the declared category if it exists, otherwise the root of the wiki.
   */
  filedIn?: string;
  /** Knowledge: identifiers of the cited library sources. */
  refs: string[];
  /** Knowledge: at least one source is given (otherwise "needs a source"). */
  sourced: boolean;
}

export interface WikiTree {
  config: WikiConfig;
  /** Root of the wiki. */
  rootId: string;
  /** Root of the library (the sources folder, usually virtual). */
  libraryId: string;
  nodes: Map<string, WikiNode>;
  /** Folder → page. */
  byPath: Map<string, WikiNode>;
  /** Discussion files, from newest to oldest (timestamped name). */
  discussions: RepoFile[];
  /** Embedding of each discussion (`<discussions>/_embeddings/<name>.json`), by discussion path. */
  discussionEmbeddings: Map<string, RepoFile>;
  problems: Problem[];
}

export interface TreeInput {
  config: WikiConfig;
  files: Iterable<RepoFile>;
  /** Metadata indexed by `index.md` path. */
  metas: ReadonlyMap<string, PageMeta>;
}

export const SUMMARY_FILE = "_summary.md";
export const PUBLIC_SUMMARY_FILE = "_summary.public.md";
export const EMBEDDING_FILE = "_embedding.json";
/** Folder of the index of a source: a knowledge tree describing its content (§8.6). */
export const SOURCE_INDEX_DIR = "_index";
/** Embeddings of the sections of the index of a source, in its index folder. */
export const INDEX_EMBEDDINGS_FILE = "_embeddings.json";

/** Files of the index of a source. */
export interface SourceIndexFiles {
  /** `_index/index.md`: the root, with the model and the fingerprint of the indexed text. */
  root?: RepoFile;
  /** Every page of the index (`index.md` files, root included). */
  pages: RepoFile[];
  /** `_index/_embeddings.json`, never published. */
  embeddings?: RepoFile;
}

/** True if a path belongs to the index of a source (its pages or its embeddings). */
export function isSourceIndexPath(path: string): boolean {
  return path.split("/").includes(SOURCE_INDEX_DIR);
}
/** Folder of the discussion embeddings, inside the discussions folder. */
export const DISCUSSION_EMBEDDINGS_DIR = "_embeddings";
/** Per-page discussion folders of format v1, ignored (reported by `validate`). */
export const LEGACY_DISCUSSION_DIRS: readonly string[] = ["_discussions", "_quizzes"];

export const LIBRARY_TITLE = "Library";

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

export function compareNodes(a: WikiNode, b: WikiNode): number {
  const oa = a.order ?? Number.POSITIVE_INFINITY;
  const ob = b.order ?? Number.POSITIVE_INFINITY;
  if (oa !== ob) return oa < ob ? -1 : 1;
  return collator.compare(a.title, b.title) || collator.compare(a.name, b.name);
}

function depthOf(path: string): number {
  return path === "" ? 0 : path.split("/").length;
}

/** Space of a repository path, or `null` if it belongs to neither the wiki nor the library. */
export function spaceOf(config: WikiConfig, path: string): Space | null {
  if (isUnder(config.library, path)) return "library";
  if (isUnder(config.discussions, path)) return null;
  return isUnder(config.root, path) ? "wiki" : null;
}

/** Root of a space. */
export function spaceRootPath(config: WikiConfig, space: Space): string {
  return space === "library" ? config.library : config.root;
}

/** Paths whose Markdown content may contain links to pages. */
export function isContentPath(config: WikiConfig, path: string): boolean {
  // The pages of a source index are generated: they hold no link to rewrite.
  if (isSourceIndexPath(path)) return false;
  return spaceOf(config, path) !== null || isUnder(config.discussions, path);
}

/** True if `path` is a discussion file. */
export function isDiscussionPath(config: WikiConfig, path: string): boolean {
  return (
    dirname(path) === config.discussions && path.endsWith(".md") && !isReservedName(basename(path))
  );
}

/** Effective type of a page given its space and frontmatter. */
function resolveType(
  space: Space,
  declared: string | undefined,
): { type: PageType; problem?: string } {
  if (space === "library") {
    if (declared === undefined || declared === "source" || declared === "note") {
      return { type: "source" };
    }
    return {
      type: "source",
      problem: `Type "${declared}" in the library: the page is treated as a source.`,
    };
  }
  switch (declared) {
    case "knowledge":
    case "flashcard":
      return { type: declared };
    case undefined:
    case "category":
    case "note":
      return { type: "category" };
    case "source":
      return {
        type: "category",
        problem: "A source is stored in the wiki: move it to the library.",
      };
    default:
      return {
        type: "category",
        problem: `Unknown page type "${declared}": treated as a category.`,
      };
  }
}

export function buildTree(input: TreeInput): WikiTree {
  const { config } = input;
  const problems: Problem[] = [];
  const all = [...input.files];
  const spaceRoots: Record<Space, string> = { wiki: config.root, library: config.library };

  // 1. Pages: folders (except reserved names) containing an index.md, in one of the two spaces.
  const pageDirs = new Map<string, { file: RepoFile; space: Space }>();
  for (const file of all) {
    if (basename(file.path) !== "index.md") continue;
    const dir = dirname(file.path);
    const space = spaceOf(config, dir);
    if (!space) continue;
    const segments = segmentsUnder(spaceRoots[space], dir);
    if (!segments || segments.some(isReservedName)) continue;
    pageDirs.set(dir, { file, space });
  }

  // 2. Folders to represent: pages, their ancestors and the two roots.
  const dirs = new Map<string, Space>([
    [config.root, "wiki"],
    [config.library, "library"],
  ]);
  for (const [dir, { space }] of pageDirs) {
    let d = dir;
    for (;;) {
      dirs.set(d, space);
      if (d === spaceRoots[space]) break;
      d = dirname(d);
    }
  }

  // 3. Nodes, from shallowest to deepest (parents first).
  const nodes = new Map<string, WikiNode>();
  const byPath = new Map<string, WikiNode>();
  const sortedDirs = [...dirs.keys()].sort((a, b) => depthOf(a) - depthOf(b) || a.localeCompare(b));
  for (const dir of sortedDirs) {
    const space = dirs.get(dir)!;
    const spaceRoot = spaceRoots[space];
    const isSpaceRoot = dir === spaceRoot;
    const page = pageDirs.get(dir);
    const indexPath = joinPath(dir, "index.md");
    const meta = page ? input.metas.get(indexPath) : undefined;
    const name = basename(dir);
    let id: string;
    if (!page) {
      id = `virtual:${dir}`;
      if (!isSpaceRoot) {
        problems.push({
          level: "warning",
          code: "missing-index",
          message: `The folder "${dir}" contains pages but no index.md.`,
          path: dir,
        });
      }
    } else if (meta?.id && String(meta.id).trim() !== "") {
      id = String(meta.id).trim();
    } else {
      id = `path:${dir}`;
      problems.push({
        level: "error",
        code: "missing-id",
        message: `The page "${indexPath}" has no identifier (id).`,
        path: indexPath,
      });
    }
    if (nodes.has(id)) {
      problems.push({
        level: "error",
        code: "duplicate-id",
        message: `The identifier ${id} is used by several pages (including "${indexPath}").`,
        path: indexPath,
        nodeId: id,
      });
      id = `dup:${dir}`;
    }
    if (meta?.error) {
      problems.push({
        level: "error",
        code: "invalid-frontmatter",
        message: meta.error,
        path: indexPath,
      });
    }
    // The library root is a plain container.
    const resolved = isSpaceRoot ? { type: "category" as const } : resolveType(space, meta?.type);
    if (resolved.problem) {
      problems.push({
        level: "warning",
        code: "unknown-type",
        message: `"${indexPath}": ${resolved.problem}`,
        path: indexPath,
      });
    }
    const rawTitle = meta?.title?.trim();
    if (page && !rawTitle) {
      problems.push({
        level: "warning",
        code: "missing-title",
        message: `The page "${indexPath}" has no title.`,
        path: indexPath,
      });
    }
    const fallbackTitle =
      dir === config.root ? config.title : isSpaceRoot ? LIBRARY_TITLE : humanize(name);
    const node: WikiNode = {
      id,
      path: dir,
      indexPath,
      name,
      space,
      type: resolved.type,
      title: rawTitle || fallbackTitle,
      visibility: "private",
      isPublic: false,
      tags: meta?.tags ?? [],
      parentId: null,
      childIds: [],
      depth: 0,
      virtual: !page,
      summaries: {},
      attachments: [],
      authors: meta?.authors ?? [],
      refs: meta?.refs ?? [],
      sourced: meta?.sourced ?? false,
    };
    if (meta?.visibility) node.declaredVisibility = meta.visibility;
    if (meta?.order !== undefined) node.order = meta.order;
    if (meta?.created) node.created = meta.created;
    if (meta?.updated) node.updated = meta.updated;
    if (meta?.extracted_from) node.extractedFrom = meta.extracted_from;
    if (meta?.description) node.description = meta.description;
    if (node.type === "source") {
      if (meta?.category) node.category = meta.category;
      if (meta?.kind) node.sourceKind = meta.kind;
      if (meta?.url) node.url = meta.url;
      if (meta?.published) node.published = meta.published;
      if (meta?.file) node.file = meta.file;
    }
    if (page) node.sha = page.file.sha;
    nodes.set(id, node);
    byPath.set(dir, node);
    if (!isSpaceRoot) {
      const parent = byPath.get(dirname(dir));
      if (parent) {
        node.parentId = parent.id;
        parent.childIds.push(id);
      }
    }
  }

  // 4. Related files: descriptions, embeddings, indexes, attachments; discussions.
  const discussions: RepoFile[] = [];
  const discussionEmbeddings = new Map<string, RepoFile>();
  const embeddingsDir = joinPath(config.discussions, DISCUSSION_EMBEDDINGS_DIR);
  for (const file of all) {
    if (isDiscussionPath(config, file.path)) {
      discussions.push(file);
      continue;
    }
    if (dirname(file.path) === embeddingsDir && file.path.endsWith(".json")) {
      const name = basename(file.path).slice(0, -".json".length);
      discussionEmbeddings.set(joinPath(config.discussions, `${name}.md`), file);
      continue;
    }
    const dir = dirname(file.path);
    const base = basename(file.path);
    if (base === "index.md" && pageDirs.has(dir)) continue;
    const space = spaceOf(config, file.path);
    if (!space) continue;
    const spaceRoot = spaceRoots[space];
    const segments = segmentsUnder(spaceRoot, file.path);
    if (!segments) continue;
    const reservedAt = segments.findIndex(isReservedName);
    if (reservedAt >= 0) {
      const owner = byPath.get(joinPath(spaceRoot, ...segments.slice(0, reservedAt)));
      if (!owner) continue;
      const reserved = segments[reservedAt]!;
      const rest = segments.slice(reservedAt + 1);
      if (rest.length === 0) {
        if (reserved === SUMMARY_FILE) owner.summaries.private = file;
        else if (reserved === PUBLIC_SUMMARY_FILE) owner.summaries.public = file;
        else if (reserved === EMBEDDING_FILE) owner.embedding = file;
      } else if (reserved === SOURCE_INDEX_DIR && owner.type === "source") {
        const index = (owner.sourceIndex ??= { pages: [] });
        if (rest.length === 1 && rest[0] === INDEX_EMBEDDINGS_FILE) index.embeddings = file;
        else if (rest.at(-1) === "index.md" && !rest.slice(0, -1).some(isReservedName)) {
          index.pages.push(file);
          if (rest.length === 1) index.root = file;
        }
      } else if (LEGACY_DISCUSSION_DIRS.includes(reserved) && base.endsWith(".md")) {
        problems.push({
          level: "warning",
          code: "legacy-discussion",
          message: `"${file.path}" follows the old format: discussions and quizzes are now stored in "${config.discussions}/".`,
          path: file.path,
          nodeId: owner.id,
        });
      }
      continue;
    }
    let d = dir;
    while (!byPath.has(d) && d !== spaceRoot && d !== "") d = dirname(d);
    byPath.get(d)?.attachments.push(file);
  }
  discussions.sort((a, b) => b.path.localeCompare(a.path));

  // 5. Child order, depth, effective visibility (§6.2) and structure.
  const visit = (node: WikiNode, parent: WikiNode | undefined, depth: number): void => {
    node.depth = depth;
    node.visibility = node.declaredVisibility ?? parent?.visibility ?? config.default_visibility;
    // The library root is a container: each source has its own visibility.
    node.isPublic =
      node.space === "library" && !parent
        ? true
        : node.visibility === "public" && (parent ? parent.isPublic : true);
    if (node.declaredVisibility === "public" && parent && !parent.isPublic) {
      problems.push({
        level: "error",
        code: "public-under-private",
        message: `"${node.title}" is public but one of its ancestors is private.`,
        path: node.indexPath,
        nodeId: node.id,
      });
    }
    if (parent) structureProblems(node, parent, problems);
    node.childIds.sort((a, b) => compareNodes(nodes.get(a)!, nodes.get(b)!));
    node.attachments.sort((a, b) => a.path.localeCompare(b.path));
    for (const childId of node.childIds) visit(nodes.get(childId)!, node, depth + 1);
  };
  const rootNode = byPath.get(config.root)!;
  const libraryNode = byPath.get(config.library)!;
  visit(rootNode, undefined, 0);
  visit(libraryNode, undefined, 0);

  // 6. Common hierarchy: each source is filed in a category of the wiki (the root by default).
  for (const node of nodes.values()) {
    if (node.type !== "source" || node.virtual) continue;
    const declared = node.category ? nodes.get(node.category) : undefined;
    node.filedIn = declared && isCategory(declared) ? declared.id : rootNode.id;
    if (node.category && !declared) {
      problems.push({
        level: "warning",
        code: "unknown-category",
        message: `The source "${node.title}" is filed in an unknown category (${node.category}): it is shown at the root of the wiki.`,
        path: node.indexPath,
        nodeId: node.id,
      });
    } else if (declared && !isCategory(declared)) {
      problems.push({
        level: "warning",
        code: "not-a-category",
        message: `The source "${node.title}" is filed in "${declared.title}", which is not a category of the wiki: it is shown at the root.`,
        path: node.indexPath,
        nodeId: node.id,
      });
    }
  }

  return {
    config,
    rootId: rootNode.id,
    libraryId: libraryNode.id,
    nodes,
    byPath,
    discussions,
    discussionEmbeddings,
    problems,
  };
}

/** Structure rules: flashcards under a knowledge item, flat sources. */
function structureProblems(node: WikiNode, parent: WikiNode, problems: Problem[]): void {
  const warn = (code: string, message: string): void => {
    problems.push({ level: "warning", code, message, path: node.indexPath, nodeId: node.id });
  };
  if (node.space === "library") {
    if (parent.parentId !== null) {
      warn(
        "nested-source",
        `The source "${node.title}" is stored in "${parent.title}": the library is a flat list.`,
      );
    }
    return;
  }
  if (node.type === "flashcard" && parent.type !== "knowledge") {
    warn(
      "flashcard-parent",
      `The flashcard "${node.title}" should be stored under an atomic knowledge item.`,
    );
  } else if (parent.type === "knowledge" && node.type !== "flashcard") {
    warn(
      "knowledge-child",
      `"${node.title}" is stored under the knowledge item "${parent.title}", which can only contain flashcards.`,
    );
  } else if (parent.type === "flashcard") {
    warn("flashcard-child", `The flashcard "${parent.title}" cannot have a subpage.`);
  }
}

export function getNode(tree: WikiTree, id: string): WikiNode {
  const node = tree.nodes.get(id);
  if (!node) throw new Error(`Node not found: ${id}`);
  return node;
}

export function children(tree: WikiTree, id: string): WikiNode[] {
  return (tree.nodes.get(id)?.childIds ?? []).map((c) => tree.nodes.get(c)!);
}

/** Ancestors from the root down to the parent (the node itself is excluded). */
export function ancestors(tree: WikiTree, id: string): WikiNode[] {
  const out: WikiNode[] = [];
  let node = tree.nodes.get(id);
  while (node?.parentId) {
    node = tree.nodes.get(node.parentId);
    if (node) out.unshift(node);
  }
  return out;
}

/** Descendants, depth-first (pre-order), without the node itself. */
export function descendants(tree: WikiTree, id: string): WikiNode[] {
  const out: WikiNode[] = [];
  const visit = (nodeId: string): void => {
    for (const childId of tree.nodes.get(nodeId)?.childIds ?? []) {
      out.push(tree.nodes.get(childId)!);
      visit(childId);
    }
  };
  visit(id);
  return out;
}

export function isAncestorOf(tree: WikiTree, ancestorId: string, id: string): boolean {
  return ancestors(tree, id).some((n) => n.id === ancestorId);
}

/** Flashcards of the branch (the node and its descendants). */
export function flashcardsUnder(tree: WikiTree, id: string): WikiNode[] {
  const self = tree.nodes.get(id);
  return [...(self ? [self] : []), ...descendants(tree, id)].filter((n) => n.type === "flashcard");
}

/** Atomic knowledge of the branch (the node and its descendants). */
export function knowledgeUnder(tree: WikiTree, id: string): WikiNode[] {
  const self = tree.nodes.get(id);
  return [...(self ? [self] : []), ...descendants(tree, id)].filter((n) => n.type === "knowledge");
}

/** Wiki category (sub-wiki): the only type that holds categories and knowledge. */
export function isCategory(node: Pick<WikiNode, "space" | "type">): boolean {
  return node.space === "wiki" && node.type === "category";
}

/** Library sources. */
export function librarySources(tree: WikiTree): WikiNode[] {
  return [...tree.nodes.values()].filter((n) => n.type === "source");
}

/**
 * Category a page belongs to in the common hierarchy: the category a source is filed in, the
 * parent of the other pages.
 */
export function hierarchyParentId(tree: WikiTree, node: WikiNode): string | null {
  if (node.type === "source") return node.virtual ? null : (node.filedIn ?? tree.rootId);
  return node.parentId;
}

/**
 * Ancestors in the common hierarchy, from the root of the wiki: for a source, the category it
 * is filed in and its ancestors.
 */
export function hierarchyAncestors(tree: WikiTree, node: WikiNode): WikiNode[] {
  if (node.type !== "source") return ancestors(tree, node.id);
  const category = node.filedIn ? tree.nodes.get(node.filedIn) : undefined;
  return category ? [...ancestors(tree, category.id), category] : [];
}

/** Sources filed directly in a category, by title. */
export function sourcesIn(tree: WikiTree, categoryId: string): WikiNode[] {
  return librarySources(tree)
    .filter((s) => s.filedIn === categoryId)
    .sort(compareNodes);
}

/**
 * True if a page belongs to the branch of `scopeId` in the common hierarchy (a source filed in
 * the branch counts).
 */
export function isInBranch(tree: WikiTree, scopeId: string, node: WikiNode): boolean {
  if (node.id === scopeId) return true;
  return hierarchyAncestors(tree, node).some((a) => a.id === scopeId);
}

/** Knowledge item of a flashcard (its parent), or the knowledge item itself. */
export function knowledgeOf(tree: WikiTree, node: WikiNode): WikiNode | undefined {
  if (node.type === "knowledge") return node;
  const parent = node.parentId ? tree.nodes.get(node.parentId) : undefined;
  return node.type === "flashcard" && parent?.type === "knowledge" ? parent : undefined;
}

/** Why a node cannot be placed under a parent, or `null` if the placement is allowed (§5.1). */
export function placementProblem(
  tree: WikiTree,
  node: Pick<WikiNode, "type" | "space">,
  parentId: string,
): string | null {
  const parent = tree.nodes.get(parentId);
  if (!parent) return "Destination not found.";
  if (node.type === "source") {
    return parent.id === tree.libraryId
      ? null
      : "A source belongs in the library, which is a flat list.";
  }
  if (parent.space !== "wiki") return "The library only contains sources.";
  if (node.type === "flashcard") {
    return parent.type === "knowledge"
      ? null
      : "A flashcard belongs under an atomic knowledge item.";
  }
  if (parent.type !== "category") {
    return parent.type === "knowledge"
      ? "An atomic knowledge item only contains flashcards."
      : "A flashcard cannot have a subpage.";
  }
  return null;
}

/** Page matching a path (folder, `index.md` or file inside the page). */
export function nodeForPath(tree: WikiTree, path: string): WikiNode | undefined {
  if (basename(path) === "index.md") return tree.byPath.get(dirname(path));
  return tree.byPath.get(path);
}

/** Names of the entries (files and folders) directly inside `dir`. */
export function directoryEntries(paths: Iterable<string>, dir: string): Set<string> {
  const names = new Set<string>();
  for (const path of paths) {
    if (!isUnder(dir, path) || path === dir) continue;
    const rest = dir === "" ? path : path.slice(dir.length + 1);
    const name = rest.split("/")[0];
    if (name) names.add(name);
  }
  return names;
}

/** Files of the branch (page folder, subpages included). */
export function filesUnder(paths: Iterable<string>, dir: string): string[] {
  return [...paths].filter((p) => isUnder(dir, p));
}
