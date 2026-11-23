/**
 * Common hierarchy of the three spaces (§5.10). The wiki gives the structure; the library and
 * the discussions are placed in it:
 *
 * - a **source** is filed in a category of the wiki (`category` field, the root by default);
 * - a **discussion** is placed under the page it was started from (`about`), otherwise under
 *   its scope (`scope_node`), otherwise at the root. A discussion started from a flashcard is
 *   placed under its knowledge item.
 *
 * The files do not move: the hierarchy is computed from identifiers, so renaming or moving a
 * category does not touch its sources or discussions. Every element of the hierarchy (category,
 * knowledge item, source and the sections of its index, discussion) can be searched together.
 */
import type { DiscussionMeta } from "./discussion.ts";
import {
  compareNodes,
  hierarchyAncestors,
  isCategory,
  librarySources,
  type WikiNode,
  type WikiTree,
} from "./tree.ts";

export interface PlacedDiscussion {
  path: string;
  meta: DiscussionMeta;
}

export interface Hierarchy {
  /** Node each discussion is placed under, by path. */
  placeOf: Map<string, string>;
  /** Discussions placed under each node, from newest to oldest. */
  discussionsAt: Map<string, PlacedDiscussion[]>;
  /** Sources filed in each category, by title. */
  sourcesAt: Map<string, WikiNode[]>;
  /** Discussions by identifier. */
  discussionById: Map<string, PlacedDiscussion>;
}

/** Node a discussion is placed under. */
export function discussionPlace(
  tree: WikiTree,
  meta: Pick<DiscussionMeta, "about" | "scope_node">,
): string {
  for (const id of [meta.about, meta.scope_node]) {
    const node = id ? tree.nodes.get(id) : undefined;
    if (!node || node.virtual) continue;
    if (node.type === "flashcard" && node.parentId) return node.parentId;
    return node.id;
  }
  return tree.rootId;
}

/**
 * Discussions that hold knowledge to search: all but quizzes, whose answers are the user's
 * attempts, right or wrong.
 */
export function isSearchableDiscussion(meta: Pick<DiscussionMeta, "kind">): boolean {
  return meta.kind !== "quiz";
}

export function buildHierarchy(tree: WikiTree, discussions: Iterable<PlacedDiscussion>): Hierarchy {
  const placeOf = new Map<string, string>();
  const discussionsAt = new Map<string, PlacedDiscussion[]>();
  const discussionById = new Map<string, PlacedDiscussion>();
  const list = [...discussions].sort((a, b) => b.path.localeCompare(a.path));
  for (const entry of list) {
    const place = discussionPlace(tree, entry.meta);
    placeOf.set(entry.path, place);
    discussionsAt.set(place, [...(discussionsAt.get(place) ?? []), entry]);
    if (entry.meta.id) discussionById.set(entry.meta.id, entry);
  }
  const sourcesAt = new Map<string, WikiNode[]>();
  for (const source of librarySources(tree)) {
    if (!source.filedIn) continue;
    sourcesAt.set(source.filedIn, [...(sourcesAt.get(source.filedIn) ?? []), source]);
  }
  for (const list of sourcesAt.values()) list.sort(compareNodes);
  return { placeOf, discussionsAt, sourcesAt, discussionById };
}

/** Ancestors of a discussion in the common hierarchy, from the root to the node it is under. */
export function discussionAncestors(
  tree: WikiTree,
  hierarchy: Hierarchy,
  path: string,
): WikiNode[] {
  const place = tree.nodes.get(hierarchy.placeOf.get(path) ?? tree.rootId);
  return place ? [...hierarchyAncestors(tree, place), place] : [];
}

/** True if a discussion is placed in the branch of `scopeId`. */
export function discussionInBranch(
  tree: WikiTree,
  hierarchy: Hierarchy,
  scopeId: string,
  path: string,
): boolean {
  return discussionAncestors(tree, hierarchy, path).some((n) => n.id === scopeId);
}

/** Number of sources filed in a branch (the category and its subcategories). */
export function sourcesInBranch(tree: WikiTree, categoryId: string): WikiNode[] {
  return librarySources(tree).filter(
    (s) =>
      s.filedIn !== undefined &&
      (s.filedIn === categoryId ||
        hierarchyAncestors(tree, s).some((a) => a.id === categoryId && isCategory(a))),
  );
}

/**
 * Category to file a source in, from the categories of the knowledge drawn from it: their
 * deepest common category; if they only share the root, the category that holds the most of
 * them (the first one on a tie). `parentOf` also knows the categories about to be created.
 */
export function categoryForSource(
  categoryIds: readonly string[],
  parentOf: (id: string) => string | null | undefined,
  rootId: string,
): string {
  if (categoryIds.length === 0) return rootId;
  const chain = (id: string): string[] => {
    const out: string[] = [];
    for (let current: string | null | undefined = id; current; current = parentOf(current)) {
      if (out.includes(current)) break;
      out.unshift(current);
      if (current === rootId) break;
    }
    return out[0] === rootId ? out : [rootId, ...out];
  };
  const chains = categoryIds.map(chain);
  let common = rootId;
  for (let i = 0; ; i++) {
    const id = chains[0]![i];
    if (!id || !chains.every((c) => c[i] === id)) break;
    common = id;
  }
  if (common !== rootId) return common;
  const counts = new Map<string, number>();
  for (const id of categoryIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  let best = categoryIds[0]!;
  for (const [id, count] of counts) if (count > (counts.get(best) ?? 0)) best = id;
  return best;
}

/** Discussions placed in a branch (the node and below), from newest to oldest. */
export function discussionsInBranch(
  tree: WikiTree,
  hierarchy: Hierarchy,
  nodeId: string,
): PlacedDiscussion[] {
  const out: PlacedDiscussion[] = [];
  for (const [path, place] of hierarchy.placeOf) {
    const node = tree.nodes.get(place);
    if (place === nodeId || (node && hierarchyAncestors(tree, node).some((a) => a.id === nodeId))) {
      const entry = [...hierarchy.discussionsAt.get(place)!].find((d) => d.path === path);
      if (entry) out.push(entry);
    }
  }
  return out.sort((a, b) => b.path.localeCompare(a.path));
}
