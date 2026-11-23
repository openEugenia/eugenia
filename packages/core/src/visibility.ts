/** Public / private visibility rules (§6.2). */
import { ancestors, descendants, getNode, type WikiNode, type WikiTree } from "./tree.ts";
import type { Visibility } from "./types.ts";

export interface MakePublicPlan {
  node: WikiNode;
  /** Private ancestors (from the root to the parent) to make public to satisfy rule 3. */
  privateAncestors: WikiNode[];
  /** Descendants, offered for inclusion (checkboxes, rule 4). */
  descendants: WikiNode[];
}

export function planMakePublic(tree: WikiTree, nodeId: string): MakePublicPlan {
  const node = getNode(tree, nodeId);
  return {
    node,
    privateAncestors: ancestors(tree, nodeId).filter((a) => !a.isPublic),
    descendants: descendants(tree, nodeId),
  };
}

export interface MakePrivatePlan {
  node: WikiNode;
  /** Currently public descendants, which will become private (rule 5). */
  publicDescendants: WikiNode[];
}

export function planMakePrivate(tree: WikiTree, nodeId: string): MakePrivatePlan {
  return {
    node: getNode(tree, nodeId),
    publicDescendants: descendants(tree, nodeId).filter((d) => d.isPublic),
  };
}

/**
 * Visibilities to write to obtain the effective visibilities `desired`, only changing the
 * nodes whose effective value would otherwise differ.
 */
function assignmentsFor(
  tree: WikiTree,
  desired: ReadonlyMap<string, Visibility>,
): Map<string, Visibility | undefined> {
  const writes = new Map<string, Visibility | undefined>();
  const effective = new Map<string, Visibility>();
  const visit = (node: WikiNode, parentVisibility: Visibility): void => {
    const want = desired.get(node.id);
    let declared = node.declaredVisibility;
    if (want !== undefined) {
      const inherited = declared ?? parentVisibility;
      if (inherited !== want) declared = want;
      if (declared !== node.declaredVisibility) writes.set(node.id, declared);
    }
    const value = declared ?? parentVisibility;
    effective.set(node.id, value);
    for (const childId of node.childIds) visit(tree.nodes.get(childId)!, value);
  };
  for (const rootId of [tree.rootId, tree.libraryId]) {
    const root = getNode(tree, rootId);
    visit(root, root.declaredVisibility ?? tree.config.default_visibility);
  }
  return writes;
}

/**
 * Makes a node public. If an ancestor is private, `includeAncestors` must be true (explicit
 * confirmation by the user); otherwise nothing changes. Descendants that are not included
 * become (or stay) explicitly private.
 */
export function makePublicAssignments(
  tree: WikiTree,
  nodeId: string,
  includedDescendants: ReadonlySet<string>,
  includeAncestors: boolean,
): Map<string, Visibility | undefined> {
  const plan = planMakePublic(tree, nodeId);
  if (plan.privateAncestors.length > 0 && !includeAncestors) return new Map();
  const desired = new Map<string, Visibility>();
  for (const ancestor of plan.privateAncestors) desired.set(ancestor.id, "public");
  desired.set(nodeId, "public");
  for (const d of plan.descendants) {
    // An included descendant whose parent is not included would stay under a private node.
    const parentIncluded = d.parentId === nodeId || desired.get(d.parentId ?? "") === "public";
    desired.set(d.id, includedDescendants.has(d.id) && parentIncluded ? "public" : "private");
  }
  return assignmentsFor(tree, desired);
}

/** Makes a node and all its descendants private (rule 5). */
export function makePrivateAssignments(
  tree: WikiTree,
  nodeId: string,
): Map<string, Visibility | undefined> {
  const desired = new Map<string, Visibility>([[nodeId, "private"]]);
  for (const d of descendants(tree, nodeId)) desired.set(d.id, "private");
  return assignmentsFor(tree, desired);
}

/** Visibility of a new node: private by default, and never public under a private parent. */
export function defaultVisibilityFor(
  parent: Pick<WikiNode, "isPublic"> | undefined,
  defaultVisibility: Visibility,
): Visibility {
  return parent?.isPublic ? defaultVisibility : "private";
}
