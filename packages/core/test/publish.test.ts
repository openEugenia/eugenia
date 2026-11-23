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

const CONFIG = "title: Test wiki\nroot: wiki/\nprivate_repo: alice/wiki\nmastery:\n  alpha: 0.4\n";

const knowledge = page(
  { id: "K", type: "knowledge", title: "Fact", extracted_from: "PRIV" },
  "A public **fact**.",
).replace(
  "extracted_from: PRIV\n",
  "extracted_from: PRIV\nsources:\n  - ref: PUB\n    locator: p. 3\n  - ref: PRIV\n  - ref: GONE\n  - description: Article\n    url: https://example.org\n",
);

const BASE: Files = {
  ".notes/config.yml": CONFIG,
  "wiki/index.md": page(
    { id: "R", title: "Root", visibility: "public" },
    "See [Science](science/index.md) and [Secret](secret/index.md).",
  ),
  "wiki/science/index.md": page(
    { id: "S", title: "Science", visibility: "public" },
    "Image ![photo](photo.png), [notebook](../secret/notebook.pdf) and [article](../../library/article/index.md).",
  ),
  "wiki/science/photo.png": "PNG",
  "wiki/science/fact/index.md": knowledge,
  "wiki/science/fact/card/index.md": page(
    { id: "C", type: "flashcard", title: "Card" },
    "## Question\nWhat?\n\n## Expected answer\nA fact.",
  ),
  // Embeddings of public pages: computed on private content, never published.
  "wiki/_embedding.json": '{"format": "eugenia-embedding"}\n',
  "wiki/science/_embedding.json": '{"format": "eugenia-embedding"}\n',
  "wiki/secret/index.md": page({ id: "P", title: "Secret", visibility: "private" }, "Confidential"),
  "wiki/secret/notebook.pdf": "PDF",
  "library/article/index.md": page(
    {
      id: "PRIV",
      type: "source",
      kind: "article",
      title: "Private article",
      authors: ["Jane Doe"],
      published: "2019",
      url: "https://example.org/article",
      tags: ["personal"],
      file: "article.pdf",
      reading: "unfinished",
    },
    "My private reading notes.",
  ),
  "library/article/article.pdf": "personal PDF",
  "library/article/scan.png": "PNG",
  "library/site/index.md": page(
    {
      id: "PUB",
      type: "source",
      kind: "web",
      title: "Website",
      visibility: "public",
      url: "https://example.org/site",
      file: "copy.pdf",
    },
    "Screenshot: ![screenshot](screenshot.png)",
  ),
  "library/site/copy.pdf": "personal copy",
  "library/site/screenshot.png": "PNG",
  "discussions/2026-01-01-1000-quiz.md":
    "---\nid: Q\ntype: discussion\nkind: quiz\nvisibility: public\n---\n",
  "discussions/2026-01-01-1100-personal.md":
    "---\nid: D1\ntype: discussion\ntitle: Personal\nvisibility: private\n---\n",
  "discussions/2026-01-02-1000-open.md":
    "---\nid: D2\ntype: discussion\nkind: question\ntitle: Open\nvisibility: public\nabout: P\nscope_node: K\n---\n\n## user · 2026-01-02T10:00:00Z\nSee [secret](../wiki/secret/index.md)\n",
};

async function withSummaries(files: Files): Promise<Files> {
  const out = { ...files };
  const wiki = await memoryWiki(out);
  const root = wiki.tree.nodes.get("R")!;
  out["wiki/_summary.md"] = serializeSummary(
    newSummaryDocument({
      id: "SP",
      scope: "private",
      body: "Everything, including the secret.",
      sources: summarySources(wiki.tree, root, "private"),
    }),
  );
  out["wiki/_summary.public.md"] = serializeSummary(
    newSummaryDocument({
      id: "SU",
      scope: "public",
      body: "The public part: [Science](science/index.md).",
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

  it("never publishes embeddings, not even those of public pages", () => {
    expect(wiki.tree.nodes.get("S")!.embedding?.path).toBe("wiki/science/_embedding.json");
    expect(wiki.tree.nodes.get("S")!.attachments.map((a) => a.path)).not.toContain(
      "wiki/science/_embedding.json",
    );
    expect(paths.filter((p) => p.endsWith("_embedding.json"))).toEqual([]);
  });

  it("only publishes public nodes and source records, without quizzes or personal files", () => {
    expect(publication.ok).toBe(true);
    expect(paths).toEqual([
      ".notes/config.yml",
      ".notes/index.json",
      "README.md",
      "discussions/2026-01-02-1000-open.md",
      "library/article/index.md",
      "library/site/index.md",
      "library/site/screenshot.png",
      "wiki/_summary.md",
      "wiki/index.md",
      "wiki/science/fact/card/index.md",
      "wiki/science/fact/index.md",
      "wiki/science/index.md",
      "wiki/science/photo.png",
    ]);
    expect(publication.stats).toMatchObject({
      knowledge: 1,
      flashcards: 1,
      sources: 1,
      records: 1,
    });
  });

  it("publishes only the bibliographic record of a private source", () => {
    const record = content(publication.files, "library/article/index.md")!;
    const doc = parsePage(record);
    expect(doc.fields).toEqual({
      id: "PRIV",
      type: "source",
      kind: "article",
      title: "Private article",
      visibility: "private",
      authors: ["Jane Doe"],
      published: "2019",
      url: "https://example.org/article",
    });
    expect(doc.extra).toEqual({});
    expect(doc.body).toBe("");
    expect(record).not.toContain("reading notes");
    expect(record).not.toContain("article.pdf");
    expect(record).not.toContain("personal");
  });

  it("publishes the public description as _summary.md", () => {
    const summary = parseSummary(content(publication.files, "wiki/_summary.md")!);
    expect(summary.fields.scope).toBe("public");
    expect(summary.body).toBe("The public part: [Science](science/index.md).\n");
  });

  it("turns links to unpublished content into text, but keeps links to source records", () => {
    expect(parsePage(content(publication.files, "wiki/index.md")!).body).toBe(
      "See [Science](science/index.md) and Secret.\n",
    );
    const science = parsePage(content(publication.files, "wiki/science/index.md")!);
    expect(science.body).toBe(
      "Image ![photo](photo.png), notebook and [article](../../library/article/index.md).\n",
    );
    const discussion = content(publication.files, "discussions/2026-01-02-1000-open.md")!;
    expect(discussion).toContain("See secret");
    expect(discussion).not.toContain("about:");
    expect(discussion).toContain("scope_node: K");
  });

  it("keeps citations of private sources, drops unknown ones and personal files", () => {
    const fact = parsePage(content(publication.files, "wiki/science/fact/index.md")!);
    expect(fact.fields.sources).toEqual([
      { ref: "PUB", locator: "p. 3" },
      { ref: "PRIV" },
      { description: "Article", url: "https://example.org" },
    ]);
    expect(fact.fields.extracted_from).toBe("PRIV");
    const site = parsePage(content(publication.files, "library/site/index.md")!);
    expect(site.fields.file).toBeUndefined();
    expect(site.fields.url).toBe("https://example.org/site");
  });

  it("publishes a configuration without personal settings, and an index", () => {
    const config = content(publication.files, ".notes/config.yml")!;
    expect(config).toContain("private_repo: alice/wiki");
    expect(config).not.toContain("mastery");
    expect(publication.index.nodes.map((n) => n.id).sort()).toEqual([
      "C",
      "K",
      "PRIV",
      "PUB",
      "R",
      "S",
    ]);
    expect(publication.index.nodes.find((n) => n.id === "K")).toMatchObject({
      type: "knowledge",
      refs: ["PUB", "PRIV"],
      sourced: true,
      extracted_from: "PRIV",
    });
    expect(publication.index.nodes.find((n) => n.id === "PUB")).toMatchObject({
      type: "source",
      kind: "web",
      visibility: "public",
      parent: "virtual:library",
    });
    expect(publication.index.nodes.find((n) => n.id === "PRIV")).toEqual({
      id: "PRIV",
      path: "library/article",
      type: "source",
      title: "Private article",
      visibility: "private",
      parent: "virtual:library",
      kind: "article",
      authors: ["Jane Doe"],
      url: "https://example.org/article",
      published: "2019",
    });
    expect(publication.index.discussionList.map((d) => d.id)).toEqual(["D2"]);
    expect(publication.index.nodes.find((n) => n.id === "R")!.description).toBe(
      "The public part: Science.",
    );
    expect(publication.index.files.map((f) => f.path)).not.toContain(".notes/index.json");
    expect(publication.index.files.every((f) => /^[0-9a-f]{40}$/.test(f.sha))).toBe(true);
  });

  it("does not publish the record of an unreadable private source", async () => {
    const bad = await memoryWiki({
      ...files,
      "library/article/index.md": "---\ntitle: [oops\n---\nNotes",
    });
    const result = await buildPublication(bad.view);
    expect(result.ok).toBe(true);
    expect(result.files.some((f) => f.path === "library/article/index.md")).toBe(false);
    expect(result.problems.some((p) => p.code === "unreadable-source-record")).toBe(true);
  });

  it("refuses a public description generated from a private node", async () => {
    const leaked = parseSummary(files["wiki/_summary.public.md"]!);
    leaked.fields.sources.P = "abcdef0";
    const bad = await memoryWiki({ ...files, "wiki/_summary.public.md": serializeSummary(leaked) });
    const result = await buildPublication(bad.view);
    expect(result.ok).toBe(false);
    expect(result.problems.find((p) => p.level === "error")?.code).toBe("summary-leak");
    expect(result.files.some((f) => f.path === "wiki/_summary.md")).toBe(false);
  });

  it("refuses a tree that breaks rule 3", async () => {
    const bad = await memoryWiki({
      ...files,
      "wiki/secret/leak/index.md": page({ id: "F", title: "Leak", visibility: "public" }),
    });
    const result = await buildPublication(bad.view);
    expect(result.ok).toBe(false);
    expect(result.problems.some((p) => p.code === "public-under-private")).toBe(true);
  });

  it("refuses a public page whose frontmatter is unreadable", async () => {
    const bad = await memoryWiki({
      ...files,
      "wiki/science/broken/index.md": "---\ntitle: [oops\n---\nText",
    });
    const result = await buildPublication(bad.view);
    expect(result.ok).toBe(false);
  });
});
