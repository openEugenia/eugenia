import { describe, expect, it } from "vitest";
import {
  ancestors,
  children,
  descendants,
  flashcardsUnder,
  knowledgeOf,
  knowledgeUnder,
  librarySources,
  nodeForPath,
  placementProblem,
} from "../src/index.ts";
import { CONFIG, memoryWiki, page } from "./helpers.ts";

const FILES = {
  ".notes/config.yml": CONFIG,
  "wiki/index.md": page(
    { id: "R", type: "category", title: "Root", visibility: "public" },
    "Welcome.",
  ),
  "wiki/_summary.md": page({ id: "S1", type: "summary", scope: "private" }, "Summary."),
  "wiki/zeta/index.md": page({ id: "Z", title: "Zêta" }),
  "wiki/alpha/index.md": page({ id: "A", title: "Alpha", visibility: "public", order: 5 }),
  "wiki/beta/index.md": page({ id: "B", title: "Beta", order: 1, visibility: "private" }),
  "wiki/alpha/fact/index.md": page({ id: "K", type: "knowledge", title: "Fact" }, "A **fact**."),
  "wiki/alpha/fact/card/index.md": page({ id: "C", type: "flashcard", title: "Card" }),
  "wiki/alpha/photo.png": "png",
  "wiki/alpha/images/diagram.svg": "<svg/>",
  "wiki/empty/sub/index.md": page({ id: "V", title: "Sub" }),
  "wiki/_drafts/x/index.md": page({ id: "X", title: "Hidden" }),
  "library/book/index.md": page({ id: "L", type: "source", kind: "book", title: "Book" }),
  "library/book/book.pdf": "pdf",
  "library/site/index.md": page({ id: "W", title: "Website", visibility: "public" }),
  "discussions/2026-01-01-1000-quiz.md": "---\nid: Q\ntype: discussion\nkind: quiz\n---\n",
  "discussions/2026-01-02-0900-x.md": "---\nid: D\ntype: discussion\n---\n",
  "README.md": "# outside the root",
};

describe("tree", async () => {
  const { tree } = await memoryWiki(FILES);

  it("builds the hierarchy and ignores reserved folders", () => {
    expect(tree.rootId).toBe("R");
    expect(tree.nodes.has("X")).toBe(false);
    expect(children(tree, "R").map((n) => n.id)).toEqual(["B", "A", "virtual:wiki/empty", "Z"]);
  });

  it("sorts by order, then by title", () => {
    const titles = children(tree, "R").map((n) => n.title);
    expect(titles).toEqual(["Beta", "Alpha", "Empty", "Zêta"]);
  });

  it("creates virtual nodes for folders without index.md", () => {
    const empty = tree.nodes.get("virtual:wiki/empty")!;
    expect(empty.virtual).toBe(true);
    expect(empty.childIds).toEqual(["V"]);
    expect(tree.problems.some((p) => p.code === "missing-index")).toBe(true);
  });

  it("types pages according to their space", () => {
    expect(tree.nodes.get("Z")!.type).toBe("category");
    expect(tree.nodes.get("K")!.type).toBe("knowledge");
    expect(tree.nodes.get("C")!.type).toBe("flashcard");
    expect(tree.nodes.get("W")!.type).toBe("source");
    expect(tree.nodes.get("W")!.space).toBe("library");
    expect(tree.nodes.get("L")!.sourceKind).toBe("book");
  });

  it("gathers the library under its root, as a flat list", () => {
    const library = tree.nodes.get(tree.libraryId)!;
    expect(library.virtual).toBe(true);
    expect(library.title).toBe("Library");
    expect(library.childIds).toEqual(["L", "W"]);
    expect(
      librarySources(tree)
        .map((n) => n.id)
        .sort(),
    ).toEqual(["L", "W"]);
    expect(tree.nodes.get("L")!.attachments.map((f) => f.path)).toEqual(["library/book/book.pdf"]);
  });

  it("lists discussions from newest to oldest", () => {
    expect(tree.discussions.map((f) => f.path)).toEqual([
      "discussions/2026-01-02-0900-x.md",
      "discussions/2026-01-01-1000-quiz.md",
    ]);
  });

  it("attaches descriptions and attachments", () => {
    const root = tree.nodes.get("R")!;
    const alpha = tree.nodes.get("A")!;
    expect(root.summaries.private?.path).toBe("wiki/_summary.md");
    expect(alpha.attachments.map((f) => f.path)).toEqual([
      "wiki/alpha/images/diagram.svg",
      "wiki/alpha/photo.png",
    ]);
  });

  it("computes the effective visibility by inheritance", () => {
    expect(tree.nodes.get("A")!.isPublic).toBe(true);
    expect(tree.nodes.get("C")!.visibility).toBe("public");
    expect(tree.nodes.get("C")!.isPublic).toBe(true);
    expect(tree.nodes.get("B")!.isPublic).toBe(false);
    expect(tree.nodes.get("Z")!.visibility).toBe("public");
    // Each source has its own visibility (private by default).
    expect(tree.nodes.get("W")!.isPublic).toBe(true);
    expect(tree.nodes.get("L")!.isPublic).toBe(false);
  });

  it("walks ancestors, descendants, knowledge and flashcards", () => {
    expect(ancestors(tree, "C").map((n) => n.id)).toEqual(["R", "A", "K"]);
    expect(descendants(tree, "A").map((n) => n.id)).toEqual(["K", "C"]);
    expect(flashcardsUnder(tree, "R").map((n) => n.id)).toEqual(["C"]);
    expect(knowledgeUnder(tree, "R").map((n) => n.id)).toEqual(["K"]);
    expect(knowledgeOf(tree, tree.nodes.get("C")!)?.id).toBe("K");
    expect(nodeForPath(tree, "wiki/alpha/fact/card/index.md")?.id).toBe("C");
  });

  it("constrains where pages can be placed", () => {
    const card = tree.nodes.get("C")!;
    const knowledge = tree.nodes.get("K")!;
    const source = tree.nodes.get("L")!;
    expect(placementProblem(tree, card, "K")).toBeNull();
    expect(placementProblem(tree, card, "A")).toMatch(/knowledge/);
    expect(placementProblem(tree, knowledge, "Z")).toBeNull();
    expect(placementProblem(tree, knowledge, "K")).toMatch(/only contains flashcards/);
    expect(placementProblem(tree, knowledge, tree.libraryId)).toMatch(/library/);
    expect(placementProblem(tree, source, tree.libraryId)).toBeNull();
    expect(placementProblem(tree, source, "A")).toMatch(/library/);
  });

  it("reports misplaced pages", async () => {
    const { tree: t } = await memoryWiki({
      ...FILES,
      "wiki/alpha/orphan/index.md": page({ id: "O", type: "flashcard", title: "Orphan" }),
      "wiki/alpha/fact/sub/index.md": page({ id: "S", title: "Subcategory" }),
      "library/book/chapter/index.md": page({ id: "CH", title: "Chapter" }),
      "wiki/source/index.md": page({ id: "SW", type: "source", title: "Stray source" }),
      "wiki/alpha/_discussions/2026-01-01-x.md": "---\nid: OLD\n---\n",
    });
    const codes = (id: string): string[] =>
      t.problems.filter((p) => p.nodeId === id).map((p) => p.code);
    expect(codes("O")).toEqual(["flashcard-parent"]);
    expect(codes("S")).toEqual(["knowledge-child"]);
    expect(codes("CH")).toEqual(["nested-source"]);
    expect(
      t.problems.some((p) => p.code === "unknown-type" && p.path === "wiki/source/index.md"),
    ).toBe(true);
    expect(t.problems.some((p) => p.code === "legacy-discussion")).toBe(true);
  });

  it("reports a public node under a private ancestor", async () => {
    const { tree: t } = await memoryWiki({
      ...FILES,
      "wiki/beta/pub/index.md": page({ id: "P", title: "Pub", visibility: "public" }),
    });
    const problem = t.problems.find((p) => p.code === "public-under-private");
    expect(problem?.nodeId).toBe("P");
    expect(t.nodes.get("P")!.isPublic).toBe(false);
  });

  it("reports missing or duplicate identifiers", async () => {
    const { tree: t } = await memoryWiki({
      ".notes/config.yml": CONFIG,
      "wiki/index.md": page({ id: "R", title: "R" }),
      "wiki/a/index.md": page({ id: "A", title: "A" }),
      "wiki/b/index.md": page({ id: "A", title: "B" }),
      "wiki/c/index.md": page({ title: "C" }),
    });
    expect(t.problems.map((p) => p.code).sort()).toEqual(["duplicate-id", "missing-id"]);
    // Four wiki pages and the (virtual) library root.
    expect(t.nodes.size).toBe(5);
  });
});
