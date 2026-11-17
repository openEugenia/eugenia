import { describe, expect, it } from "vitest";
import {
  DEFAULT_CATEGORIES,
  hasErrors,
  publishWorkflow,
  scaffoldWiki,
  validateWiki,
} from "../src/index.ts";
import { memoryWiki, page } from "./helpers.ts";

describe("initialisation", () => {
  const files = Object.fromEntries(
    scaffoldWiki({
      title: "Mon wiki",
      privateRepo: "alice/wiki",
      publicRepo: "alice/wiki-public",
      now: new Date("2026-11-17T10:00:00Z"),
    }),
  );

  it("crée la configuration, la racine, les catégories par défaut et le workflow", () => {
    expect(files[".notes/config.yml"]).toContain("private_repo: alice/wiki");
    expect(Object.keys(files).filter((p) => p.endsWith("/index.md")).length).toBe(
      1 + DEFAULT_CATEGORIES.length,
    );
    expect(files["wiki/religion-et-croyances/index.md"]).toContain("title: Religion et croyances");
    expect(files["wiki/economie-et-finance/index.md"]).toContain("visibility: private");
    expect(files[".github/workflows/eugenia-publish.yml"]).toContain("target: alice/wiki-public");
  });

  it("produit un wiki valide", async () => {
    const wiki = await memoryWiki(files);
    const problems = await validateWiki(wiki.view, wiki.configProblems);
    expect(problems).toEqual([]);
    expect(wiki.tree.nodes.size).toBe(16);
  });

  it("génère un workflow qui utilise l'action de publication", () => {
    expect(publishWorkflow("a/b", { actionRef: "openEugenia/eugenia@main" })).toContain(
      "uses: openEugenia/eugenia@main",
    );
  });
});

describe("validation", () => {
  it("signale flashcards incomplètes, liens cassés et fichiers personnels absents", async () => {
    const wiki = await memoryWiki({
      ".notes/config.yml": "root: wiki\ndefault_visibility: nope\n",
      "wiki/index.md": page({ id: "R", title: "R" }, "[Perdu](absent/index.md)"),
      "wiki/c/index.md": page(
        { id: "C", type: "flashcard", title: "Carte" },
        "## Connaissance\nX",
      ).replace("title: Carte\n", "title: Carte\nsources:\n  - file: manquant.pdf\n"),
    });
    const problems = await validateWiki(wiki.view, wiki.configProblems);
    expect(problems.map((p) => p.code).sort()).toEqual([
      "broken-link",
      "flashcard-incomplete",
      "invalid-config",
      "missing-source-file",
    ]);
    expect(hasErrors(problems)).toBe(true);
  });
});
