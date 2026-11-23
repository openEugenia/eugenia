import { describe, expect, it } from "vitest";
import {
  createFlashcard,
  createPage,
  deleteNode,
  parseFlashcardBody,
  moveNode,
  OperationError,
  parsePage,
  updatePage,
} from "../src/index.ts";
import { applyChanges, CONFIG, memoryWiki, page } from "./helpers.ts";

const FILES = {
  ".notes/config.yml": CONFIG,
  "wiki/index.md": page({ id: "R", title: "Root", visibility: "public" }),
  "wiki/a/index.md": page({ id: "A", title: "A" }, "[B](../b/index.md) and [C](c/index.md)"),
  "wiki/a/c/index.md": page({ id: "C", title: "C" }, "[Up](../index.md) [B](../../b/index.md)"),
  "wiki/a/image.png": "PNG",
  "discussions/2026-01-01-1000-x.md":
    "---\nid: D\ntype: discussion\n---\n\n## user · 2026-01-01T10:00:00Z\nSee [C](../wiki/a/c/index.md)\n",
  "wiki/b/index.md": page({ id: "B", title: "B" }, "[A](../a/index.md) [C](../a/c/index.md#x)"),
};

describe("editing operations", async () => {
  const wiki = await memoryWiki(FILES);

  it("creates a page with a unique folder name", () => {
    const created = createPage(wiki.view, {
      parentPath: "wiki",
      parentIsPublic: true,
      title: "A",
      now: new Date("2026-11-17T10:00:00Z"),
    });
    expect(created.path).toBe("wiki/a-2");
    const doc = parsePage((created.change as { content: string }).content);
    expect(doc.fields.title).toBe("A");
    expect(doc.fields.visibility).toBe("private");
    expect(doc.fields.created).toBe("2026-11-17T10:00:00Z");
    expect(
      createPage(wiki.view, { parentPath: "wiki", parentIsPublic: true, title: "A" }, [
        "wiki/a-2/index.md",
      ]).path,
    ).toBe("wiki/a-3");
  });

  it("renames the folder when the title changes and rewrites incoming links", async () => {
    const changes = await updatePage(wiki.view, "A", { title: "Alpha" });
    const out = applyChanges(FILES, changes);
    expect(Object.keys(out).filter((p) => p.startsWith("wiki/a/"))).toEqual([]);
    expect(out["wiki/alpha/image.png"]).toBe("PNG");
    expect(parsePage(out["wiki/alpha/index.md"]!).fields.title).toBe("Alpha");
    expect(parsePage(out["wiki/alpha/index.md"]!).body).toBe(
      "[B](../b/index.md) and [C](c/index.md)\n",
    );
    expect(parsePage(out["wiki/b/index.md"]!).body).toBe(
      "[A](../alpha/index.md) [C](../alpha/c/index.md#x)\n",
    );
    expect(out["discussions/2026-01-01-1000-x.md"]).toContain("[C](../wiki/alpha/c/index.md)");
  });

  it("does not rename when the folder name does not change", async () => {
    const changes = await updatePage(wiki.view, "A", { title: "a", body: "New" });
    expect(changes.map((c) => [c.op, c.path])).toEqual([["write", "wiki/a/index.md"]]);
  });

  it("moves a branch and recomputes links both ways", async () => {
    const out = applyChanges(FILES, await moveNode(wiki.view, "C", "B"));
    // The link to B is still valid from the new location: it is kept as is.
    expect(parsePage(out["wiki/b/c/index.md"]!).body).toBe(
      "[Up](../../a/index.md) [B](../../b/index.md)\n",
    );
    expect(parsePage(out["wiki/a/index.md"]!).body).toBe(
      "[B](../b/index.md) and [C](../b/c/index.md)\n",
    );
    expect(parsePage(out["wiki/b/index.md"]!).body).toBe("[A](../a/index.md) [C](c/index.md#x)\n");
    expect(out["discussions/2026-01-01-1000-x.md"]).toContain("[C](../wiki/b/c/index.md)");
    expect(out["wiki/a/c/index.md"]).toBeUndefined();
  });

  it("refuses to move a page into its own branch", async () => {
    await expect(moveNode(wiki.view, "A", "C")).rejects.toBeInstanceOf(OperationError);
  });

  it("makes a public branch private when moved under a private parent", async () => {
    const files = {
      ...FILES,
      "wiki/a/c/index.md": page({ id: "C", title: "C", visibility: "public" }),
      "wiki/b/index.md": page({ id: "B", title: "B", visibility: "private" }),
    };
    const w = await memoryWiki(files);
    const out = applyChanges(files, await moveNode(w.view, "C", "B"));
    expect(parsePage(out["wiki/b/c/index.md"]!).fields.visibility).toBe("private");
  });

  it("deletes a branch and turns incoming links into text", async () => {
    await expect(deleteNode(wiki.view, "A")).rejects.toBeInstanceOf(OperationError);
    const out = applyChanges(FILES, await deleteNode(wiki.view, "A", { recursive: true }));
    expect(Object.keys(out).some((p) => p.startsWith("wiki/a/"))).toBe(false);
    expect(parsePage(out["wiki/b/index.md"]!).body).toBe("A C\n");
  });
});

const SPACES = {
  ".notes/config.yml": CONFIG,
  "wiki/index.md": page({ id: "R", title: "Root", visibility: "public" }),
  "wiki/cat/index.md": page({ id: "CAT", title: "Category", visibility: "public" }),
  "wiki/cat/fact/index.md": page(
    { id: "K", type: "knowledge", title: "Fact" },
    "A **fact**.",
  ).replace("title: Fact\n", "title: Fact\nsources:\n  - ref: L\n    locator: p. 12\n"),
  "wiki/cat/fact/card/index.md": page({ id: "C", type: "flashcard", title: "Card" }),
  "library/book/index.md": page(
    { id: "L", type: "source", title: "A book", url: "https://example.org/book" },
    "See [Fact](../../wiki/cat/fact/index.md).",
  ),
  "library/book/book.pdf": "PDF",
};

describe("operations across spaces", async () => {
  const wiki = await memoryWiki(SPACES);

  it("creates a flashcard under a knowledge item, titled by its question", () => {
    const created = createFlashcard(wiki.view, wiki.tree.nodes.get("K")!, {
      question: "What is a **fact**?",
      answer: "A fact.",
    });
    expect(created.path).toBe("wiki/cat/fact/what-is-a-fact");
    const doc = parsePage((created.change as { content: string }).content);
    expect(doc.fields.type).toBe("flashcard");
    expect(doc.fields.title).toBe("What is a fact?");
    expect(doc.fields.visibility).toBeUndefined();
    expect(parseFlashcardBody(doc.body)).toEqual({
      question: "What is a **fact**?",
      answer: "A fact.",
    });
    expect(doc.body).toContain("## Expected answer");
  });

  it("refuses a move that breaks the structure", async () => {
    await expect(moveNode(wiki.view, "C", "CAT")).rejects.toThrow(/knowledge/);
    await expect(moveNode(wiki.view, "K", wiki.tree.libraryId)).rejects.toThrow(/library/);
    await expect(moveNode(wiki.view, "L", "CAT")).rejects.toThrow(/library/);
  });

  it("renames a knowledge item and rewrites links from the library", async () => {
    const out = applyChanges(SPACES, await updatePage(wiki.view, "K", { title: "Knowledge" }));
    expect(parsePage(out["library/book/index.md"]!).body).toBe(
      "See [Fact](../../wiki/cat/knowledge/index.md).\n",
    );
  });

  it("deletes a source and keeps a free reference in the knowledge items", async () => {
    const out = applyChanges(SPACES, await deleteNode(wiki.view, "L"));
    expect(Object.keys(out).some((p) => p.startsWith("library/book/"))).toBe(false);
    expect(parsePage(out["wiki/cat/fact/index.md"]!).fields.sources).toEqual([
      { description: "A book", locator: "p. 12", url: "https://example.org/book" },
    ]);
  });
});
