/**
 * The unified graph (§9.2, view 7): the common hierarchy of the wiki as one tree — categories,
 * knowledge items and their flashcards, the sources filed in the categories and the sections
 * of their index, the discussions placed under the pages. Only the links of this tree are
 * drawn. Branches are folded and unfolded; the layout is computed (left to right), never
 * dragged.
 *
 * This module has no React dependency: it builds the visible items and their positions.
 */
import type { SourceIndexNode, WikiNode } from "@openeugenia/core";
import type { Derived, DiscussionEntry } from "./workspace.ts";

export type GraphKind =
  "category" | "knowledge" | "flashcard" | "source" | "section" | "discussion";

export interface GraphItem {
  /** Page identifier, `<source id>#<path>` for a section, `discussion:<path>` for a discussion. */
  id: string;
  kind: GraphKind;
  title: string;
  parentId: string | null;
  depth: number;
  /** Number of children, when known (the sections of an index are known once it is loaded). */
  childCount: number;
  /** The item has (or may have) children. */
  expandable: boolean;
  expanded: boolean;
  /** Page (category, knowledge, flashcard, source). */
  node?: WikiNode;
  /** Section: its source and its node in the index. */
  source?: WikiNode;
  section?: SourceIndexNode;
  /** Discussion. */
  discussion?: DiscussionEntry;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
}

export function discussionGraphId(path: string): string {
  return `discussion:${path}`;
}

export function sectionGraphId(sourceId: string, key: string): string {
  return `${sourceId}#${key}`;
}

type Child =
  | { kind: "page"; node: WikiNode }
  | { kind: "section"; source: WikiNode; section: SourceIndexNode }
  | { kind: "discussion"; entry: DiscussionEntry };

/** Children of an element, in display order: categories, knowledge, sources, discussions. */
function childrenOf(
  derived: Derived,
  item: Pick<GraphItem, "kind" | "node" | "source" | "section">,
  indexes: ReadonlyMap<string, SourceIndexNode | null>,
): Child[] | null {
  const { tree, hierarchy } = derived;
  const discussions = (id: string): Child[] =>
    (hierarchy.discussionsAt.get(id) ?? []).map((entry) => ({
      kind: "discussion" as const,
      entry,
    }));
  const pages = (ids: readonly string[]): WikiNode[] =>
    ids.map((id) => tree.nodes.get(id)).filter((n): n is WikiNode => n !== undefined);
  switch (item.kind) {
    case "category": {
      const node = item.node!;
      const kids = pages(node.childIds);
      return [
        ...kids
          .filter((n) => n.type === "category")
          .map((n) => ({ kind: "page" as const, node: n })),
        ...kids
          .filter((n) => n.type !== "category")
          .map((n) => ({ kind: "page" as const, node: n })),
        ...(hierarchy.sourcesAt.get(node.id) ?? []).map((n) => ({
          kind: "page" as const,
          node: n,
        })),
        ...discussions(node.id),
      ];
    }
    case "knowledge":
      return [
        ...pages(item.node!.childIds).map((n) => ({ kind: "page" as const, node: n })),
        ...discussions(item.node!.id),
      ];
    case "source": {
      const source = item.node!;
      const index = indexes.get(source.id);
      // The sections are known once the index is read.
      if (source.sourceIndex?.root && index === undefined) return null;
      return [
        ...(index?.children ?? []).map((section) => ({
          kind: "section" as const,
          source,
          section,
        })),
        ...discussions(source.id),
      ];
    }
    case "section":
      return item.section!.children.map((section) => ({
        kind: "section" as const,
        source: item.source!,
        section,
      }));
    default:
      return [];
  }
}

function kindOf(node: WikiNode): GraphKind {
  if (node.type === "knowledge" || node.type === "flashcard" || node.type === "source") {
    return node.type;
  }
  return "category";
}

/**
 * Visible items of the graph from a focus node: the focus, then the children of every unfolded
 * item. A source whose index is not loaded yet counts as unfoldable.
 */
export function buildGraph(
  derived: Derived,
  focusId: string,
  expanded: ReadonlySet<string>,
  indexes: ReadonlyMap<string, SourceIndexNode | null>,
): { items: GraphItem[]; edges: GraphEdge[] } {
  const items: GraphItem[] = [];
  const edges: GraphEdge[] = [];
  const focus = derived.tree.nodes.get(focusId) ?? derived.tree.nodes.get(derived.tree.rootId)!;
  const visit = (
    base: Omit<GraphItem, "childCount" | "expandable" | "expanded" | "depth">,
    depth: number,
  ): void => {
    const children = childrenOf(derived, base, indexes);
    const known = children ?? [];
    const expandable = children === null || known.length > 0;
    // The focus is always unfolded.
    const open = expandable && (depth === 0 || expanded.has(base.id));
    items.push({ ...base, depth, childCount: known.length, expandable, expanded: open });
    if (base.parentId) {
      edges.push({ id: `${base.parentId}->${base.id}`, source: base.parentId, target: base.id });
    }
    if (!open) return;
    for (const child of known) {
      if (child.kind === "page") {
        visit(
          {
            id: child.node.id,
            kind: kindOf(child.node),
            title: child.node.title,
            parentId: base.id,
            node: child.node,
          },
          depth + 1,
        );
      } else if (child.kind === "section") {
        visit(
          {
            id: sectionGraphId(child.source.id, child.section.key),
            kind: "section",
            title: child.section.name,
            parentId: base.id,
            source: child.source,
            section: child.section,
          },
          depth + 1,
        );
      } else {
        visit(
          {
            id: discussionGraphId(child.entry.path),
            kind: "discussion",
            title: child.entry.meta.title || "Discussion",
            parentId: base.id,
            discussion: child.entry,
          },
          depth + 1,
        );
      }
    }
  };
  visit({ id: focus.id, kind: kindOf(focus), title: focus.title, parentId: null, node: focus }, 0);
  return { items, edges };
}

export interface Size {
  width: number;
  height: number;
}

/**
 * Positions (top left corner) of a tree laid out from left to right: one column per depth, as
 * wide as its widest card; each item centered on the block of its children. Sizes are those
 * measured on screen (or an estimate before the first measure).
 */
export function layoutTree(
  items: readonly Pick<GraphItem, "id" | "parentId" | "depth">[],
  size: (id: string) => Size,
  options: { columnGap?: number; rowGap?: number } = {},
): Map<string, { x: number; y: number }> {
  const columnGap = options.columnGap ?? 72;
  const rowGap = options.rowGap ?? 14;
  const children = new Map<string, string[]>();
  const roots: string[] = [];
  const widths: number[] = [];
  for (const item of items) {
    if (item.parentId === null) roots.push(item.id);
    else children.set(item.parentId, [...(children.get(item.parentId) ?? []), item.id]);
    widths[item.depth] = Math.max(widths[item.depth] ?? 0, size(item.id).width);
  }
  const columns: number[] = [];
  widths.forEach((width, depth) => {
    columns[depth] = depth === 0 ? 0 : columns[depth - 1]! + (widths[depth - 1] ?? 0) + columnGap;
  });
  const depthOf = new Map(items.map((i) => [i.id, i.depth]));
  const blocks = new Map<string, number>();
  const block = (id: string): number => {
    const known = blocks.get(id);
    if (known !== undefined) return known;
    const kids = children.get(id) ?? [];
    const kidsHeight =
      kids.reduce((sum, kid) => sum + block(kid), 0) + Math.max(0, kids.length - 1) * rowGap;
    const value = Math.max(size(id).height, kidsHeight);
    blocks.set(id, value);
    return value;
  };
  const positions = new Map<string, { x: number; y: number }>();
  const place = (id: string, top: number): void => {
    const own = size(id).height;
    const kids = children.get(id) ?? [];
    const kidsHeight =
      kids.reduce((sum, kid) => sum + block(kid), 0) + Math.max(0, kids.length - 1) * rowGap;
    const total = Math.max(own, kidsHeight);
    positions.set(id, { x: columns[depthOf.get(id) ?? 0] ?? 0, y: top + (total - own) / 2 });
    let y = top + (total - kidsHeight) / 2;
    for (const kid of kids) {
      place(kid, y);
      y += block(kid) + rowGap;
    }
  };
  let top = 0;
  for (const root of roots) {
    place(root, top);
    top += block(root) + rowGap * 4;
  }
  return positions;
}
