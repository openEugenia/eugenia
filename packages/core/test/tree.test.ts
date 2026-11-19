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
    { id: "R", type: "category", title: "Racine", visibility: "public" },
    "Bienvenue.",
  ),
  "wiki/_summary.md": page({ id: "S1", type: "summary", scope: "private" }, "Résumé."),
  "wiki/zeta/index.md": page({ id: "Z", title: "Zêta" }),
  "wiki/alpha/index.md": page({ id: "A", title: "Alpha", visibility: "public", order: 5 }),
  "wiki/beta/index.md": page({ id: "B", title: "Bêta", order: 1, visibility: "private" }),
  "wiki/alpha/savoir/index.md": page(
    { id: "K", type: "knowledge", title: "Savoir" },
    "Un **savoir**.",
  ),
  "wiki/alpha/savoir/carte/index.md": page({ id: "C", type: "flashcard", title: "Carte" }),
  "wiki/alpha/photo.png": "png",
  "wiki/alpha/images/schema.svg": "<svg/>",
  "wiki/vide/sous/index.md": page({ id: "V", title: "Sous" }),
  "wiki/_brouillons/x/index.md": page({ id: "X", title: "Caché" }),
  "library/livre/index.md": page({ id: "L", type: "source", kind: "book", title: "Livre" }),
  "library/livre/livre.pdf": "pdf",
  "library/site/index.md": page({ id: "W", title: "Site", visibility: "public" }),
  "discussions/2026-01-01-1000-quiz.md": "---\nid: Q\ntype: discussion\nkind: quiz\n---\n",
  "discussions/2026-01-02-0900-x.md": "---\nid: D\ntype: discussion\n---\n",
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

  it("type les pages selon leur espace", () => {
    expect(tree.nodes.get("Z")!.type).toBe("category");
    expect(tree.nodes.get("K")!.type).toBe("knowledge");
    expect(tree.nodes.get("C")!.type).toBe("flashcard");
    expect(tree.nodes.get("W")!.type).toBe("source");
    expect(tree.nodes.get("W")!.space).toBe("library");
    expect(tree.nodes.get("L")!.sourceKind).toBe("book");
  });

  it("rassemble la bibliothèque sous sa racine, à plat", () => {
    const library = tree.nodes.get(tree.libraryId)!;
    expect(library.virtual).toBe(true);
    expect(library.title).toBe("Bibliothèque");
    expect(library.childIds).toEqual(["L", "W"]);
    expect(
      librarySources(tree)
        .map((n) => n.id)
        .sort(),
    ).toEqual(["L", "W"]);
    expect(tree.nodes.get("L")!.attachments.map((f) => f.path)).toEqual([
      "library/livre/livre.pdf",
    ]);
  });

  it("liste les discussions, de la plus récente à la plus ancienne", () => {
    expect(tree.discussions.map((f) => f.path)).toEqual([
      "discussions/2026-01-02-0900-x.md",
      "discussions/2026-01-01-1000-quiz.md",
    ]);
  });

  it("rattache descriptions et pièces jointes", () => {
    const root = tree.nodes.get("R")!;
    const alpha = tree.nodes.get("A")!;
    expect(root.summaries.private?.path).toBe("wiki/_summary.md");
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
    // Chaque source a sa propre visibilité (privée par défaut).
    expect(tree.nodes.get("W")!.isPublic).toBe(true);
    expect(tree.nodes.get("L")!.isPublic).toBe(false);
  });

  it("parcourt ancêtres, descendants, connaissances et flashcards", () => {
    expect(ancestors(tree, "C").map((n) => n.id)).toEqual(["R", "A", "K"]);
    expect(descendants(tree, "A").map((n) => n.id)).toEqual(["K", "C"]);
    expect(flashcardsUnder(tree, "R").map((n) => n.id)).toEqual(["C"]);
    expect(knowledgeUnder(tree, "R").map((n) => n.id)).toEqual(["K"]);
    expect(knowledgeOf(tree, tree.nodes.get("C")!)?.id).toBe("K");
    expect(nodeForPath(tree, "wiki/alpha/savoir/carte/index.md")?.id).toBe("C");
  });

  it("encadre le rangement des pages", () => {
    const card = tree.nodes.get("C")!;
    const knowledge = tree.nodes.get("K")!;
    const source = tree.nodes.get("L")!;
    expect(placementProblem(tree, card, "K")).toBeNull();
    expect(placementProblem(tree, card, "A")).toMatch(/connaissance/);
    expect(placementProblem(tree, knowledge, "Z")).toBeNull();
    expect(placementProblem(tree, knowledge, "K")).toMatch(/que des flashcards/);
    expect(placementProblem(tree, knowledge, tree.libraryId)).toMatch(/bibliothèque/);
    expect(placementProblem(tree, source, tree.libraryId)).toBeNull();
    expect(placementProblem(tree, source, "A")).toMatch(/bibliothèque/);
  });

  it("signale les pages mal rangées", async () => {
    const { tree: t } = await memoryWiki({
      ...FILES,
      "wiki/alpha/orpheline/index.md": page({ id: "O", type: "flashcard", title: "Orpheline" }),
      "wiki/alpha/savoir/sous/index.md": page({ id: "S", title: "Sous-catégorie" }),
      "library/livre/chapitre/index.md": page({ id: "CH", title: "Chapitre" }),
      "wiki/source/index.md": page({ id: "SW", type: "source", title: "Source égarée" }),
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
    // Quatre pages du wiki et la racine (virtuelle) de la bibliothèque.
    expect(t.nodes.size).toBe(5);
  });
});
