import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildHierarchy,
  discussionMeta,
  gitBlobSha,
  isDiscussionPath,
  loadWiki,
  readSourceIndex,
  type SourceIndexNode,
} from "@openeugenia/core";
import { buildGraph, discussionGraphId, layoutTree, sectionGraphId } from "../src/lib/graph.ts";
import type { Derived } from "../src/lib/workspace.ts";

const DEMO = join(import.meta.dirname, "..", "..", "..", "examples", "demo-wiki");

function readDirectory(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (path: string): void => {
    for (const name of readdirSync(path)) {
      const full = join(path, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.set(relative(DEMO, full), readFileSync(full, "utf8"));
    }
  };
  walk(dir);
  return out;
}

/** The demo wiki, as the graph sees it: its tree and its common hierarchy. */
async function demo() {
  const source = readDirectory(DEMO);
  const files = await Promise.all(
    [...source].map(async ([path, content]) => ({ path, sha: await gitBlobSha(content) })),
  );
  const readText = async (path: string): Promise<string> => source.get(path)!;
  const wiki = await loadWiki({ files, readText });
  const discussions = [...source.keys()]
    .filter((p) => isDiscussionPath(wiki.config, p))
    .map((path) => ({ path, meta: discussionMeta(source.get(path)!) }));
  const hierarchy = buildHierarchy(wiki.tree, discussions);
  const derived = { tree: wiki.tree, hierarchy } as unknown as Derived;
  const view = { config: wiki.config, tree: wiki.tree, files: wiki.files, readText };
  return { derived, view, tree: wiki.tree, hierarchy };
}

const byTitle = <T extends { title: string }>(items: T[], title: string): T | undefined =>
  items.find((i) => i.title === title);

describe("unified graph", async () => {
  const { derived, view, tree, hierarchy } = await demo();
  const root = tree.nodes.get(tree.rootId)!;
  const none = new Map<string, SourceIndexNode | null>();

  it("shows the focus unfolded and its children folded", () => {
    const { items, edges } = buildGraph(derived, tree.rootId, new Set(), none);
    expect(items[0]).toMatchObject({ id: tree.rootId, depth: 0, expanded: true, parentId: null });
    const children = items.filter((i) => i.parentId === tree.rootId);
    // Categories first, then the discussions placed at the root.
    expect(children.map((c) => c.kind)).toEqual([
      ...root.childIds.map(() => "category"),
      ...(hierarchy.discussionsAt.get(tree.rootId) ?? []).map(() => "discussion"),
    ]);
    expect(children.every((c) => !c.expanded && c.depth === 1)).toBe(true);
    // Only the links of the tree.
    expect(edges).toHaveLength(items.length - 1);
    expect(edges.every((e) => e.source === tree.rootId)).toBe(true);
  });

  it("places the sources in their category and the discussions under their page", () => {
    const religion = byTitle([...tree.nodes.values()], "Religion and beliefs")!;
    const { items } = buildGraph(derived, religion.id, new Set(), none);
    const sources = items.filter((i) => i.kind === "source").map((i) => i.title);
    expect(sources).toEqual((hierarchy.sourcesAt.get(religion.id) ?? []).map((s) => s.title));
    expect(sources.length).toBeGreaterThan(0);
    const discussion = items.find((i) => i.kind === "discussion")!;
    expect(discussion.id).toBe(discussionGraphId(discussion.discussion!.path));
    expect(discussion.parentId).toBe(religion.id);
  });

  it("unfolds a knowledge item into its flashcards", () => {
    const lilith = [...tree.nodes.values()].find(
      (n) => n.type === "knowledge" && n.title === "Lilith",
    )!;
    const { items } = buildGraph(derived, lilith.parentId!, new Set([lilith.id]), none);
    const cards = items.filter((i) => i.parentId === lilith.id && i.kind === "flashcard");
    expect(cards).toHaveLength(lilith.childIds.length);
    expect(cards[0]!.depth).toBe(2);
  });

  it("shows the sections of an index once it is read", async () => {
    const source = byTitle([...tree.nodes.values()], "Wikipedia: Black Moon Lilith")!;
    const category = source.filedIn!;
    const folded = buildGraph(derived, category, new Set([source.id]), none);
    // Not read yet: unfoldable, without children.
    expect(folded.items.find((i) => i.id === source.id)).toMatchObject({
      expandable: true,
      expanded: true,
      childCount: 0,
    });
    const index = (await readSourceIndex(view, source))!;
    const indexes = new Map([[source.id, index.root]]);
    const { items } = buildGraph(derived, category, new Set([source.id]), indexes);
    const sections = items.filter((i) => i.kind === "section");
    expect(sections.map((s) => s.title)).toEqual(index.root.children.map((c) => c.name));
    expect(sections[0]!.id).toBe(sectionGraphId(source.id, index.root.children[0]!.key));
    expect(sections[0]!.source?.id).toBe(source.id);
  });

  it("falls back to the root for an unknown focus", () => {
    const { items } = buildGraph(derived, "unknown", new Set(), none);
    expect(items[0]!.id).toBe(tree.rootId);
  });
});

describe("tree layout", () => {
  const items = [
    { id: "r", parentId: null, depth: 0 },
    { id: "a", parentId: "r", depth: 1 },
    { id: "b", parentId: "r", depth: 1 },
    { id: "a1", parentId: "a", depth: 2 },
  ];
  const sizes: Record<string, { width: number; height: number }> = {
    r: { width: 300, height: 100 },
    a: { width: 200, height: 40 },
    b: { width: 240, height: 60 },
    a1: { width: 100, height: 200 },
  };

  it("places one column per depth, as wide as its widest card", () => {
    const at = layoutTree(items, (id) => sizes[id]!, { columnGap: 50, rowGap: 10 });
    expect(at.get("r")!.x).toBe(0);
    expect(at.get("a")!.x).toBe(350);
    expect(at.get("b")!.x).toBe(350);
    expect(at.get("a1")!.x).toBe(350 + 240 + 50);
  });

  it("centers each card on the block of its children, without overlap", () => {
    const at = layoutTree(items, (id) => sizes[id]!, { columnGap: 50, rowGap: 10 });
    // "a" is as high as its child (200): centered on it.
    expect(at.get("a1")!.y).toBe(0);
    expect(at.get("a")!.y).toBe(80);
    // "b" comes after the block of "a".
    expect(at.get("b")!.y).toBe(210);
    // The root is centered on the block of its children (0 → 270).
    expect(at.get("r")!.y).toBe(85);
  });
});
