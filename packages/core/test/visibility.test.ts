import { describe, expect, it } from "vitest";
import {
  applyVisibility,
  buildTree,
  makePrivateAssignments,
  makePublicAssignments,
  pageMeta,
  planMakePublic,
} from "../src/index.ts";
import { applyChanges, CONFIG, memoryWiki, page } from "./helpers.ts";

const FILES = {
  ".notes/config.yml": CONFIG,
  "wiki/index.md": page({ id: "R", title: "Racine" }),
  "wiki/a/index.md": page({ id: "A", title: "A" }),
  "wiki/a/b/index.md": page({ id: "B", title: "B" }),
  "wiki/a/b/c/index.md": page({ id: "C", title: "C" }),
  "wiki/a/b/d/index.md": page({ id: "D", title: "D", visibility: "public" }),
};

describe("visibilité", async () => {
  const wiki = await memoryWiki(FILES);

  it("propose de rendre publique toute la branche jusqu'à la racine", () => {
    const plan = planMakePublic(wiki.tree, "B");
    expect(plan.privateAncestors.map((n) => n.id)).toEqual(["R", "A"]);
    expect(plan.descendants.map((n) => n.id)).toEqual(["C", "D"]);
  });

  it("ne change rien sans confirmation pour les ancêtres", () => {
    expect(makePublicAssignments(wiki.tree, "B", new Set(), false).size).toBe(0);
  });

  it("rend publics la branche et les seuls descendants cochés", async () => {
    const assignments = makePublicAssignments(wiki.tree, "B", new Set(["D"]), true);
    // Seuls les nœuds dont la visibilité effective changerait sont écrits (héritage, règle 2).
    expect(Object.fromEntries(assignments)).toEqual({ R: "public", C: "private" });
    const changes = await applyVisibility(wiki.view, assignments);
    const after = await memoryWiki(applyChanges(FILES, changes));
    const t = after.tree;
    expect(["R", "A", "B", "D"].every((id) => t.nodes.get(id)!.isPublic)).toBe(true);
    expect(t.nodes.get("C")!.isPublic).toBe(false);
    expect(t.problems.filter((p) => p.code === "public-under-private")).toEqual([]);
  });

  it("rend privés un nœud et ses descendants publics", async () => {
    const pub = await memoryWiki(
      applyChanges(
        FILES,
        await applyVisibility(
          wiki.view,
          makePublicAssignments(wiki.tree, "B", new Set(["C", "D"]), true),
        ),
      ),
    );
    const assignments = makePrivateAssignments(pub.tree, "A");
    const after = await memoryWiki(
      applyChanges(pub.source, await applyVisibility(pub.view, assignments)),
    );
    expect(["A", "B", "C", "D"].some((id) => after.tree.nodes.get(id)!.isPublic)).toBe(false);
    expect(after.tree.nodes.get("R")!.isPublic).toBe(true);
  });

  it("un nouveau calcul d'arbre reste cohérent avec les métadonnées", () => {
    const metas = new Map([["wiki/index.md", pageMeta(FILES["wiki/index.md"])]]);
    const tree = buildTree({
      config: wiki.config,
      files: [{ path: "wiki/index.md", sha: "x" }],
      metas,
    });
    expect(tree.nodes.get("R")!.visibility).toBe("private");
  });
});
