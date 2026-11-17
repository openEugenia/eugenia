import { describe, expect, it } from "vitest";
import { ancestors, children, descendants, flashcardsUnder, nodeForPath } from "../src/index.ts";
import { CONFIG, memoryWiki, page } from "./helpers.ts";

const FILES = {
  ".notes/config.yml": CONFIG,
  "wiki/index.md": page(
    { id: "R", type: "note", title: "Racine", visibility: "public" },
    "Bienvenue.",
  ),
  "wiki/_summary.md": page({ id: "S1", type: "summary", scope: "private" }, "Résumé."),
  "wiki/zeta/index.md": page({ id: "Z", title: "Zêta" }),
  "wiki/alpha/index.md": page({ id: "A", title: "Alpha", visibility: "public", order: 5 }),
  "wiki/beta/index.md": page({ id: "B", title: "Bêta", order: 1, visibility: "private" }),
  "wiki/alpha/carte/index.md": page({ id: "C", type: "flashcard", title: "Carte" }),
  "wiki/alpha/photo.png": "png",
  "wiki/alpha/images/schema.svg": "<svg/>",
  "wiki/alpha/_quizzes/2026-01-01-1000.md": "---\nid: Q\ntype: discussion\nkind: quiz\n---\n",
  "wiki/alpha/_discussions/2026-01-01-x.md": "---\nid: D\ntype: discussion\n---\n",
  "wiki/vide/sous/index.md": page({ id: "V", title: "Sous" }),
  "wiki/_brouillons/x/index.md": page({ id: "X", title: "Caché" }),
  "README.md": "# hors racine",
};

describe("arbre", async () => {
  const { tree } = await memoryWiki(FILES);

  it("construit la hiérarchie et ignore les dossiers réservés", () => {
    expect(tree.rootId).toBe("R");
    expect(tree.nodes.has("X")).toBe(false);
    expect(children(tree, "R").map((n) => n.id)).toEqual(["B", "A", "virtual:wiki/vide", "Z"]);
  });

  it("trie par ordre puis par titre", () => {
    const titles = children(tree, "R").map((n) => n.title);
    expect(titles).toEqual(["Bêta", "Alpha", "Vide", "Zêta"]);
  });

  it("crée des nœuds virtuels pour les dossiers sans index.md", () => {
    const vide = tree.nodes.get("virtual:wiki/vide")!;
    expect(vide.virtual).toBe(true);
    expect(vide.childIds).toEqual(["V"]);
    expect(tree.problems.some((p) => p.code === "missing-index")).toBe(true);
  });

  it("rattache descriptions, quiz, discussions et pièces jointes", () => {
    const root = tree.nodes.get("R")!;
    const alpha = tree.nodes.get("A")!;
    expect(root.summaries.private?.path).toBe("wiki/_summary.md");
    expect(alpha.quizzes.map((f) => f.path)).toEqual(["wiki/alpha/_quizzes/2026-01-01-1000.md"]);
    expect(alpha.discussions.length).toBe(1);
    expect(alpha.attachments.map((f) => f.path)).toEqual([
      "wiki/alpha/images/schema.svg",
      "wiki/alpha/photo.png",
    ]);
  });

  it("calcule la visibilité effective par héritage", () => {
    expect(tree.nodes.get("A")!.isPublic).toBe(true);
    expect(tree.nodes.get("C")!.visibility).toBe("public");
    expect(tree.nodes.get("C")!.isPublic).toBe(true);
    expect(tree.nodes.get("B")!.isPublic).toBe(false);
    expect(tree.nodes.get("Z")!.visibility).toBe("public");
  });

  it("parcourt ancêtres, descendants et flashcards", () => {
    expect(ancestors(tree, "C").map((n) => n.id)).toEqual(["R", "A"]);
    expect(descendants(tree, "A").map((n) => n.id)).toEqual(["C"]);
    expect(flashcardsUnder(tree, "R").map((n) => n.id)).toEqual(["C"]);
    expect(nodeForPath(tree, "wiki/alpha/carte/index.md")?.id).toBe("C");
  });

  it("signale un nœud public sous un ancêtre privé", async () => {
    const { tree: t } = await memoryWiki({
      ...FILES,
      "wiki/beta/pub/index.md": page({ id: "P", title: "Pub", visibility: "public" }),
    });
    const problem = t.problems.find((p) => p.code === "public-under-private");
    expect(problem?.nodeId).toBe("P");
    expect(t.nodes.get("P")!.isPublic).toBe(false);
  });

  it("signale les identifiants manquants ou dupliqués", async () => {
    const { tree: t } = await memoryWiki({
      ".notes/config.yml": CONFIG,
      "wiki/index.md": page({ id: "R", title: "R" }),
      "wiki/a/index.md": page({ id: "A", title: "A" }),
      "wiki/b/index.md": page({ id: "A", title: "B" }),
      "wiki/c/index.md": page({ title: "C" }),
    });
    expect(t.problems.map((p) => p.code).sort()).toEqual(["duplicate-id", "missing-id"]);
    expect(t.nodes.size).toBe(4);
  });
});
