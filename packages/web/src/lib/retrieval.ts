/**
 * Search in the common hierarchy for Eugenia's answers (§8.5): the navigator over the wiki, its
 * sources (and the sections of their index) and its discussions, and the elements closest in
 * meaning to a question (exhaustive search, for the owner with search by meaning set up).
 */
import {
  descendants,
  discussionInBranch,
  isInBranch,
  parseSectionId,
  sourcesInBranch,
} from "@openeugenia/core";
import { treeNavigator, type Candidate, type TreeNavigator } from "@openeugenia/ai";
import { useSettings } from "../store/settings.ts";
import { useWiki } from "../store/wiki.ts";
import { currentSemanticIndex, semanticSearch } from "./semantic.ts";
import { hasEmbeddings } from "./settings.ts";
import type { Derived } from "./workspace.ts";

/** Navigator over the common hierarchy: everything for the owner, the public part otherwise. */
export function hierarchyNavigator(derived: Derived, owner: boolean): TreeNavigator {
  const workspace = useWiki.getState().workspace;
  if (!workspace) throw new Error("Wiki not loaded.");
  return treeNavigator(workspace, owner ? "private" : "public", {
    summaries: derived.summaries,
    hierarchy: derived.hierarchy,
  });
}

/** True if an element (page, section of a source index, discussion) is in a branch. */
export function inBranch(derived: Derived, scopeId: string, id: string): boolean {
  const { tree, hierarchy } = derived;
  if (scopeId === tree.rootId) return true;
  const node = tree.nodes.get(id);
  if (node) return isInBranch(tree, scopeId, node);
  const section = parseSectionId(id);
  const source = section ? tree.nodes.get(section.sourceId) : undefined;
  if (source) return isInBranch(tree, scopeId, source);
  const discussion = hierarchy.discussionById.get(id);
  return discussion ? discussionInBranch(tree, hierarchy, scopeId, discussion.path) : false;
}

/** Does a search in this branch read private content (pages, sources, discussions)? */
export function branchInvolvesPrivate(derived: Derived, scopeId: string): boolean {
  const { tree, hierarchy } = derived;
  const scope = tree.nodes.get(scopeId);
  if (!scope) return true;
  if (!scope.isPublic || descendants(tree, scopeId).some((d) => !d.isPublic)) return true;
  if (sourcesInBranch(tree, scopeId).some((s) => !s.isPublic)) return true;
  // Discussions are personal: their content counts as private.
  return derived.discussions.some(
    (d) => d.meta.kind !== "quiz" && discussionInBranch(tree, hierarchy, scopeId, d.path),
  );
}

/**
 * Elements closest in meaning to a text, in a branch (best first). Empty without search by
 * meaning (not set up, or the public part of a wiki): the tree search remains.
 */
export async function semanticCandidates(
  derived: Derived,
  owner: boolean,
  text: string,
  scopeId: string,
  options: { limit?: number; signal?: AbortSignal } = {},
): Promise<Candidate[]> {
  const settings = useSettings.getState().settings;
  if (!owner || !hasEmbeddings(settings) || !text.trim()) return [];
  const index = await currentSemanticIndex(settings.ai.embeddings!.model!);
  if (!index.items.some((i) => i.vector)) return [];
  const hits = await semanticSearch(index, text, options.signal, 60);
  return hits
    .filter((h) => inBranch(derived, scopeId, h.id))
    .slice(0, options.limit ?? 10)
    .map((h) => ({ id: h.id, score: h.score }));
}
