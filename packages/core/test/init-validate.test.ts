import { describe, expect, it } from "vitest";
import {
  DEFAULT_CATEGORIES,
  hasErrors,
  publishWorkflow,
  scaffoldWiki,
  validateWiki,
} from "../src/index.ts";
import { memoryWiki, page } from "./helpers.ts";

describe("initialization", () => {
  const files = Object.fromEntries(
    scaffoldWiki({
      title: "My wiki",
      privateRepo: "alice/wiki",
      publicRepo: "alice/wiki-public",
      now: new Date("2026-11-17T10:00:00Z"),
    }),
  );

  it("creates the configuration, the root, the default categories and the workflow", () => {
    expect(files[".notes/config.yml"]).toContain("private_repo: alice/wiki");
    expect(Object.keys(files).filter((p) => p.endsWith("/index.md")).length).toBe(
      1 + DEFAULT_CATEGORIES.length,
    );
    expect(files["wiki/religion-and-beliefs/index.md"]).toContain("title: Religion and beliefs");
    expect(files["wiki/economy-and-finance/index.md"]).toContain("visibility: private");
    expect(files[".github/workflows/eugenia-publish.yml"]).toContain("target: alice/wiki-public");
  });

  it("produces a valid wiki", async () => {
    const wiki = await memoryWiki(files);
    const problems = await validateWiki(wiki.view, wiki.configProblems);
    expect(problems).toEqual([]);
    // The root, the default categories and the (virtual) library root.
    expect(wiki.tree.nodes.size).toBe(2 + DEFAULT_CATEGORIES.length);
    expect(files[".notes/config.yml"]).toContain("library: library/");
    expect(files[".notes/config.yml"]).toContain("discussions: discussions/");
    expect(files["wiki/history/index.md"]).toContain("type: category");
  });

  it("generates a workflow that uses the publication action", () => {
    expect(publishWorkflow("a/b", { actionRef: "openEugenia/eugenia@main" })).toContain(
      "uses: openEugenia/eugenia@main",
    );
  });
});

describe("validation", () => {
  it("reports incomplete flashcards, broken links and missing personal files", async () => {
    const wiki = await memoryWiki({
      ".notes/config.yml": "root: wiki\ndefault_visibility: nope\n",
      "wiki/index.md": page({ id: "R", title: "R" }, "[Lost](absent/index.md)"),
      "wiki/k/index.md": page({ id: "K", type: "knowledge", title: "Fact" }, "").replace(
        "title: Fact\n",
        "title: Fact\nsources:\n  - ref: UNKNOWN\n  - ref: R\n",
      ),
      "wiki/k/c/index.md": page({ id: "C", type: "flashcard", title: "Card" }, "## Question\nX"),
      "library/book/index.md": page({
        id: "L",
        type: "source",
        title: "Book",
        file: "missing.pdf",
      }),
      "discussions/2026-01-01-1000-x.md": "---\nid: D\ntype: discussion\nabout: ABSENT\n---\n",
    });
    const problems = await validateWiki(wiki.view, wiki.configProblems);
    expect(problems.map((p) => p.code).sort()).toEqual([
      "broken-link",
      "discussion-unknown-node",
      "flashcard-incomplete",
      "invalid-config",
      "knowledge-empty",
      "missing-source-file",
      "not-a-source",
      "unknown-source",
    ]);
    expect(hasErrors(problems)).toBe(true);
  });
});
