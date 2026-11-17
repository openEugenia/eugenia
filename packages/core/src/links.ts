/** Liens entre nœuds (§5.8) : résolution, réécriture lors d'un déplacement, rétroliens. */
import { rewriteDestinations, scanLinks, unlinkWhere } from "./markdown.ts";
import {
  dirname,
  extname,
  isUnder,
  joinPath,
  normalizePath,
  rebase,
  relativePath,
} from "./paths.ts";
import { nodeForPath, type WikiNode, type WikiTree } from "./tree.ts";

export interface ResolvedLink {
  /** Chemin cible, relatif à la racine du dépôt. */
  path: string;
  /** Ancre éventuelle (`#section`). */
  hash: string;
  /** Le lien se termine par `/` (lien vers un dossier). */
  trailingSlash: boolean;
}

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

export function isExternalUrl(url: string): boolean {
  return SCHEME_RE.test(url) || url.startsWith("//");
}

/** Résout un lien relatif écrit dans `fromFile`. Renvoie `null` pour les liens externes. */
export function resolveLinkTarget(fromFile: string, url: string): ResolvedLink | null {
  const trimmed = url.trim();
  if (
    trimmed === "" ||
    isExternalUrl(trimmed) ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("/")
  ) {
    return null;
  }
  const hashAt = trimmed.indexOf("#");
  let pathPart = hashAt >= 0 ? trimmed.slice(0, hashAt) : trimmed;
  const hash = hashAt >= 0 ? trimmed.slice(hashAt) : "";
  const queryAt = pathPart.indexOf("?");
  if (queryAt >= 0) pathPart = pathPart.slice(0, queryAt);
  let decoded = pathPart;
  try {
    decoded = decodeURI(pathPart);
  } catch {
    // destination mal encodée : on la garde telle quelle
  }
  const target = normalizePath(joinPath(dirname(fromFile), decoded));
  if (target.startsWith("..")) return null;
  return { path: target, hash, trailingSlash: decoded.endsWith("/") };
}

/** Encode les caractères qui posent problème dans une destination Markdown. */
export function encodeLinkPath(path: string): string {
  return path.replace(/[ ()%]/g, (c) => encodeURIComponent(c));
}

/** Lien relatif de `fromFile` vers la page `node` (vers son `index.md`). */
export function linkToNode(fromFile: string, node: Pick<WikiNode, "indexPath">): string {
  return encodeLinkPath(relativePath(dirname(fromFile), node.indexPath));
}

/** Lien Markdown complet vers une page. */
export function markdownLinkToNode(
  fromFile: string,
  node: Pick<WikiNode, "indexPath" | "title">,
  label?: string,
): string {
  const text = (label ?? node.title).replace(/([[\]\\])/g, "\\$1");
  return `[${text}](${linkToNode(fromFile, node)})`;
}

/**
 * Réécrit les liens d'un fichier déplacé de `oldFile` vers `newFile`, dont les cibles
 * ont pu être déplacées selon `mapPath` (ancien chemin → nouveau chemin).
 */
export function rewriteLinksForMove(
  content: string,
  oldFile: string,
  newFile: string,
  mapPath: (oldPath: string) => string | undefined,
): string {
  return rewriteDestinations(content, (link) => {
    const resolved = resolveLinkTarget(oldFile, link.url);
    if (!resolved) return undefined;
    const mapped = mapPath(resolved.path);
    if (mapped === undefined && oldFile === newFile) return undefined;
    const target = mapped ?? resolved.path;
    let rel = relativePath(dirname(newFile), target);
    if (resolved.trailingSlash && !rel.endsWith("/")) rel += "/";
    const next = encodeLinkPath(rel) + resolved.hash;
    // Même cible qu'avant : on garde l'écriture d'origine.
    const before = resolveLinkTarget(newFile, link.url);
    if (before && before.path === target && before.hash === resolved.hash) return undefined;
    return next;
  });
}

/** Fonction de correspondance pour le déplacement d'un dossier entier. */
export function directoryMapper(
  oldDir: string,
  newDir: string,
): (path: string) => string | undefined {
  return (path) => (isUnder(oldDir, path) ? rebase(path, oldDir, newDir) : undefined);
}

/** Remplace par du texte simple les liens dont la cible vérifie `shouldUnlink` (§6.2 règle 6). */
export function unlinkTargets(
  content: string,
  filePath: string,
  shouldUnlink: (targetPath: string) => boolean,
): string {
  return unlinkWhere(content, (link) => {
    const resolved = resolveLinkTarget(filePath, link.url);
    return resolved ? shouldUnlink(resolved.path) : false;
  });
}

/** Liens internes (relatifs) d'un document. */
export function internalLinks(content: string, filePath: string): ResolvedLink[] {
  const out: ResolvedLink[] = [];
  for (const link of scanLinks(content).links) {
    const resolved = resolveLinkTarget(filePath, link.url);
    if (resolved) out.push(resolved);
  }
  return out;
}

/** Page ciblée par un lien résolu, si c'en est une. */
export function linkedNode(tree: WikiTree, target: ResolvedLink): WikiNode | undefined {
  const node = nodeForPath(tree, target.path);
  if (node) return node;
  // Lien vers un dossier sans extension (ex. `../lilith`).
  if (extname(target.path) === "") return tree.byPath.get(target.path);
  return undefined;
}

/**
 * Rétroliens : pour chaque page, les pages qui pointent vers elle.
 * `contents` associe le chemin d'un `index.md` à son contenu.
 */
export function buildBacklinks(
  tree: WikiTree,
  contents: ReadonlyMap<string, string>,
): Map<string, string[]> {
  const backlinks = new Map<string, string[]>();
  for (const node of tree.nodes.values()) {
    const content = contents.get(node.indexPath);
    if (content === undefined) continue;
    const seen = new Set<string>();
    for (const target of internalLinks(content, node.indexPath)) {
      const linked = linkedNode(tree, target);
      if (!linked || linked.id === node.id || seen.has(linked.id)) continue;
      seen.add(linked.id);
      const list = backlinks.get(linked.id) ?? [];
      list.push(node.id);
      backlinks.set(linked.id, list);
    }
  }
  return backlinks;
}
