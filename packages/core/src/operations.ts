/**
 * Opérations d'édition (§9.3). Chaque opération renvoie la liste des fichiers à écrire,
 * copier ou supprimer ; l'appelant les regroupe dans un commit.
 */
import type { WikiConfig } from "./config.ts";
import { parseDiscussion, type DiscussionDocument, serializeDiscussion } from "./discussion.ts";
import { directoryMapper, encodeLinkPath, rewriteLinksForMove, unlinkTargets } from "./links.ts";
import { parsePage, serializePage, type PageDocument } from "./pages.ts";
import { basename, dirname, extname, isUnder, joinPath, rebase } from "./paths.ts";
import { folderNameFor } from "./slug.ts";
import { isoTimestamp } from "./time.ts";
import {
  descendants,
  directoryEntries,
  getNode,
  isAncestorOf,
  type WikiNode,
  type WikiTree,
} from "./tree.ts";
import type { FileChange, PageType, RepoFile, SourceRef, Visibility } from "./types.ts";
import { ulid } from "./ulid.ts";
import { defaultVisibilityFor } from "./visibility.ts";

/** Vue de travail d'un wiki : arbre, fichiers et lecture des contenus. */
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
// Création
// ---------------------------------------------------------------------------

export interface NewPage {
  /** Dossier du parent. */
  parentPath: string;
  /** Le parent est-il public (avec tous ses ancêtres) ? */
  parentIsPublic: boolean;
  title: string;
  type?: PageType;
  body?: string;
  visibility?: Visibility;
  tags?: string[];
  order?: number;
  sources?: SourceRef[];
  extracted_from?: string;
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
 * Crée une page. `extraPaths` liste les chemins déjà réservés par d'autres opérations
 * du même lot, pour éviter les collisions de noms de dossiers.
 */
export function createPage(
  view: Pick<WikiView, "config" | "files">,
  page: NewPage,
  extraPaths: Iterable<string> = [],
): CreatedPage {
  const title = page.title.trim();
  if (title === "") throw new OperationError("Le titre ne peut pas être vide.");
  const taken = directoryEntries([...view.files.keys(), ...extraPaths], page.parentPath);
  const name = folderNameFor(title, taken, view.config.folder_name_max_length);
  const path = joinPath(page.parentPath, name);
  const now = isoTimestamp(page.now);
  const doc: PageDocument = {
    fields: {
      id: page.id ?? ulid(page.now?.getTime()),
      type: page.type ?? "note",
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
  if (doc.fields.visibility === "public" && !page.parentIsPublic) doc.fields.visibility = "private";
  const indexPath = joinPath(path, "index.md");
  return {
    id: doc.fields.id,
    path,
    indexPath,
    change: { op: "write", path: indexPath, content: serializePage(doc) },
  };
}

/** Document d'une page virtuelle (dossier sans `index.md`), créé à la première édition. */
function materialize(node: WikiNode, now: Date): PageDocument {
  return {
    fields: {
      id: ulid(now.getTime()),
      type: "note",
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
// Modification et renommage
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
}

/**
 * Modifie une page. Si le titre change, le dossier est renommé (§5.2) et les liens
 * entrants sont réécrits dans le même lot de modifications.
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
    if (title === "") throw new OperationError("Le titre ne peut pas être vide.");
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
  f.updated = isoTimestamp(now);
  const content = serializePage(doc);

  if (patch.title !== undefined && node.id !== view.tree.rootId) {
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
 * Déplace (ou renomme) le dossier d'une page et de toute sa branche, puis réécrit
 * les liens : ceux de la branche vers l'extérieur et ceux de l'extérieur vers la branche.
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

  // Liens entrants depuis le reste du wiki.
  const needles = [node.name, encodeLinkPath(node.name)];
  for (const [path] of view.files) {
    if (isUnder(oldDir, path) || !isMarkdownPath(path) || !isUnder(view.config.root, path))
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
// Déplacement et suppression
// ---------------------------------------------------------------------------

/**
 * Déplace une page sous un nouveau parent. Le nom de dossier est conservé s'il est
 * libre. Sous un parent privé, les nœuds publics de la branche deviennent privés
 * (règle 3) ; l'interface prévient l'utilisateur avant.
 */
export async function moveNode(
  view: WikiView,
  nodeId: string,
  newParentId: string,
): Promise<FileChange[]> {
  const tree = view.tree;
  const node = getNode(tree, nodeId);
  const parent = getNode(tree, newParentId);
  if (node.id === tree.rootId) throw new OperationError("La racine ne peut pas être déplacée.");
  if (parent.id === node.id || isAncestorOf(tree, node.id, parent.id)) {
    throw new OperationError("Une page ne peut pas être déplacée dans sa propre branche.");
  }
  if (node.parentId === parent.id) return [];
  const taken = directoryEntries(view.files.keys(), parent.path);
  const name = folderNameFor(node.title, taken, view.config.folder_name_max_length, node.name);
  const transform = parent.isPublic
    ? undefined
    : (path: string, content: string): string => privatizeIfPage(path, content);
  return relocate(view, node, parent.path, name, new Map(), transform);
}

/** Rend privé un `index.md` qui se déclare public. */
function privatizeIfPage(path: string, content: string): string {
  if (basename(path) !== "index.md") return content;
  const doc = parsePage(content);
  if (doc.fields.visibility !== "public") return content;
  doc.fields.visibility = "private";
  return serializePage(doc);
}

export interface DeleteOptions {
  /** Suppression explicite de toute la branche (obligatoire si la page a des enfants). */
  recursive?: boolean;
}

/** Supprime une page (et sa branche) ; les liens entrants deviennent du texte simple. */
export async function deleteNode(
  view: WikiView,
  nodeId: string,
  options: DeleteOptions = {},
): Promise<FileChange[]> {
  const node = getNode(view.tree, nodeId);
  if (node.id === view.tree.rootId)
    throw new OperationError("La racine ne peut pas être supprimée.");
  if (node.childIds.length > 0 && !options.recursive) {
    throw new OperationError(
      `« ${node.title} » contient ${descendants(view.tree, nodeId).length} page(s) : confirmez la suppression récursive.`,
    );
  }
  const changes: FileChange[] = [];
  for (const [path] of view.files) {
    if (isUnder(node.path, path)) changes.push({ op: "delete", path });
  }
  const needles = [node.name, encodeLinkPath(node.name)];
  for (const [path] of view.files) {
    if (isUnder(node.path, path) || !isMarkdownPath(path) || !isUnder(view.config.root, path))
      continue;
    const content = await view.readText(path);
    if (!needles.some((n) => content.includes(n))) continue;
    const next = unlinkTargets(content, path, (target) => isUnder(node.path, target));
    if (next !== content) changes.push({ op: "write", path, content: next });
  }
  return changes;
}

// ---------------------------------------------------------------------------
// Visibilité
// ---------------------------------------------------------------------------

/** Écrit les visibilités calculées par `makePublicAssignments` / `makePrivateAssignments`. */
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
  kind?: "quiz";
  scopeNode?: string;
  now?: Date;
}): DiscussionDocument {
  const now = isoTimestamp(input.now);
  const doc: DiscussionDocument = {
    fields: {
      id: ulid(input.now?.getTime()),
      title: input.title,
      // Une discussion est personnelle : privée par défaut (§5.6, §6.2).
      visibility: "private",
      created: now,
      updated: now,
    },
    extra: {},
    messages: [],
  };
  if (input.kind) doc.fields.kind = input.kind;
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

/** Chemins existants d'un dossier réservé (`_discussions`, `_quizzes`) d'une page. */
export function reservedEntries(view: Pick<WikiView, "files">, dir: string): Set<string> {
  const out = new Set<string>();
  for (const path of view.files.keys()) if (dirname(path) === dir) out.add(basename(path));
  return out;
}
