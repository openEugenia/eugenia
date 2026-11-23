/** Mastery per branch, computed in a single walk of the tree. */
import { currentMastery, dayNumber, type CardState, type WikiTree } from "@openeugenia/core";

export interface BranchMastery {
  value: number | undefined;
  count: number;
}

export function branchMasteryMap(
  tree: WikiTree,
  mastery: ReadonlyMap<string, CardState>,
  day: number = dayNumber(Date.now()),
): Map<string, BranchMastery> {
  const out = new Map<string, BranchMastery>();
  const visit = (id: string): { sum: number; count: number } => {
    const node = tree.nodes.get(id)!;
    let sum = 0;
    let count = 0;
    if (node.type === "flashcard") {
      const state = mastery.get(id);
      if (state) {
        sum += currentMastery(state, day);
        count++;
      }
    }
    for (const child of node.childIds) {
      const r = visit(child);
      sum += r.sum;
      count += r.count;
    }
    out.set(id, { value: count > 0 ? sum / count : undefined, count });
    return { sum, count };
  };
  if (tree.nodes.has(tree.rootId)) visit(tree.rootId);
  return out;
}
