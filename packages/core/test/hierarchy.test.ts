import { describe, expect, it } from "vitest";
import {
  buildHierarchy,
  buildIndex,
  buildPublication,
  cosineSimilarity,
  deleteNode,
  discussionInBranch,
  embeddingChanges,
  discussionsInBranch,
  findIndexNode,
  hierarchyAncestors,
  indexAncestry,
  indexKnowledge,
  isInBranch,
  metasFromIndex,
  normalizeKnowledgeTree,
  parsePage,
  parseSectionEmbeddings,
  parseSectionId,
  readSourceIndex,
  sectionId,
  sourceIndexChanges,
  sourceIndexState,
  sourceIndexStatus,
  sourceIndexText,
  sourceIndexTextSha,
  sourceSections,
  sourcesIn,
  sourcesInBranch,
  updatePage,
  validateWiki,
  vectorItems,
  type KnowledgeNode,
} from "../src/index.ts";
import { applyChanges, memoryWiki, page, type Files } from "./helpers.ts";

const CONFIG = "title: Test\nroot: wiki/\n";

const TREE: KnowledgeNode = {
  name: "Article on Lilith",
  description: "The figure of Lilith, from Mesopotamia to astrology.",
  children: [
    {
      name: "Origins",
      description: "Lilith comes from Mesopotamian demonology.",
      knowledge: [
        {
          title: "Mesopotamian origin of Lilith",
          statement: "**Lilith** comes from Mesopotamian demonology.",
          question: "Where does the figure of Lilith come from?",
          answer: "Mesopotamian demonology",
        },
      ],
      children: [{ name: "Lilitu", description: "Mesopotamian wind demons.", children: [] }],
    },
    { name: "Black Moon", description: "In astrology, the apogee of the Moon.", children: [] },
  ],
};

function discussion(fields: Record<string, string>, body = ""): string {
  const lines = Object.entries(fields).map(([k, v]) => `${k}: ${v}`);
  return `---\ntype: discussion\n${lines.join("\n")}\n---\n${body ? `\n${body}\n` : ""}`;
}

const BASE: Files = {
  ".notes/config.yml": CONFIG,
  "wiki/index.md": page({ id: "R", title: "Root", visibility: "public" }),
  "wiki/religion/index.md": page({ id: "REL", title: "Religion", visibility: "public" }),
  "wiki/religion/myths/index.md": page({ id: "MYT", title: "Myths", visibility: "private" }),
  "wiki/religion/myths/lilith/index.md": page(
    { id: "K", type: "knowledge", title: "Lilith" },
    "**Lilith** is a female demon.",
  ),
  "wiki/religion/myths/lilith/card/index.md": page(
    { id: "C", type: "flashcard", title: "Card" },
    "## Question\nWho?\n\n## Expected answer\nLilith",
  ),
  "library/article/index.md": page(
    {
      id: "SRC",
      type: "source",
      title: "Article on Lilith",
      category: "MYT",
      visibility: "public",
    },
    "Lilith comes from Mesopotamia.",
  ),
  "library/book/index.md": page({ id: "BOOK", type: "source", title: "Book", category: "REL" }),
  "library/loose/index.md": page({ id: "LOOSE", type: "source", title: "Loose" }),
  "library/lost/index.md": page({ id: "LOST", type: "source", title: "Lost", category: "GONE" }),
  "library/odd/index.md": page({ id: "ODD", type: "source", title: "Odd", category: "K" }),
  "discussions/2026-01-01-1000-about-card.md": discussion(
    { id: "D1", title: "About the card", about: "C" },
    "## user · 2026-01-01T10:00:00Z\nWho is Lilith?\n\n## eugenia · 2026-01-01T10:00:05Z\nA demon.",
  ),
  "discussions/2026-01-01-1100-about-source.md": discussion({
    id: "D2",
    title: "About the source",
    about: "SRC",
  }),
  "discussions/2026-01-01-1200-quiz.md": discussion({
    id: "Q",
    kind: "quiz",
    title: "Quiz",
    scope_node: "REL",
  }),
  "discussions/2026-01-01-1300-note.md": discussion({ id: "N", kind: "note", title: "Note" }),
};

async function placed(files: Files) {
  const wiki = await memoryWiki(files);
  const hierarchy = buildHierarchy(
    wiki.tree,
    [...wiki.discussions].map(([path, meta]) => ({ path, meta })),
  );
  return { wiki, hierarchy };
}

describe("common hierarchy", () => {
  it("files each source in its category, at the root otherwise", async () => {
    const { wiki } = await placed(BASE);
    const filed = (id: string): string | undefined => wiki.tree.nodes.get(id)?.filedIn;
    expect(filed("SRC")).toBe("MYT");
    expect(filed("BOOK")).toBe("REL");
    expect(filed("LOOSE")).toBe("R");
    expect(filed("LOST")).toBe("R");
    expect(filed("ODD")).toBe("R");
    const codes = wiki.tree.problems.map((p) => `${p.code}:${p.nodeId}`);
    expect(codes).toContain("unknown-category:LOST");
    expect(codes).toContain("not-a-category:ODD");
    expect(sourcesIn(wiki.tree, "MYT").map((s) => s.id)).toEqual(["SRC"]);
    expect(
      sourcesInBranch(wiki.tree, "REL")
        .map((s) => s.id)
        .sort(),
    ).toEqual(["BOOK", "SRC"]);
    const source = wiki.tree.nodes.get("SRC")!;
    expect(hierarchyAncestors(wiki.tree, source).map((n) => n.id)).toEqual(["R", "REL", "MYT"]);
    expect(isInBranch(wiki.tree, "REL", source)).toBe(true);
    expect(isInBranch(wiki.tree, "REL", wiki.tree.nodes.get("LOOSE")!)).toBe(false);
  });

  it("places each discussion under the page it was started from", async () => {
    const { wiki, hierarchy } = await placed(BASE);
    const place = (path: string): string | undefined =>
      hierarchy.placeOf.get(`discussions/${path}.md`);
    // From a flashcard: under its knowledge item.
    expect(place("2026-01-01-1000-about-card")).toBe("K");
    expect(place("2026-01-01-1100-about-source")).toBe("SRC");
    expect(place("2026-01-01-1200-quiz")).toBe("REL");
    expect(place("2026-01-01-1300-note")).toBe("R");
    expect(hierarchy.discussionById.get("D2")?.path).toBe(
      "discussions/2026-01-01-1100-about-source.md",
    );
    expect(hierarchy.sourcesAt.get("MYT")?.map((s) => s.id)).toEqual(["SRC"]);
    // A discussion about a source belongs to the branch of the category of the source.
    expect(
      discussionInBranch(
        wiki.tree,
        hierarchy,
        "MYT",
        "discussions/2026-01-01-1100-about-source.md",
      ),
    ).toBe(true);
    expect(
      discussionInBranch(wiki.tree, hierarchy, "MYT", "discussions/2026-01-01-1300-note.md"),
    ).toBe(false);
  });

  it("files a source in another category, or at the root", async () => {
    const { wiki } = await placed(BASE);
    const [change] = await updatePage(wiki.view, "LOOSE", { category: "MYT" });
    expect(change).toMatchObject({ op: "write", path: "library/loose/index.md" });
    expect(parsePage((change as { content: string }).content).fields.category).toBe("MYT");
    const [cleared] = await updatePage(wiki.view, "SRC", { category: null });
    expect(parsePage((cleared as { content: string }).content).fields.category).toBeUndefined();
  });

  it("moves up what was filed in a deleted branch", async () => {
    const { wiki } = await placed(BASE);
    const changes = await deleteNode(wiki.view, "MYT", { recursive: true });
    const after = await placed(applyChanges(BASE, changes));
    // The source moves to the parent category, the discussion of the deleted knowledge too.
    expect(after.wiki.tree.nodes.get("SRC")?.filedIn).toBe("REL");
    expect(after.hierarchy.placeOf.get("discussions/2026-01-01-1000-about-card.md")).toBe("REL");
    expect(after.wiki.tree.problems.filter((p) => p.code === "unknown-category")).toHaveLength(1);

    const fromSource = await deleteNode(wiki.view, "SRC");
    const afterSource = await placed(applyChanges(BASE, fromSource));
    expect(afterSource.hierarchy.placeOf.get("discussions/2026-01-01-1100-about-source.md")).toBe(
      "MYT",
    );

    // At the root, the category disappears.
    const top = await deleteNode(wiki.view, "REL", { recursive: true });
    const afterTop = applyChanges(BASE, top);
    expect(parsePage(afterTop["library/book/index.md"]!).fields.category).toBeUndefined();
  });
});

/** Files of the index of the article, generated like the app does. */
async function indexed(files: Files, root: KnowledgeNode = TREE): Promise<Files> {
  const wiki = await memoryWiki(files);
  const changes = sourceIndexChanges(wiki.view, wiki.tree.nodes.get("SRC")!, {
    model: "mistral-large-latest",
    textSha: "abc1234",
    root,
    now: new Date("2026-11-23T10:00:00.500Z"),
  });
  return applyChanges(files, changes);
}

describe("index of a source (_index/, one page per node)", () => {
  it("writes one Markdown page per node, like the wiki, and reads the tree back", async () => {
    const files = await indexed(BASE);
    expect(Object.keys(files).filter((p) => p.startsWith("library/article/_index/"))).toEqual([
      "library/article/_index/index.md",
      "library/article/_index/origins/index.md",
      "library/article/_index/origins/lilitu/index.md",
      "library/article/_index/black-moon/index.md",
    ]);
    expect(files["library/article/_index/index.md"]).toBe(
      "---\ntype: source-index\ntitle: Article on Lilith\nmodel: mistral-large-latest\ntext_sha: abc1234\ngenerated: 2026-11-23T10:00:00Z\n---\n\nThe figure of Lilith, from Mesopotamia to astrology.\n",
    );
    expect(files["library/article/_index/origins/index.md"]).toBe(
      [
        "---",
        "type: section",
        "title: Origins",
        "order: 1",
        "---",
        "",
        "Lilith comes from Mesopotamian demonology.",
        "",
        "## Knowledge to extract",
        "",
        "### Mesopotamian origin of Lilith",
        "**Lilith** comes from Mesopotamian demonology.",
        "",
        "- Question: Where does the figure of Lilith come from?",
        "- Answer: Mesopotamian demonology",
        "",
      ].join("\n"),
    );
    const wiki = await memoryWiki(files);
    const source = wiki.tree.nodes.get("SRC")!;
    expect(source.sourceIndex?.root?.path).toBe("library/article/_index/index.md");
    expect(source.sourceIndex?.pages).toHaveLength(4);
    // The pages of the index are not pages of the library.
    expect(wiki.tree.problems.filter((p) => p.code === "nested-source")).toEqual([]);
    const doc = (await readSourceIndex(wiki.view, source))!;
    expect(doc).toMatchObject({ model: "mistral-large-latest", textSha: "abc1234" });
    expect(doc.root.children.map((c) => c.key)).toEqual(["origins", "black-moon"]);
    expect(doc.root.children[0]!.knowledge).toEqual(TREE.children[0]!.knowledge);

    const sections = sourceSections("SRC", doc.root);
    expect(sections.map((s) => `${s.key} ${s.name} [${s.path.join("/")}]`)).toEqual([
      "origins Origins []",
      "origins/lilitu Lilitu [Origins]",
      "black-moon Black Moon []",
    ]);
    expect(sections[0]!.childKeys).toEqual(["origins/lilitu"]);
    expect(sectionId("SRC", "origins/lilitu")).toBe("SRC#origins/lilitu");
    expect(parseSectionId("SRC#origins/lilitu")).toEqual({
      sourceId: "SRC",
      key: "origins/lilitu",
    });
    expect(parseSectionId("SRC")).toBeNull();
    expect(findIndexNode(doc.root, "origins/lilitu")?.name).toBe("Lilitu");
    expect(findIndexNode(doc.root, "origins/other")).toBeUndefined();
    expect(indexAncestry(doc.root, "origins/lilitu").map((n) => n.name)).toEqual([
      "Article on Lilith",
      "Origins",
      "Lilitu",
    ]);
    expect(indexKnowledge(doc.root).map((k) => k.key)).toEqual(["origins"]);
  });

  it("replaces a previous index, and follows its source when it is renamed", async () => {
    const files = await indexed(BASE);
    const again = await indexed(
      {
        ...files,
        "library/article/_tree.json": "{}",
        "library/article/_tree.embeddings.json": "{}",
      },
      { ...TREE, children: [TREE.children[1]!] },
    );
    // The first format of the index (JSON) is replaced.
    expect(again["library/article/_tree.json"]).toBeUndefined();
    expect(again["library/article/_tree.embeddings.json"]).toBeUndefined();
    expect(Object.keys(again).filter((p) => p.includes("/_index/"))).toEqual([
      "library/article/_index/index.md",
      "library/article/_index/black-moon/index.md",
    ]);
    const wiki = await memoryWiki(files);
    const renamed = applyChanges(files, await updatePage(wiki.view, "SRC", { title: "Lilith" }));
    expect(renamed["library/lilith/_index/origins/lilitu/index.md"]).toBe(
      files["library/article/_index/origins/lilitu/index.md"],
    );
  });

  it("cleans the generated tree and detects a changed source", async () => {
    expect(
      normalizeKnowledgeTree({
        name: "  Root  ",
        description: " About ",
        knowledge: [{ title: "", statement: "  A **fact**. ", question: "Q?", answer: "A" }],
        children: [
          {
            name: " ",
            description: "",
            children: [{ name: "Kept", description: "", children: [] }],
          },
        ],
      }),
    ).toEqual({
      name: "Root",
      description: "About",
      knowledge: [{ title: "Knowledge", statement: "A **fact**.", question: "Q?", answer: "A" }],
      children: [{ name: "Kept", description: "", knowledge: [], children: [] }],
    });
    const text = sourceIndexText(BASE["library/article/index.md"]!);
    expect(text).toBe("# Article on Lilith\n\nLilith comes from Mesopotamia.");
    const sha = await sourceIndexTextSha(text);
    const wiki = await memoryWiki(await indexed(BASE));
    const state = await sourceIndexState(wiki.view, wiki.tree.nodes.get("SRC")!);
    expect(state.status).toBe("stale");
    expect(sourceIndexStatus(state.meta, sha)).toBe("stale");
    expect(sourceIndexStatus({ ...state.meta!, textSha: sha }, sha)).toBe("current");
    expect(sourceIndexStatus(null, sha)).toBe("missing");
  });

  it("reports an unreadable index", async () => {
    const wiki = await memoryWiki({ ...BASE, "library/article/_index/origins/index.md": "x" });
    const problems = await validateWiki(wiki.view);
    expect(problems.map((p) => p.code)).toContain("invalid-source-index");
  });
});

describe("search by meaning across the hierarchy", () => {
  const unit = (i: number): number[] => Array.from({ length: 8 }, (_, j) => (j === i ? 1 : 0));

  it("lists pages, discussions (except quizzes) and the sections of the indexes", async () => {
    const wiki = await memoryWiki(await indexed(BASE));
    const items = await vectorItems(wiki.view, "mistral-embed");
    const byKind = (kind: string): string[] =>
      items
        .filter((i) => i.kind === kind)
        .map((i) => i.id)
        .sort();
    expect(byKind("discussion")).toEqual(["D1", "D2", "N"]);
    expect(byKind("section")).toEqual(["SRC#black-moon", "SRC#origins", "SRC#origins/lilitu"]);
    expect(byKind("page")).toContain("SRC");
    expect(byKind("page")).not.toContain("C");
    const lilitu = items.find((i) => i.id === "SRC#origins/lilitu")!;
    expect(lilitu.text).toBe("Article on Lilith › Origins › Lilitu\n\nMesopotamian wind demons.");
    expect(lilitu).toMatchObject({
      status: "missing",
      isPublic: true,
      file: "library/article/_index/_embeddings.json",
    });
    // The knowledge proposed by a section is part of its meaning.
    expect(items.find((i) => i.id === "SRC#origins")!.text).toContain(
      "**Lilith** comes from Mesopotamian demonology.",
    );
    const d1 = items.find((i) => i.id === "D1")!;
    expect(d1.text).toBe("About the card\n\nUser: Who is Lilith?\n\nEugenia: A demon.");
    expect(d1.file).toBe("discussions/_embeddings/2026-01-01-1000-about-card.json");
    expect(d1.isPublic).toBe(false);
  });

  it("writes the vectors and keeps the current ones of the other sections", async () => {
    const files = await indexed(BASE);
    const wiki = await memoryWiki(files);
    const items = await vectorItems(wiki.view, "mistral-embed");
    const vectors = new Map(items.map((item, i) => [item.id, unit(i % 8)]));
    const changes = embeddingChanges(items, vectors, "mistral-embed");
    const written = applyChanges(files, changes);
    expect(Object.keys(written)).toContain("discussions/_embeddings/2026-01-01-1300-note.json");
    const sections = parseSectionEmbeddings(written["library/article/_index/_embeddings.json"]!);
    expect([...sections.items.keys()]).toEqual(["origins", "origins/lilitu", "black-moon"]);

    // Every vector is current; only one section changes.
    const again = await memoryWiki(written);
    expect(again.tree.nodes.get("SRC")?.sourceIndex?.embeddings).toBeDefined();
    const current = await vectorItems(again.view, "mistral-embed");
    expect(current.filter((i) => i.status !== "current")).toEqual([]);
    expect(current.find((i) => i.id === "D1")?.vector).toBeDefined();
    const one = new Map([["SRC#black-moon", unit(3)]]);
    const [change] = embeddingChanges(current, one, "mistral-embed");
    const updated = parseSectionEmbeddings((change as { content: string }).content);
    expect(updated.items.size).toBe(3);
    expect(cosineSimilarity(updated.items.get("black-moon")!.vector, unit(3))).toBeGreaterThan(
      0.99,
    );
    expect(
      cosineSimilarity(updated.items.get("origins")!.vector, sections.items.get("origins")!.vector),
    ).toBeGreaterThan(0.99);
  });
});

describe("publication of the common hierarchy", async () => {
  const files: Files = {
    ...(await indexed(BASE)),
    "library/article/_index/_embeddings.json": "{}",
    "library/book/_index/index.md": "---\ntype: source-index\ntext_sha: x\n---\n",
  };

  it("publishes the index of a public source, and a category only if it is public", async () => {
    const wiki = await memoryWiki(files);
    const publication = await buildPublication(wiki.view);
    const paths = publication.files.map((f) => f.path);
    expect(paths).toContain("library/article/_index/index.md");
    expect(paths).toContain("library/article/_index/origins/lilitu/index.md");
    expect(paths).not.toContain("library/article/_index/_embeddings.json");
    expect(paths).not.toContain("library/book/_index/index.md");
    expect(publication.stats.indexes).toBe(1);
    const content = (path: string): string =>
      (publication.files.find((f) => f.path === path) as { content: string }).content;
    // "Myths" is private: the public source is published without its category.
    expect(parsePage(content("library/article/index.md")).fields.category).toBeUndefined();
    // The record of a private source keeps a public category.
    expect(parsePage(content("library/book/index.md")).fields.category).toBe("REL");
    const book = publication.index.nodes.find((n) => n.id === "BOOK");
    expect(book?.category).toBe("REL");
    expect(publication.index.version).toBe(4);
  });

  it("rebuilds the categories of sources from index.json", async () => {
    const wiki = await memoryWiki(files);
    const index = buildIndex({
      config: wiki.config,
      tree: wiki.tree,
      files: [],
      nodes: [{ id: "SRC", category: "MYT" }],
    });
    const metas = metasFromIndex(index);
    expect(metas.get("library/article/index.md")?.category).toBe("MYT");
  });
});

describe("discussions of a branch", () => {
  it("counts the discussions placed in a branch", async () => {
    const wiki = await memoryWiki(BASE);
    const hierarchy = buildHierarchy(
      wiki.tree,
      [...wiki.discussions].map(([path, meta]) => ({ path, meta })),
    );
    const ids = (id: string): string[] =>
      discussionsInBranch(wiki.tree, hierarchy, id).map((d) => d.meta.id);
    expect(ids("MYT")).toEqual(["D2", "D1"]);
    expect(ids("REL")).toEqual(["Q", "D2", "D1"]);
    expect(ids("R")).toHaveLength(4);
  });
});

describe("category of a source drawn from its knowledge", async () => {
  const { categoryForSource } = await import("../src/index.ts");
  const parents: Record<string, string> = { S: "R", A: "S", P: "S", H: "R", N: "A" };
  const parentOf = (id: string): string | undefined => parents[id];
  it("takes the deepest common category, or the most used one", () => {
    expect(categoryForSource(["A", "A"], parentOf, "R")).toBe("A");
    expect(categoryForSource(["A", "N"], parentOf, "R")).toBe("A");
    expect(categoryForSource(["A", "P"], parentOf, "R")).toBe("S");
    expect(categoryForSource(["H", "A", "A"], parentOf, "R")).toBe("A");
    expect(categoryForSource(["H", "A"], parentOf, "R")).toBe("H");
    expect(categoryForSource([], parentOf, "R")).toBe("R");
  });
});
