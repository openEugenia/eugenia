/**
 * Construction de l'arbre à partir de la liste des fichiers (§5.1). Le dépôt a trois espaces :
 * le wiki (catégories, connaissances atomiques et leurs flashcards), la bibliothèque (sources,
 * à plat) et les discussions (un fichier par discussion, question, quiz ou note rapide).
 */
import type { WikiConfig } from "./config.ts";
import { basename, dirname, isReservedName, isUnder, joinPath, segmentsUnder } from "./paths.ts";
import { humanize } from "./slug.ts";
import type { PageType, Problem, RepoFile, SourceKind, Space, Visibility } from "./types.ts";

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
  /** Description courte (premier paragraphe, énoncé d'une connaissance, question d'une flashcard). */
  description?: string;
  /** Source : nature, auteurs, adresse, date de publication, fichier personnel. */
  kind?: SourceKind;
  authors?: string[];
  url?: string;
  published?: string;
  file?: string;
  /** Connaissance : sources de la bibliothèque citées. */
  refs?: string[];
  /** Connaissance : au moins une source est indiquée (bibliothèque ou référence libre). */
  sourced?: boolean;
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
  /** Espace de la page : wiki ou bibliothèque. */
  space: Space;
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
  /** Source ou discussion d'où la connaissance a été extraite. */
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
  /** Embedding de la page pour la recherche sémantique (`_embedding.json`), jamais publié. */
  embedding?: RepoFile;
  /** Fichiers joints (PDF, images…), y compris dans des sous-dossiers qui ne sont pas des pages. */
  attachments: RepoFile[];
  /** Source : nature, auteurs, adresse, date de publication et fichier personnel. */
  sourceKind?: SourceKind;
  authors: string[];
  url?: string;
  published?: string;
  file?: string;
  /** Connaissance : identifiants des sources de la bibliothèque citées. */
  refs: string[];
  /** Connaissance : au moins une source est indiquée (sinon « à sourcer »). */
  sourced: boolean;
}

export interface WikiTree {
  config: WikiConfig;
  /** Racine du wiki. */
  rootId: string;
  /** Racine de la bibliothèque (dossier des sources, le plus souvent virtuel). */
  libraryId: string;
  nodes: Map<string, WikiNode>;
  /** Dossier → page. */
  byPath: Map<string, WikiNode>;
  /** Fichiers des discussions, du plus récent au plus ancien (nom horodaté). */
  discussions: RepoFile[];
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
export const EMBEDDING_FILE = "_embedding.json";
/** Dossiers de discussions par page du format v1, ignorés (signalés par `validate`). */
export const LEGACY_DISCUSSION_DIRS: readonly string[] = ["_discussions", "_quizzes"];

export const LIBRARY_TITLE = "Bibliothèque";

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

/** Espace d'un chemin du dépôt, ou `null` s'il n'appartient ni au wiki ni à la bibliothèque. */
export function spaceOf(config: WikiConfig, path: string): Space | null {
  if (isUnder(config.library, path)) return "library";
  if (isUnder(config.discussions, path)) return null;
  return isUnder(config.root, path) ? "wiki" : null;
}

/** Racine d'un espace. */
export function spaceRootPath(config: WikiConfig, space: Space): string {
  return space === "library" ? config.library : config.root;
}

/** Chemins dont le contenu Markdown peut contenir des liens vers des pages. */
export function isContentPath(config: WikiConfig, path: string): boolean {
  return spaceOf(config, path) !== null || isUnder(config.discussions, path);
}

/** Vrai si `path` est un fichier de discussion. */
export function isDiscussionPath(config: WikiConfig, path: string): boolean {
  return (
    dirname(path) === config.discussions && path.endsWith(".md") && !isReservedName(basename(path))
  );
}

/** Type effectif d'une page selon son espace et son frontmatter. */
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
      problem: `Type « ${declared} » dans la bibliothèque : la page est traitée comme une source.`,
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
        problem: "Une source est rangée dans le wiki : déplacez-la dans la bibliothèque.",
      };
    default:
      return {
        type: "category",
        problem: `Type « ${declared} » inconnu pour une page : traité comme une catégorie.`,
      };
  }
}

export function buildTree(input: TreeInput): WikiTree {
  const { config } = input;
  const problems: Problem[] = [];
  const all = [...input.files];
  const spaceRoots: Record<Space, string> = { wiki: config.root, library: config.library };

  // 1. Pages : dossiers (hors noms réservés) contenant un index.md, dans un des deux espaces.
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

  // 2. Dossiers à représenter : pages, leurs ancêtres et les deux racines.
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

  // 3. Nœuds, des moins profonds aux plus profonds (les parents d'abord).
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
    // La racine de la bibliothèque est un simple conteneur.
    const resolved = isSpaceRoot ? { type: "category" as const } : resolveType(space, meta?.type);
    if (resolved.problem) {
      problems.push({
        level: "warning",
        code: "unknown-type",
        message: `« ${indexPath} » : ${resolved.problem}`,
        path: indexPath,
      });
    }
    const rawTitle = meta?.title?.trim();
    if (page && !rawTitle) {
      problems.push({
        level: "warning",
        code: "missing-title",
        message: `La page « ${indexPath} » n'a pas de titre.`,
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

  // 4. Fichiers rattachés : descriptions, embeddings, pièces jointes ; discussions.
  const discussions: RepoFile[] = [];
  for (const file of all) {
    if (isDiscussionPath(config, file.path)) {
      discussions.push(file);
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
      } else if (LEGACY_DISCUSSION_DIRS.includes(reserved) && base.endsWith(".md")) {
        problems.push({
          level: "warning",
          code: "legacy-discussion",
          message: `« ${file.path} » suit l'ancien format : les discussions et quiz sont désormais rangés dans « ${config.discussions}/ ».`,
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

  // 5. Tri des enfants, profondeur, visibilité effective (§6.2) et structure.
  const visit = (node: WikiNode, parent: WikiNode | undefined, depth: number): void => {
    node.depth = depth;
    node.visibility = node.declaredVisibility ?? parent?.visibility ?? config.default_visibility;
    // La racine de la bibliothèque est un conteneur : chaque source a sa propre visibilité.
    node.isPublic =
      node.space === "library" && !parent
        ? true
        : node.visibility === "public" && (parent ? parent.isPublic : true);
    if (node.declaredVisibility === "public" && parent && !parent.isPublic) {
      problems.push({
        level: "error",
        code: "public-under-private",
        message: `« ${node.title} » est public mais un de ses ancêtres est privé.`,
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

  return {
    config,
    rootId: rootNode.id,
    libraryId: libraryNode.id,
    nodes,
    byPath,
    discussions,
    problems,
  };
}

/** Règles de structure : flashcards sous une connaissance, sources à plat. */
function structureProblems(node: WikiNode, parent: WikiNode, problems: Problem[]): void {
  const warn = (code: string, message: string): void => {
    problems.push({ level: "warning", code, message, path: node.indexPath, nodeId: node.id });
  };
  if (node.space === "library") {
    if (parent.parentId !== null) {
      warn(
        "nested-source",
        `La source « ${node.title} » est rangée dans « ${parent.title} » : la bibliothèque est une liste à plat.`,
      );
    }
    return;
  }
  if (node.type === "flashcard" && parent.type !== "knowledge") {
    warn(
      "flashcard-parent",
      `La flashcard « ${node.title} » devrait être rangée sous une connaissance atomique.`,
    );
  } else if (parent.type === "knowledge" && node.type !== "flashcard") {
    warn(
      "knowledge-child",
      `« ${node.title} » est rangé sous la connaissance « ${parent.title} », qui ne peut contenir que des flashcards.`,
    );
  } else if (parent.type === "flashcard") {
    warn("flashcard-child", `La flashcard « ${parent.title} » ne peut pas avoir de sous-page.`);
  }
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

/** Connaissances atomiques de la branche (le nœud et ses descendants). */
export function knowledgeUnder(tree: WikiTree, id: string): WikiNode[] {
  const self = tree.nodes.get(id);
  return [...(self ? [self] : []), ...descendants(tree, id)].filter((n) => n.type === "knowledge");
}

/** Catégorie du wiki (sous-wiki) : seul type qui accueille catégories et connaissances. */
export function isCategory(node: Pick<WikiNode, "space" | "type">): boolean {
  return node.space === "wiki" && node.type === "category";
}

/** Sources de la bibliothèque. */
export function librarySources(tree: WikiTree): WikiNode[] {
  return [...tree.nodes.values()].filter((n) => n.type === "source");
}

/** Connaissance d'une flashcard (son parent), ou la connaissance elle-même. */
export function knowledgeOf(tree: WikiTree, node: WikiNode): WikiNode | undefined {
  if (node.type === "knowledge") return node;
  const parent = node.parentId ? tree.nodes.get(node.parentId) : undefined;
  return node.type === "flashcard" && parent?.type === "knowledge" ? parent : undefined;
}

/** Type d'enfant accepté par un parent, ou `null` si le déplacement est interdit (§5.1). */
export function placementProblem(
  tree: WikiTree,
  node: Pick<WikiNode, "type" | "space">,
  parentId: string,
): string | null {
  const parent = tree.nodes.get(parentId);
  if (!parent) return "Destination introuvable.";
  if (node.type === "source") {
    return parent.id === tree.libraryId
      ? null
      : "Une source se range dans la bibliothèque, qui est une liste à plat.";
  }
  if (parent.space !== "wiki") return "La bibliothèque ne contient que des sources.";
  if (node.type === "flashcard") {
    return parent.type === "knowledge"
      ? null
      : "Une flashcard se range sous une connaissance atomique.";
  }
  if (parent.type !== "category") {
    return parent.type === "knowledge"
      ? "Une connaissance atomique ne contient que des flashcards."
      : "Une flashcard ne peut pas avoir de sous-page.";
  }
  return null;
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
