import { describe, expect, it } from "vitest";
import {
  buildPublication,
  newSummaryDocument,
  parsePage,
  parseSummary,
  serializeSummary,
  summarySources,
  type PublishedFile,
} from "../src/index.ts";
import { memoryWiki, page, type Files } from "./helpers.ts";

const CONFIG =
  "title: Wiki de test\nroot: wiki/\nprivate_repo: alice/wiki\nmastery:\n  alpha: 0.4\n";

const BASE: Files = {
  ".notes/config.yml": CONFIG,
  "wiki/index.md": page(
    { id: "R", title: "Racine", visibility: "public" },
    "Voir [Science](science/index.md) et [Secret](secret/index.md).",
  ),
  "wiki/science/index.md": page(
    { id: "S", title: "Science", visibility: "public", extracted_from: "P" },
    "Image ![photo](photo.png) et [carnet](../secret/carnet.pdf).",
  ).replace(
    "extracted_from: P\n",
    "extracted_from: P\nsources:\n  - description: Article\n    url: https://example.org\n    file: article.pdf\n",
  ),
  "wiki/science/photo.png": "PNG",
  // Embeddings de pages publiques : calculés sur le contenu privé, jamais publiés.
  "wiki/_embedding.json": '{"format": "eugenia-embedding"}\n',
  "wiki/science/_embedding.json": '{"format": "eugenia-embedding"}\n',
  "wiki/science/article.pdf": "PDF personnel",
  "wiki/science/_quizzes/2026-01-01-1000.md": "---\nid: Q\ntype: discussion\nkind: quiz\n---\n",
  "wiki/science/_discussions/2026-01-01-perso.md":
    "---\nid: D1\ntype: discussion\ntitle: Perso\nvisibility: private\n---\n",
  "wiki/science/_discussions/2026-01-02-ouverte.md":
    "---\nid: D2\ntype: discussion\ntitle: Ouverte\nvisibility: public\nabout: P\n---\n\n## user · 2026-01-02T10:00:00Z\nVoir [secret](../../secret/index.md)\n",
  "wiki/secret/index.md": page({ id: "P", title: "Secret", visibility: "private" }, "Confidentiel"),
  "wiki/secret/carnet.pdf": "PDF",
};

async function withSummaries(files: Files): Promise<Files> {
  const out = { ...files };
  const wiki = await memoryWiki(out);
  const root = wiki.tree.nodes.get("R")!;
  out["wiki/_summary.md"] = serializeSummary(
    newSummaryDocument({
      id: "SP",
      scope: "private",
      body: "Tout, y compris le secret.",
      sources: summarySources(wiki.tree, root, "private"),
    }),
  );
  out["wiki/_summary.public.md"] = serializeSummary(
    newSummaryDocument({
      id: "SU",
      scope: "public",
      body: "La partie publique : [Science](science/index.md).",
      sources: summarySources(wiki.tree, root, "public"),
    }),
  );
  return out;
}

function content(files: PublishedFile[], path: string): string | undefined {
  const file = files.find((f) => f.path === path);
  return file && "content" in file ? file.content : undefined;
}

describe("publication", async () => {
  const files = await withSummaries(BASE);
  const wiki = await memoryWiki(files);
  const publication = await buildPublication(wiki.view, {
    publicRepo: "alice/wiki-public",
    now: new Date("2026-11-17T12:00:00Z"),
  });
  const paths = publication.files.map((f) => f.path).sort();

  it("ne publie jamais les embeddings, même ceux des pages publiques", () => {
    expect(wiki.tree.nodes.get("S")!.embedding?.path).toBe("wiki/science/_embedding.json");
    expect(wiki.tree.nodes.get("S")!.attachments.map((a) => a.path)).not.toContain(
      "wiki/science/_embedding.json",
    );
    expect(paths.filter((p) => p.endsWith("_embedding.json"))).toEqual([]);
  });

  it("ne publie que les nœuds publics, sans quiz ni fichiers personnels", () => {
    expect(publication.ok).toBe(true);
    expect(paths).toEqual([
      ".notes/config.yml",
      ".notes/index.json",
      "README.md",
      "wiki/_summary.md",
      "wiki/index.md",
      "wiki/science/_discussions/2026-01-02-ouverte.md",
      "wiki/science/index.md",
      "wiki/science/photo.png",
    ]);
  });

  it("publie la description publique sous le nom _summary.md", () => {
    const summary = parseSummary(content(publication.files, "wiki/_summary.md")!);
    expect(summary.fields.scope).toBe("public");
    expect(summary.body).toBe("La partie publique : [Science](science/index.md).\n");
  });

  it("transforme en texte les liens vers ce qui n'est pas publié", () => {
    expect(parsePage(content(publication.files, "wiki/index.md")!).body).toBe(
      "Voir [Science](science/index.md) et Secret.\n",
    );
    const science = parsePage(content(publication.files, "wiki/science/index.md")!);
    expect(science.body).toBe("Image ![photo](photo.png) et carnet.\n");
    expect(science.fields.sources).toEqual([
      { description: "Article", url: "https://example.org" },
    ]);
    expect(science.fields.extracted_from).toBeUndefined();
    const discussion = content(
      publication.files,
      "wiki/science/_discussions/2026-01-02-ouverte.md",
    )!;
    expect(discussion).toContain("Voir secret");
    expect(discussion).not.toContain("about:");
  });

  it("publie une configuration sans paramètres personnels et un index", () => {
    const config = content(publication.files, ".notes/config.yml")!;
    expect(config).toContain("private_repo: alice/wiki");
    expect(config).not.toContain("mastery");
    expect(publication.index.nodes.map((n) => n.id).sort()).toEqual(["R", "S"]);
    expect(publication.index.nodes.find((n) => n.id === "R")!.description).toBe(
      "La partie publique : Science.",
    );
    expect(publication.index.files.map((f) => f.path)).not.toContain(".notes/index.json");
    expect(publication.index.files.every((f) => /^[0-9a-f]{40}$/.test(f.sha))).toBe(true);
  });

  it("refuse une description publique générée à partir d'un nœud privé", async () => {
    const leaked = parseSummary(files["wiki/_summary.public.md"]!);
    leaked.fields.sources.P = "abcdef0";
    const bad = await memoryWiki({ ...files, "wiki/_summary.public.md": serializeSummary(leaked) });
    const result = await buildPublication(bad.view);
    expect(result.ok).toBe(false);
    expect(result.problems.find((p) => p.level === "error")?.code).toBe("summary-leak");
    expect(result.files.some((f) => f.path === "wiki/_summary.md")).toBe(false);
  });

  it("refuse une arborescence qui viole la règle 3", async () => {
    const bad = await memoryWiki({
      ...files,
      "wiki/secret/fuite/index.md": page({ id: "F", title: "Fuite", visibility: "public" }),
    });
    const result = await buildPublication(bad.view);
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.code === "public-under-private")).toBe(true);
  });

  it("refuse une page publique dont le frontmatter est illisible", async () => {
    const bad = await memoryWiki({
      ...files,
      "wiki/science/casse/index.md": "---\ntitle: [oups\n---\nTexte",
    });
    const result = await buildPublication(bad.view);
    expect(result.ok).toBe(false);
  });
});
