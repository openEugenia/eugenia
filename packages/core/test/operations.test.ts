import { describe, expect, it } from "vitest";
import {
  createPage,
  deleteNode,
  moveNode,
  OperationError,
  parsePage,
  updatePage,
} from "../src/index.ts";
import { applyChanges, CONFIG, memoryWiki, page } from "./helpers.ts";

const FILES = {
  ".notes/config.yml": CONFIG,
  "wiki/index.md": page({ id: "R", title: "Racine", visibility: "public" }),
  "wiki/a/index.md": page({ id: "A", title: "A" }, "[B](../b/index.md) et [C](c/index.md)"),
  "wiki/a/c/index.md": page({ id: "C", title: "C" }, "[Haut](../index.md) [B](../../b/index.md)"),
  "wiki/a/image.png": "PNG",
  "wiki/a/_discussions/2026-01-01-x.md":
    "---\nid: D\ntype: discussion\n---\n\n## user · 2026-01-01T10:00:00Z\nVoir [C](../c/index.md)\n",
  "wiki/b/index.md": page({ id: "B", title: "B" }, "[A](../a/index.md) [C](../a/c/index.md#x)"),
};

describe("opérations d'édition", async () => {
  const wiki = await memoryWiki(FILES);

  it("crée une page avec un nom de dossier unique", () => {
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

  it("renomme le dossier quand le titre change et réécrit les liens entrants", async () => {
    const changes = await updatePage(wiki.view, "A", { title: "Alpha" });
    const out = applyChanges(FILES, changes);
    expect(Object.keys(out).filter((p) => p.startsWith("wiki/a/"))).toEqual([]);
    expect(out["wiki/alpha/image.png"]).toBe("PNG");
    expect(parsePage(out["wiki/alpha/index.md"]!).fields.title).toBe("Alpha");
    expect(parsePage(out["wiki/alpha/index.md"]!).body).toBe(
      "[B](../b/index.md) et [C](c/index.md)\n",
    );
    expect(parsePage(out["wiki/b/index.md"]!).body).toBe(
      "[A](../alpha/index.md) [C](../alpha/c/index.md#x)\n",
    );
    expect(out["wiki/alpha/_discussions/2026-01-01-x.md"]).toContain("[C](../c/index.md)");
  });

  it("ne renomme pas si le nom de dossier ne change pas", async () => {
    const changes = await updatePage(wiki.view, "A", { title: "a", body: "Nouveau" });
    expect(changes.map((c) => [c.op, c.path])).toEqual([["write", "wiki/a/index.md"]]);
  });

  it("déplace une branche et recalcule les liens dans les deux sens", async () => {
    const out = applyChanges(FILES, await moveNode(wiki.view, "C", "B"));
    // Le lien vers B reste valide depuis le nouvel emplacement : il est conservé tel quel.
    expect(parsePage(out["wiki/b/c/index.md"]!).body).toBe(
      "[Haut](../../a/index.md) [B](../../b/index.md)\n",
    );
    expect(parsePage(out["wiki/a/index.md"]!).body).toBe(
      "[B](../b/index.md) et [C](../b/c/index.md)\n",
    );
    expect(parsePage(out["wiki/b/index.md"]!).body).toBe("[A](../a/index.md) [C](c/index.md#x)\n");
    expect(out["wiki/a/_discussions/2026-01-01-x.md"]).toContain("[C](../../b/c/index.md)");
    expect(out["wiki/a/c/index.md"]).toBeUndefined();
  });

  it("refuse de déplacer une page dans sa propre branche", async () => {
    await expect(moveNode(wiki.view, "A", "C")).rejects.toBeInstanceOf(OperationError);
  });

  it("rend privée une branche publique déplacée sous un parent privé", async () => {
    const files = {
      ...FILES,
      "wiki/a/c/index.md": page({ id: "C", title: "C", visibility: "public" }),
      "wiki/b/index.md": page({ id: "B", title: "B", visibility: "private" }),
    };
    const w = await memoryWiki(files);
    const out = applyChanges(files, await moveNode(w.view, "C", "B"));
    expect(parsePage(out["wiki/b/c/index.md"]!).fields.visibility).toBe("private");
  });

  it("supprime une branche et transforme les liens entrants en texte", async () => {
    await expect(deleteNode(wiki.view, "A")).rejects.toBeInstanceOf(OperationError);
    const out = applyChanges(FILES, await deleteNode(wiki.view, "A", { recursive: true }));
    expect(Object.keys(out).some((p) => p.startsWith("wiki/a/"))).toBe(false);
    expect(parsePage(out["wiki/b/index.md"]!).body).toBe("A C\n");
  });
});
