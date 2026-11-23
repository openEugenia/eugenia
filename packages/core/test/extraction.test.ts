import { describe, expect, it } from "vitest";
import {
  extractionChanges,
  knowledgeKey,
  newCandidates,
  parseFlashcardBody,
  parsePage,
} from "../src/index.ts";
import { applyChanges, memoryWiki, page, type Files } from "./helpers.ts";

const BASE: Files = {
  ".notes/config.yml": "title: Test\nroot: wiki/\n",
  "wiki/index.md": page({ id: "R", title: "Root", visibility: "public" }),
  "wiki/science/index.md": page({ id: "SCI", title: "Science", visibility: "public" }),
  "wiki/science/astronomy/index.md": page({ id: "AST", title: "Astronomy" }),
  "wiki/science/astronomy/apogee/index.md": page(
    { id: "K1", type: "knowledge", title: "Apogee of the Moon", extracted_from: "SRC" },
    "The **apogee** is the farthest point.",
  ),
  "library/moon/index.md": page({ id: "SRC", type: "source", title: "The Moon" }, "Notes."),
};

const candidate = (title: string, category: string) => ({
  title,
  statement: `**${title}** is a fact.`,
  question: `What is ${title}?`,
  answer: title,
  category,
});

describe("knowledge proposed by an index, added without review", () => {
  it("leaves out what is already in the wiki", async () => {
    const wiki = await memoryWiki(BASE);
    const kept = newCandidates(wiki.tree, "SRC", [
      { title: "Apogée of the moon" },
      { title: "Black Moon" },
      { title: "black moon!" },
    ]);
    expect(kept.map((c) => c.title)).toEqual(["Black Moon"]);
    expect(knowledgeKey("**Apogée** of the Moon")).toBe("apogee of the moon");
  });

  it("creates the planned categories, the knowledge and their flashcards, citing the source", async () => {
    const wiki = await memoryWiki(BASE);
    const result = await extractionChanges(wiki.view, {
      sourceId: "SRC",
      categories: [
        { key: "new:1", title: "Lunar orbit", parent: "AST" },
        { key: "new:2", title: "Unused", parent: "AST" },
      ],
      knowledge: [candidate("Black Moon", "new:1"), candidate("Perigee", "AST")],
    });
    expect(result.categories.map((c) => c.title)).toEqual(["Lunar orbit"]);
    expect(result.knowledge.map((k) => k.title)).toEqual(["Black Moon", "Perigee"]);
    const files = applyChanges(BASE, result.changes);
    const black = parsePage(files["wiki/science/astronomy/lunar-orbit/black-moon/index.md"]!);
    expect(black.fields).toMatchObject({
      type: "knowledge",
      extracted_from: "SRC",
      sources: [{ ref: "SRC" }],
    });
    expect(black.body.trim()).toBe("**Black Moon** is a fact.");
    const card = Object.keys(files).find((p) =>
      p.startsWith("wiki/science/astronomy/lunar-orbit/black-moon/what-is"),
    )!;
    expect(parseFlashcardBody(parsePage(files[card]!).body)).toMatchObject({
      question: "What is Black Moon?",
      answer: "Black Moon",
    });
    expect(files["wiki/science/astronomy/perigee/index.md"]).toContain("type: knowledge");
    // The source, not filed yet, is filed where its knowledge goes: their common category.
    expect(parsePage(files["library/moon/index.md"]!).fields.category).toBe("AST");
    const after = await memoryWiki(files);
    expect(after.tree.problems.filter((p) => p.level === "error")).toEqual([]);
  });

  it("leaves an already filed source where it is", async () => {
    const files = {
      ...BASE,
      "library/moon/index.md": page({
        id: "SRC",
        type: "source",
        title: "The Moon",
        category: "SCI",
      }),
    };
    const wiki = await memoryWiki(files);
    const result = await extractionChanges(wiki.view, {
      sourceId: "SRC",
      knowledge: [candidate("Perigee", "AST")],
    });
    expect(result.changes.map((c) => c.path)).not.toContain("library/moon/index.md");
  });
});
