/** Construction de l'arbre du wiki à partir de la liste des fichiers (§5.1). */
import type { WikiConfig } from "./config.ts";
import { basename, dirname, isReservedName, isUnder, joinPath, segmentsUnder } from "./paths.ts";
import { humanize } from "./slug.ts";
import type { PageType, Problem, RepoFile, Visibility } from "./types.ts";

/** Métadonnées d'une page, lues dans son `index.md` ou dans `index.json`. */
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
  /** Description courte (premier paragraphe, ou énoncé d'une flashcard). */
  description?: string;
  /** Erreur de lecture du frontmatter. */
  error?: string;
}

export interface WikiNode {
  id: string;
  /** Dossier de la page. */
  path: string;
  /** Chemin de son `index.md`. */
  indexPath: string;
  /** Nom du dossier. */
  name: string;
  type: PageType;
  title: string;
  /** Visibilité écrite dans le frontmatter. */
  declaredVisibility?: Visibility;
  /** Visibilité effective (héritée du parent si absente). */
  visibility: Visibility;
  /** Vrai si la page et tous ses ancêtres sont publics. */
  isPublic: boolean;
  order?: number;
  tags: string[];
  created?: string;
  updated?: string;
  extractedFrom?: string;
  description?: string;
  parentId: string | null;
  childIds: string[];
  depth: number;
  /** SHA du blob de `index.md`. */
  sha?: string;
  /** Dossier sans `index.md`, ancêtre d'autres pages. */
  virtual: boolean;
  summaries: { private?: RepoFile; public?: RepoFile };
  discussions: RepoFile[];
  quizzes: RepoFile[];
  /** Embedding de la page pour la recherche sémantique (`_embedding.json`), jamais publié. */
  embedding?: RepoFile;
  /** Fichiers joints (PDF, images…), y compris dans des sous-dossiers qui ne sont pas des pages. */
  attachments: RepoFile[];
}

export interface WikiTree {
  config: WikiConfig;
  rootId: string;
  nodes: Map<string, WikiNode>;
  /** Dossier → page. */
  byPath: Map<string, WikiNode>;
  problems: Problem[];
}

export interface TreeInput {
  config: WikiConfig;
  files: Iterable<RepoFile>;
  /** Métadonnées indexées par chemin de `index.md`. */
  metas: ReadonlyMap<string, PageMeta>;
}

export const SUMMARY_FILE = "_summary.md";
export const PUBLIC_SUMMARY_FILE = "_summary.public.md";
export const DISCUSSIONS_DIR = "_discussions";
export const QUIZZES_DIR = "_quizzes";
export const EMBEDDING_FILE = "_embedding.json";

const collator = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

export function compareNodes(a: WikiNode, b: WikiNode): number {
  const oa = a.order ?? Number.POSITIVE_INFINITY;
  const ob = b.order ?? Number.POSITIVE_INFINITY;
  if (oa !== ob) return oa < ob ? -1 : 1;
  return collator.compare(a.title, b.title) || collator.compare(a.name, b.name);
}

function depthOf(path: string): number {
  return path === "" ? 0 : path.split("/").length;
}

export function buildTree(input: TreeInput): WikiTree {
  const { config } = input;
  const root = config.root;
  const problems: Problem[] = [];
  const files = [...input.files].filter((f) => isUnder(root, f.path));

  // 1. Pages : dossiers (hors noms réservés) contenant un index.md.
  const pageDirs = new Map<string, RepoFile>();
  for (const file of files) {
    if (basename(file.path) !== "index.md") continue;
    const dir = dirname(file.path);
    const segments = segmentsUnder(root, dir);
    if (!segments || segments.some(isReservedName)) continue;
    pageDirs.set(dir, file);
  }

  // 2. Dossiers à représenter : pages, leurs ancêtres et la racine.
  const dirs = new Set<string>([root]);
  for (const dir of pageDirs.keys()) {
    let d = dir;
    for (;;) {
      dirs.add(d);
      if (d === root) break;
      d = dirname(d);
    }
  }

  // 3. Nœuds, des moins profonds aux plus profonds (les parents d'abord).
  const nodes = new Map<string, WikiNode>();
  const byPath = new Map<string, WikiNode>();
  const sortedDirs = [...dirs].sort((a, b) => depthOf(a) - depthOf(b) || a.localeCompare(b));
  for (const dir of sortedDirs) {
    const indexFile = pageDirs.get(dir);
    const indexPath = joinPath(dir, "index.md");
    const meta = indexFile ? input.metas.get(indexPath) : undefined;
    const name = basename(dir);
    let id: string;
    if (!indexFile) {
      id = `virtual:${dir}`;
      if (dir !== root) {
        problems.push({
          level: "warning",
          code: "missing-index",
          message: `Le dossier « ${dir} » contient des pages mais pas de index.md.`,
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
        message: `La page « ${indexPath} » n'a pas d'identifiant (id).`,
        path: indexPath,
      });
    }
    if (nodes.has(id)) {
      problems.push({
        level: "error",
        code: "duplicate-id",
        message: `L'identifiant ${id} est utilisé par plusieurs pages (dont « ${indexPath} »).`,
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
    if (meta?.type && meta.type !== "note" && meta.type !== "flashcard") {
      problems.push({
        level: "warning",
        code: "unknown-type",
        message: `Type « ${meta.type} » inconnu pour une page : traité comme une note.`,
        path: indexPath,
      });
    }
    const rawTitle = meta?.title?.trim();
    if (indexFile && !rawTitle) {
      problems.push({
        level: "warning",
        code: "missing-title",
        message: `La page « ${indexPath} » n'a pas de titre.`,
        path: indexPath,
      });
    }
    const node: WikiNode = {
      id,
      path: dir,
      indexPath,
      name,
      type: meta?.type === "flashcard" ? "flashcard" : "note",
      title: rawTitle || (dir === root ? config.title : humanize(name)),
      visibility: "private",
      isPublic: false,
      tags: meta?.tags ?? [],
      parentId: null,
      childIds: [],
      depth: 0,
      virtual: !indexFile,
      summaries: {},
      discussions: [],
      quizzes: [],
      attachments: [],
    };
    if (meta?.visibility) node.declaredVisibility = meta.visibility;
    if (meta?.order !== undefined) node.order = meta.order;
    if (meta?.created) node.created = meta.created;
    if (meta?.updated) node.updated = meta.updated;
    if (meta?.extracted_from) node.extractedFrom = meta.extracted_from;
    if (meta?.description) node.description = meta.description;
    if (indexFile) node.sha = indexFile.sha;
    nodes.set(id, node);
    byPath.set(dir, node);
    if (dir !== root) {
      const parent = byPath.get(dirname(dir));
      if (parent) {
        node.parentId = parent.id;
        parent.childIds.push(id);
      }
    }
  }

  // 4. Fichiers rattachés : descriptions, discussions, quiz, pièces jointes.
  for (const file of files) {
    const dir = dirname(file.path);
    const base = basename(file.path);
    if (base === "index.md" && pageDirs.has(dir)) continue;
    const segments = segmentsUnder(root, file.path);
    if (!segments) continue;
    const reservedAt = segments.findIndex(isReservedName);
    if (reservedAt >= 0) {
      const owner = byPath.get(joinPath(root, ...segments.slice(0, reservedAt)));
      if (!owner) continue;
      const reserved = segments[reservedAt]!;
      const rest = segments.slice(reservedAt + 1);
      if (rest.length === 0) {
        if (reserved === SUMMARY_FILE) owner.summaries.private = file;
        else if (reserved === PUBLIC_SUMMARY_FILE) owner.summaries.public = file;
        else if (reserved === EMBEDDING_FILE) owner.embedding = file;
      } else if (rest.length === 1 && base.endsWith(".md")) {
        if (reserved === DISCUSSIONS_DIR) owner.discussions.push(file);
        else if (reserved === QUIZZES_DIR) owner.quizzes.push(file);
      }
      continue;
    }
    let d = dir;
    while (!byPath.has(d) && d !== root) d = dirname(d);
    byPath.get(d)?.attachments.push(file);
  }

  // 5. Tri des enfants, profondeur et visibilité effective (§6.2).
  const rootNode = byPath.get(root)!;
  const visit = (node: WikiNode, parent: WikiNode | undefined, depth: number): void => {
    node.depth = depth;
    node.visibility = node.declaredVisibility ?? parent?.visibility ?? config.default_visibility;
    node.isPublic = node.visibility === "public" && (parent ? parent.isPublic : true);
    if (node.declaredVisibility === "public" && parent && !parent.isPublic) {
      problems.push({
        level: "error",
        code: "public-under-private",
        message: `« ${node.title} » est public mais un de ses ancêtres est privé.`,
        path: node.indexPath,
        nodeId: node.id,
      });
    }
    node.childIds.sort((a, b) => compareNodes(nodes.get(a)!, nodes.get(b)!));
    node.discussions.sort((a, b) => b.path.localeCompare(a.path));
    node.quizzes.sort((a, b) => b.path.localeCompare(a.path));
    node.attachments.sort((a, b) => a.path.localeCompare(b.path));
    for (const childId of node.childIds) visit(nodes.get(childId)!, node, depth + 1);
  };
  visit(rootNode, undefined, 0);

  return { config, rootId: rootNode.id, nodes, byPath, problems };
}

export function getNode(tree: WikiTree, id: string): WikiNode {
  const node = tree.nodes.get(id);
  if (!node) throw new Error(`Nœud introuvable : ${id}`);
  return node;
}

export function children(tree: WikiTree, id: string): WikiNode[] {
  return (tree.nodes.get(id)?.childIds ?? []).map((c) => tree.nodes.get(c)!);
}

/** Ancêtres de la racine jusqu'au parent (exclu : le nœud lui-même). */
export function ancestors(tree: WikiTree, id: string): WikiNode[] {
  const out: WikiNode[] = [];
  let node = tree.nodes.get(id);
  while (node?.parentId) {
    node = tree.nodes.get(node.parentId);
    if (node) out.unshift(node);
  }
  return out;
}

/** Descendants en profondeur (préfixe), sans le nœud lui-même. */
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

/** Flashcards de la branche (le nœud et ses descendants). */
export function flashcardsUnder(tree: WikiTree, id: string): WikiNode[] {
  const self = tree.nodes.get(id);
  return [...(self ? [self] : []), ...descendants(tree, id)].filter((n) => n.type === "flashcard");
}

/** Page correspondant à un chemin (dossier, `index.md` ou fichier interne à la page). */
export function nodeForPath(tree: WikiTree, path: string): WikiNode | undefined {
  if (basename(path) === "index.md") return tree.byPath.get(dirname(path));
  return tree.byPath.get(path);
}

/** Noms des entrées (fichiers et dossiers) directement contenues dans `dir`. */
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

/** Fichiers de la branche (dossier de la page, sous-pages comprises). */
export function filesUnder(paths: Iterable<string>, dir: string): string[] {
  return [...paths].filter((p) => isUnder(dir, p));
}
