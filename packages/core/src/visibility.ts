/** Règles de visibilité public / privé (§6.2). */
import { ancestors, descendants, getNode, type WikiNode, type WikiTree } from "./tree.ts";
import type { Visibility } from "./types.ts";

export interface MakePublicPlan {
  node: WikiNode;
  /** Ancêtres privés (de la racine vers le parent) à rendre publics pour respecter la règle 3. */
  privateAncestors: WikiNode[];
  /** Descendants, proposés à l'inclusion (cases à cocher, règle 4). */
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
  /** Descendants actuellement publics, qui deviendront privés (règle 5). */
  publicDescendants: WikiNode[];
}

export function planMakePrivate(tree: WikiTree, nodeId: string): MakePrivatePlan {
  return {
    node: getNode(tree, nodeId),
    publicDescendants: descendants(tree, nodeId).filter((d) => d.isPublic),
  };
}

/**
 * Visibilités à écrire pour obtenir les visibilités effectives `desired`, en ne
 * modifiant que les nœuds dont la valeur effective changerait sinon.
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
 * Rend public un nœud. Si un ancêtre est privé, `includeAncestors` doit être vrai
 * (confirmation explicite de l'utilisateur) ; sinon rien ne change. Les descendants
 * non inclus deviennent (ou restent) explicitement privés.
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
    // Un descendant inclus dont le parent ne l'est pas resterait sous un nœud privé.
    const parentIncluded = d.parentId === nodeId || desired.get(d.parentId ?? "") === "public";
    desired.set(d.id, includedDescendants.has(d.id) && parentIncluded ? "public" : "private");
  }
  return assignmentsFor(tree, desired);
}

/** Rend privés un nœud et tous ses descendants (règle 5). */
export function makePrivateAssignments(
  tree: WikiTree,
  nodeId: string,
): Map<string, Visibility | undefined> {
  const desired = new Map<string, Visibility>([[nodeId, "private"]]);
  for (const d of descendants(tree, nodeId)) desired.set(d.id, "private");
  return assignmentsFor(tree, desired);
}

/** Visibilité d'un nouveau nœud : privé par défaut, et jamais public sous un parent privé. */
export function defaultVisibilityFor(
  parent: Pick<WikiNode, "isPublic"> | undefined,
  defaultVisibility: Visibility,
): Visibility {
  return parent?.isPublic ? defaultVisibility : "private";
}
