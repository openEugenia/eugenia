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
  "wiki/index.md": page({ id: "R", title: "Root" }),
  "wiki/a/index.md": page({ id: "A", title: "A" }),
  "wiki/a/b/index.md": page({ id: "B", title: "B" }),
  "wiki/a/b/c/index.md": page({ id: "C", title: "C" }),
  "wiki/a/b/d/index.md": page({ id: "D", title: "D", visibility: "public" }),
};

describe("visibility", async () => {
  const wiki = await memoryWiki(FILES);

  it("offers to make the whole branch public up to the root", () => {
    const plan = planMakePublic(wiki.tree, "B");
    expect(plan.privateAncestors.map((n) => n.id)).toEqual(["R", "A"]);
    expect(plan.descendants.map((n) => n.id)).toEqual(["C", "D"]);
  });

  it("changes nothing without confirmation for the ancestors", () => {
    expect(makePublicAssignments(wiki.tree, "B", new Set(), false).size).toBe(0);
  });

  it("makes the branch and only the checked descendants public", async () => {
    const assignments = makePublicAssignments(wiki.tree, "B", new Set(["D"]), true);
    // Only nodes whose effective visibility would change are written (inheritance, rule 2).
    expect(Object.fromEntries(assignments)).toEqual({ R: "public", C: "private" });
    const changes = await applyVisibility(wiki.view, assignments);
    const after = await memoryWiki(applyChanges(FILES, changes));
    const t = after.tree;
    expect(["R", "A", "B", "D"].every((id) => t.nodes.get(id)!.isPublic)).toBe(true);
    expect(t.nodes.get("C")!.isPublic).toBe(false);
    expect(t.problems.filter((p) => p.code === "public-under-private")).toEqual([]);
  });

  it("makes a node and its public descendants private", async () => {
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

  it("a new tree computation stays consistent with the metadata", () => {
    const metas = new Map([["wiki/index.md", pageMeta(FILES["wiki/index.md"])]]);
    const tree = buildTree({
      config: wiki.config,
      files: [{ path: "wiki/index.md", sha: "x" }],
      metas,
    });
    expect(tree.nodes.get("R")!.visibility).toBe("private");
  });

  it("makes a source public without touching the library root", async () => {
    const files = {
      ...FILES,
      "library/book/index.md": page({ id: "L", type: "source", title: "Book" }),
    };
    const w = await memoryWiki(files);
    expect(planMakePublic(w.tree, "L").privateAncestors).toEqual([]);
    const assignments = makePublicAssignments(w.tree, "L", new Set(), false);
    expect(Object.fromEntries(assignments)).toEqual({ L: "public" });
    const after = await memoryWiki(applyChanges(files, await applyVisibility(w.view, assignments)));
    expect(after.tree.nodes.get("L")!.isPublic).toBe(true);
    expect(Object.keys(after.source).some((p) => p === "library/index.md")).toBe(false);
  });
});
