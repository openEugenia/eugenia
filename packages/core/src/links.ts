/** Links between nodes (§5.8): resolution, rewriting on a move, backlinks. */
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
  /** Target path, relative to the repository root. */
  path: string;
  /** Optional anchor (`#section`). */
  hash: string;
  /** The link ends with `/` (link to a folder). */
  trailingSlash: boolean;
}

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

export function isExternalUrl(url: string): boolean {
  return SCHEME_RE.test(url) || url.startsWith("//");
}

/** Resolves a relative link written in `fromFile`. Returns `null` for external links. */
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
    // badly encoded destination: keep it as is
  }
  const target = normalizePath(joinPath(dirname(fromFile), decoded));
  if (target.startsWith("..")) return null;
  return { path: target, hash, trailingSlash: decoded.endsWith("/") };
}

/** Encodes the characters that are problematic in a Markdown destination. */
export function encodeLinkPath(path: string): string {
  return path.replace(/[ ()%]/g, (c) => encodeURIComponent(c));
}

/** Relative link from `fromFile` to the page `node` (to its `index.md`). */
export function linkToNode(fromFile: string, node: Pick<WikiNode, "indexPath">): string {
  return encodeLinkPath(relativePath(dirname(fromFile), node.indexPath));
}

/** Full Markdown link to a page. */
export function markdownLinkToNode(
  fromFile: string,
  node: Pick<WikiNode, "indexPath" | "title">,
  label?: string,
): string {
  const text = (label ?? node.title).replace(/([[\]\\])/g, "\\$1");
  return `[${text}](${linkToNode(fromFile, node)})`;
}

/**
 * Rewrites the links of a file moved from `oldFile` to `newFile`, whose targets may have
 * moved according to `mapPath` (old path → new path).
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
    // Same target as before: keep the original spelling.
    const before = resolveLinkTarget(newFile, link.url);
    if (before && before.path === target && before.hash === resolved.hash) return undefined;
    return next;
  });
}

/** Mapping function for moving a whole folder. */
export function directoryMapper(
  oldDir: string,
  newDir: string,
): (path: string) => string | undefined {
  return (path) => (isUnder(oldDir, path) ? rebase(path, oldDir, newDir) : undefined);
}

/** Replaces with plain text the links whose target matches `shouldUnlink` (§6.2 rule 6). */
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

/** Internal (relative) links of a document. */
export function internalLinks(content: string, filePath: string): ResolvedLink[] {
  const out: ResolvedLink[] = [];
  for (const link of scanLinks(content).links) {
    const resolved = resolveLinkTarget(filePath, link.url);
    if (resolved) out.push(resolved);
  }
  return out;
}

/** Page targeted by a resolved link, if it is one. */
export function linkedNode(tree: WikiTree, target: ResolvedLink): WikiNode | undefined {
  const node = nodeForPath(tree, target.path);
  if (node) return node;
  // Link to a folder without extension (e.g. `../lilith`).
  if (extname(target.path) === "") return tree.byPath.get(target.path);
  return undefined;
}

/**
 * Backlinks: for each page, the pages that link to it.
 * `contents` maps the path of an `index.md` to its content.
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
