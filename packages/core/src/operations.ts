/**
 * Editing operations (§9.3). Each operation returns the list of files to write, copy or
 * delete; the caller groups them into one commit.
 */
import type { WikiConfig } from "./config.ts";
import { parseDiscussion, type DiscussionDocument, serializeDiscussion } from "./discussion.ts";
import { directoryMapper, encodeLinkPath, rewriteLinksForMove, unlinkTargets } from "./links.ts";
import {
  flashcardTitle,
  parsePage,
  serializeFlashcardBody,
  serializePage,
  type PageDocument,
} from "./pages.ts";
import { basename, dirname, extname, isUnder, joinPath, rebase } from "./paths.ts";
import { folderNameFor } from "./slug.ts";
import { isoTimestamp } from "./time.ts";
import {
  descendants,
  directoryEntries,
  getNode,
  isAncestorOf,
  isContentPath,
  placementProblem,
  type WikiNode,
  type WikiTree,
} from "./tree.ts";
import type {
  DiscussionKind,
  FileChange,
  PageType,
  RepoFile,
  SourceKind,
  SourceRef,
  Visibility,
} from "./types.ts";
import { ulid } from "./ulid.ts";
import { defaultVisibilityFor } from "./visibility.ts";

/** Working view of a wiki: tree, files and content reading. */
export interface WikiView {
  config: WikiConfig;
  tree: WikiTree;
  files: ReadonlyMap<string, RepoFile>;
  readText(path: string): Promise<string>;
}

export class OperationError extends Error {
  override name = "OperationError";
}

export function isMarkdownPath(path: string): boolean {
  return extname(path) === ".md";
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export interface NewPage {
  /** Folder of the parent. */
  parentPath: string;
  /** Is the parent public (with all its ancestors)? */
  parentIsPublic: boolean;
  title: string;
  type?: PageType;
  body?: string;
  visibility?: Visibility;
  /** Do not write a visibility: the page inherits its parent's. */
  inheritVisibility?: boolean;
  tags?: string[];
  order?: number;
  sources?: SourceRef[];
  extracted_from?: string;
  /** Source: kind, authors, URL, publication date, personal file. */
  kind?: SourceKind;
  authors?: string[];
  url?: string;
  published?: string;
  file?: string;
  id?: string;
  now?: Date;
}

export interface CreatedPage {
  id: string;
  path: string;
  indexPath: string;
  change: FileChange;
}

/**
 * Creates a page. `extraPaths` lists the paths already reserved by other operations of the
 * same batch, to avoid folder name collisions.
 */
export function createPage(
  view: Pick<WikiView, "config" | "files">,
  page: NewPage,
  extraPaths: Iterable<string> = [],
): CreatedPage {
  const title = page.title.trim();
  if (title === "") throw new OperationError("The title cannot be empty.");
  const taken = directoryEntries([...view.files.keys(), ...extraPaths], page.parentPath);
  const name = folderNameFor(title, taken, view.config.folder_name_max_length);
  const path = joinPath(page.parentPath, name);
  const now = isoTimestamp(page.now);
  const doc: PageDocument = {
    fields: {
      id: page.id ?? ulid(page.now?.getTime()),
      type: page.type ?? "category",
      title,
      visibility:
        page.visibility ??
        defaultVisibilityFor({ isPublic: page.parentIsPublic }, view.config.default_visibility),
      created: now,
      updated: now,
    },
    extra: {},
    body: page.body ?? "",
  };
  if (page.tags?.length) doc.fields.tags = page.tags;
  if (page.order !== undefined) doc.fields.order = page.order;
  if (page.sources?.length) doc.fields.sources = page.sources;
  if (page.extracted_from) doc.fields.extracted_from = page.extracted_from;
  if (page.kind) doc.fields.kind = page.kind;
  if (page.authors?.length) doc.fields.authors = page.authors;
  if (page.url) doc.fields.url = page.url;
  if (page.published) doc.fields.published = page.published;
  if (page.file) doc.fields.file = page.file;
  if (doc.fields.visibility === "public" && !page.parentIsPublic) doc.fields.visibility = "private";
  if (page.inheritVisibility && page.visibility === undefined) delete doc.fields.visibility;
  const indexPath = joinPath(path, "index.md");
  return {
    id: doc.fields.id,
    path,
    indexPath,
    change: { op: "write", path: indexPath, content: serializePage(doc) },
  };
}

/** Flashcard of a knowledge item: title taken from the question. */
export function createFlashcard(
  view: Pick<WikiView, "config" | "files">,
  knowledge: Pick<WikiNode, "path" | "isPublic">,
  card: { question: string; answer: string; id?: string; now?: Date },
  extraPaths: Iterable<string> = [],
): CreatedPage {
  const page: NewPage = {
    parentPath: knowledge.path,
    parentIsPublic: knowledge.isPublic,
    title: flashcardTitle(card.question),
    type: "flashcard",
    // A flashcard extends its knowledge item: it follows its visibility.
    inheritVisibility: true,
    body: serializeFlashcardBody({ question: card.question, answer: card.answer }),
  };
  if (card.id) page.id = card.id;
  if (card.now) page.now = card.now;
  return createPage(view, page, extraPaths);
}

/** Document of a virtual page (folder without `index.md`), created on the first edit. */
function materialize(node: WikiNode, now: Date): PageDocument {
  return {
    fields: {
      id: ulid(now.getTime()),
      type: node.type,
      title: node.title,
      created: isoTimestamp(now),
      updated: isoTimestamp(now),
    },
    extra: {},
    body: "",
  };
}

async function readPage(view: WikiView, node: WikiNode, now: Date): Promise<PageDocument> {
  if (node.virtual || !view.files.has(node.indexPath)) return materialize(node, now);
  return parsePage(await view.readText(node.indexPath));
}

// ---------------------------------------------------------------------------
// Update and rename
// ---------------------------------------------------------------------------

export interface PagePatch {
  title?: string;
  type?: PageType;
  body?: string;
  tags?: string[];
  order?: number | null;
  sources?: SourceRef[];
  visibility?: Visibility | null;
  extracted_from?: string | null;
  kind?: SourceKind | null;
  authors?: string[];
  url?: string | null;
  published?: string | null;
  file?: string | null;
}

/**
 * Updates a page. If the title changes, the folder is renamed (§5.2) and incoming links
 * are rewritten in the same batch of changes.
 */
export async function updatePage(
  view: WikiView,
  nodeId: string,
  patch: PagePatch,
  now: Date = new Date(),
): Promise<FileChange[]> {
  const node = getNode(view.tree, nodeId);
  const doc = await readPage(view, node, now);
  const f = doc.fields;
  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (title === "") throw new OperationError("The title cannot be empty.");
    f.title = title;
  }
  if (patch.type !== undefined) f.type = patch.type;
  if (patch.body !== undefined) doc.body = patch.body;
  if (patch.tags !== undefined) {
    if (patch.tags.length > 0) f.tags = patch.tags;
    else delete f.tags;
  }
  if (patch.order !== undefined) {
    if (patch.order === null) delete f.order;
    else f.order = patch.order;
  }
  if (patch.sources !== undefined) {
    if (patch.sources.length > 0) f.sources = patch.sources;
    else delete f.sources;
  }
  if (patch.visibility !== undefined) {
    if (patch.visibility === null) delete f.visibility;
    else f.visibility = patch.visibility;
  }
  if (patch.extracted_from !== undefined) {
    if (patch.extracted_from === null) delete f.extracted_from;
    else f.extracted_from = patch.extracted_from;
  }
  if (patch.kind !== undefined) {
    if (patch.kind === null) delete f.kind;
    else f.kind = patch.kind;
  }
  if (patch.authors !== undefined) {
    if (patch.authors.length > 0) f.authors = patch.authors;
    else delete f.authors;
  }
  for (const key of ["url", "published", "file"] as const) {
    const value = patch[key];
    if (value === undefined) continue;
    if (value === null || value.trim() === "") delete f[key];
    else f[key] = value.trim();
  }
  f.updated = isoTimestamp(now);
  const content = serializePage(doc);

  if (patch.title !== undefined && node.parentId !== null) {
    const parentPath = dirname(node.path);
    const taken = directoryEntries(view.files.keys(), parentPath);
    taken.delete(node.name);
    const name = folderNameFor(f.title, taken, view.config.folder_name_max_length, node.name);
    if (name !== node.name) {
      return relocate(view, node, parentPath, name, new Map([[node.indexPath, content]]));
    }
  }
  return [{ op: "write", path: node.indexPath, content }];
}

/**
 * Moves (or renames) the folder of a page and its whole branch, then rewrites the links:
 * those from the branch to the outside and those from the outside to the branch.
 */
async function relocate(
  view: WikiView,
  node: WikiNode,
  newParentPath: string,
  newName: string,
  overrides: ReadonlyMap<string, string> = new Map(),
  transform?: (path: string, content: string) => string,
): Promise<FileChange[]> {
  const oldDir = node.path;
  const newDir = joinPath(newParentPath, newName);
  if (newDir === oldDir) {
    return [...overrides].map(([path, content]) => ({ op: "write" as const, path, content }));
  }
  const mapPath = directoryMapper(oldDir, newDir);
  const changes: FileChange[] = [];
  const read = async (path: string): Promise<string> => overrides.get(path) ?? view.readText(path);

  for (const [path, file] of view.files) {
    if (!isUnder(oldDir, path)) continue;
    const newPath = rebase(path, oldDir, newDir);
    if (isMarkdownPath(path)) {
      let content = rewriteLinksForMove(await read(path), path, newPath, mapPath);
      if (transform) content = transform(path, content);
      changes.push({ op: "write", path: newPath, content });
    } else {
      changes.push({ op: "copy", path: newPath, from: path, sha: file.sha });
    }
    changes.push({ op: "delete", path });
  }
  for (const [path] of overrides) {
    if (!view.files.has(path) && isUnder(oldDir, path)) {
      changes.push({
        op: "write",
        path: rebase(path, oldDir, newDir),
        content: overrides.get(path)!,
      });
    }
  }

  // Incoming links from the rest of the repository (wiki, library, discussions).
  const needles = [node.name, encodeLinkPath(node.name)];
  for (const [path] of view.files) {
    if (isUnder(oldDir, path) || !isMarkdownPath(path) || !isContentPath(view.config, path))
      continue;
    const content = await read(path);
    const next = needles.some((n) => content.includes(n))
      ? rewriteLinksForMove(content, path, path, mapPath)
      : content;
    if (next !== content || overrides.has(path)) changes.push({ op: "write", path, content: next });
  }
  return changes;
}

// ---------------------------------------------------------------------------
// Move and delete
// ---------------------------------------------------------------------------

/**
 * Moves a page under a new parent. The folder name is kept if it is free. Under a private
 * parent, the public nodes of the branch become private (rule 3); the interface warns the
 * user beforehand.
 */
export async function moveNode(
  view: WikiView,
  nodeId: string,
  newParentId: string,
): Promise<FileChange[]> {
  const tree = view.tree;
  const node = getNode(tree, nodeId);
  const parent = getNode(tree, newParentId);
  if (node.parentId === null) throw new OperationError("The root cannot be moved.");
  if (parent.id === node.id || isAncestorOf(tree, node.id, parent.id)) {
    throw new OperationError("A page cannot be moved into its own branch.");
  }
  if (node.parentId === parent.id) return [];
  const problem = placementProblem(tree, node, parent.id);
  if (problem) throw new OperationError(problem);
  const taken = directoryEntries(view.files.keys(), parent.path);
  const name = folderNameFor(node.title, taken, view.config.folder_name_max_length, node.name);
  const transform = parent.isPublic
    ? undefined
    : (path: string, content: string): string => privatizeIfPage(path, content);
  return relocate(view, node, parent.path, name, new Map(), transform);
}

/** Makes private an `index.md` that declares itself public. */
function privatizeIfPage(path: string, content: string): string {
  if (basename(path) !== "index.md") return content;
  const doc = parsePage(content);
  if (doc.fields.visibility !== "public") return content;
  doc.fields.visibility = "private";
  return serializePage(doc);
}

export interface DeleteOptions {
  /** Explicit deletion of the whole branch (required if the page has children). */
  recursive?: boolean;
}

/**
 * Deletes a page (and its branch); incoming links become plain text. Knowledge items that
 * cited a deleted source keep a free reference (its title).
 */
export async function deleteNode(
  view: WikiView,
  nodeId: string,
  options: DeleteOptions = {},
): Promise<FileChange[]> {
  const node = getNode(view.tree, nodeId);
  if (node.parentId === null) throw new OperationError("The root cannot be deleted.");
  if (node.childIds.length > 0 && !options.recursive) {
    throw new OperationError(
      `"${node.title}" contains ${descendants(view.tree, nodeId).length} page(s): confirm the recursive deletion.`,
    );
  }
  const changes: FileChange[] = [];
  for (const [path] of view.files) {
    if (isUnder(node.path, path)) changes.push({ op: "delete", path });
  }
  const removed = new Map([node, ...descendants(view.tree, nodeId)].map((n) => [n.id, n] as const));
  const citing = new Set(
    [...view.tree.nodes.values()]
      .filter((n) => !removed.has(n.id) && n.refs.some((r) => removed.has(r)))
      .map((n) => n.indexPath),
  );
  const needles = [node.name, encodeLinkPath(node.name)];
  for (const [path] of view.files) {
    if (isUnder(node.path, path) || !isMarkdownPath(path) || !isContentPath(view.config, path))
      continue;
    const content = await view.readText(path);
    let next = needles.some((n) => content.includes(n))
      ? unlinkTargets(content, path, (target) => isUnder(node.path, target))
      : content;
    if (citing.has(path)) next = detachSourceRefs(next, removed);
    if (next !== content) changes.push({ op: "write", path, content: next });
  }
  return changes;
}

/** Replaces references to deleted sources with a free reference. */
function detachSourceRefs(content: string, removed: ReadonlyMap<string, WikiNode>): string {
  const doc = parsePage(content);
  if (!doc.fields.sources) return content;
  doc.fields.sources = doc.fields.sources.map((s) => {
    const source = s.ref ? removed.get(s.ref) : undefined;
    if (!source) return s;
    const out: SourceRef = { description: s.description || source.title };
    if (s.locator) out.locator = s.locator;
    const url = s.url ?? source.url;
    if (url) out.url = url;
    return out;
  });
  return serializePage(doc);
}

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

/** Writes the visibilities computed by `makePublicAssignments` / `makePrivateAssignments`. */
export async function applyVisibility(
  view: WikiView,
  assignments: ReadonlyMap<string, Visibility | undefined>,
  now: Date = new Date(),
): Promise<FileChange[]> {
  const changes: FileChange[] = [];
  for (const [id, visibility] of assignments) {
    const node = getNode(view.tree, id);
    const doc = await readPage(view, node, now);
    if (visibility === undefined) delete doc.fields.visibility;
    else doc.fields.visibility = visibility;
    doc.fields.updated = isoTimestamp(now);
    changes.push({ op: "write", path: node.indexPath, content: serializePage(doc) });
  }
  return changes;
}

// ---------------------------------------------------------------------------
// Discussions
// ---------------------------------------------------------------------------

export function newDiscussionDocument(input: {
  title: string;
  about?: string;
  kind?: DiscussionKind;
  scopeNode?: string;
  now?: Date;
}): DiscussionDocument {
  const now = isoTimestamp(input.now);
  const doc: DiscussionDocument = {
    fields: {
      id: ulid(input.now?.getTime()),
      title: input.title,
      // A discussion is personal: private by default (§5.6, §6.2).
      visibility: "private",
      created: now,
      updated: now,
    },
    extra: {},
    messages: [],
  };
  if (input.kind && input.kind !== "discussion") doc.fields.kind = input.kind;
  if (input.about) doc.fields.about = input.about;
  if (input.scopeNode) doc.fields.scope_node = input.scopeNode;
  return doc;
}

export async function readDiscussion(view: WikiView, path: string): Promise<DiscussionDocument> {
  return parseDiscussion(await view.readText(path));
}

export function writeDiscussion(path: string, doc: DiscussionDocument): FileChange {
  return { op: "write", path, content: serializeDiscussion(doc) };
}

/** Names of the existing files of a folder (to avoid name collisions). */
export function reservedEntries(view: Pick<WikiView, "files">, dir: string): Set<string> {
  const out = new Set<string>();
  for (const path of view.files.keys()) if (dirname(path) === dir) out.add(basename(path));
  return out;
}

/** Names of the existing files of the discussions folder. */
export function discussionEntries(view: Pick<WikiView, "files" | "config">): Set<string> {
  return reservedEntries(view, view.config.discussions);
}
