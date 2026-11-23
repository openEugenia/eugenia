import { describe, expect, it } from "vitest";
import {
  buildHierarchy,
  buildIndex,
  buildPublication,
  cosineSimilarity,
  deleteNode,
  discussionInBranch,
  embeddingChanges,
  findKnowledgeNode,
  hierarchyAncestors,
  isInBranch,
  metasFromIndex,
  newSourceTreeDocument,
  parsePage,
  parseSectionEmbeddings,
  parseSectionId,
  parseSourceTree,
  sectionId,
  serializeSourceTree,
  sourceIndexText,
  sourceIndexTextSha,
  sourceSections,
  sourcesIn,
  sourcesInBranch,
  sourceTreeStatus,
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

describe("index of a source (_tree.json)", () => {
  it("reads back the tree and addresses its sections", async () => {
    const doc = newSourceTreeDocument({
      model: "mistral-large-latest",
      textSha: "abc1234",
      root: TREE,
      now: new Date("2026-11-23T10:00:00.500Z"),
    });
    const text = serializeSourceTree(doc);
    expect(JSON.parse(text)).toMatchObject({
      format: "eugenia-source-tree",
      version: 1,
      model: "mistral-large-latest",
      text_sha: "abc1234",
      generated: "2026-11-23T10:00:00Z",
      root: { name: "Article on Lilith" },
    });
    expect(parseSourceTree(text)).toEqual(doc);
    expect(() => parseSourceTree('{"format": "other"}')).toThrow();

    const sections = sourceSections("SRC", doc.root);
    expect(sections.map((s) => `${s.key} ${s.name} [${s.path.join("/")}]`)).toEqual([
      "1 Origins []",
      "1.1 Lilitu [Origins]",
      "2 Black Moon []",
    ]);
    expect(sections[0]!.childKeys).toEqual(["1.1"]);
    expect(sectionId("SRC", "1.1")).toBe("SRC#1.1");
    expect(parseSectionId("SRC#1.1")).toEqual({ sourceId: "SRC", key: "1.1" });
    expect(parseSectionId("SRC")).toBeNull();
    expect(findKnowledgeNode(doc.root, "1.1")?.name).toBe("Lilitu");
    expect(findKnowledgeNode(doc.root, "3")).toBeUndefined();
  });

  it("cleans the generated tree and detects a changed source", async () => {
    const doc = newSourceTreeDocument({
      model: "m",
      textSha: "x",
      root: {
        name: "  Root  ",
        description: " About ",
        children: [
          {
            name: " ",
            description: "",
            children: [{ name: "Kept", description: "", children: [] }],
          },
        ],
      },
    });
    expect(doc.root).toEqual({
      name: "Root",
      description: "About",
      children: [{ name: "Kept", description: "", children: [] }],
    });
    const content = BASE["library/article/index.md"]!;
    const text = sourceIndexText(content);
    expect(text).toBe("# Article on Lilith\n\nLilith comes from Mesopotamia.");
    const sha = await sourceIndexTextSha(text);
    expect(sourceTreeStatus({ ...doc, textSha: sha }, sha)).toBe("current");
    expect(sourceTreeStatus({ ...doc, textSha: "0000000" }, sha)).toBe("stale");
    expect(sourceTreeStatus(undefined, sha)).toBe("missing");
  });

  it("reports an unreadable index", async () => {
    const wiki = await memoryWiki({ ...BASE, "library/article/_tree.json": "{ broken" });
    expect(wiki.tree.nodes.get("SRC")?.sourceTree?.path).toBe("library/article/_tree.json");
    const problems = await validateWiki(wiki.view);
    expect(problems.map((p) => p.code)).toContain("invalid-source-index");
  });
});

describe("search by meaning across the hierarchy", () => {
  const unit = (i: number): number[] => Array.from({ length: 8 }, (_, j) => (j === i ? 1 : 0));
  const tree = serializeSourceTree(newSourceTreeDocument({ model: "m", textSha: "x", root: TREE }));

  it("lists pages, discussions (except quizzes) and the sections of the indexes", async () => {
    const wiki = await memoryWiki({ ...BASE, "library/article/_tree.json": tree });
    const items = await vectorItems(wiki.view, "mistral-embed");
    const byKind = (kind: string): string[] =>
      items
        .filter((i) => i.kind === kind)
        .map((i) => i.id)
        .sort();
    expect(byKind("discussion")).toEqual(["D1", "D2", "N"]);
    expect(byKind("section")).toEqual(["SRC#1", "SRC#1.1", "SRC#2"]);
    expect(byKind("page")).toContain("SRC");
    expect(byKind("page")).not.toContain("C");
    const lilitu = items.find((i) => i.id === "SRC#1.1")!;
    expect(lilitu.text).toBe("Article on Lilith › Origins › Lilitu\n\nMesopotamian wind demons.");
    expect(lilitu).toMatchObject({
      status: "missing",
      isPublic: true,
      file: "library/article/_tree.embeddings.json",
    });
    const d1 = items.find((i) => i.id === "D1")!;
    expect(d1.text).toBe("About the card\n\nUser: Who is Lilith?\n\nEugenia: A demon.");
    expect(d1.file).toBe("discussions/_embeddings/2026-01-01-1000-about-card.json");
    expect(d1.isPublic).toBe(false);
  });

  it("writes the vectors and keeps the current ones of the other sections", async () => {
    const files = { ...BASE, "library/article/_tree.json": tree };
    const wiki = await memoryWiki(files);
    const items = await vectorItems(wiki.view, "mistral-embed");
    const vectors = new Map(items.map((item, i) => [item.id, unit(i % 8)]));
    const changes = embeddingChanges(items, vectors, "mistral-embed");
    const written = applyChanges(files, changes);
    expect(Object.keys(written)).toContain("discussions/_embeddings/2026-01-01-1300-note.json");
    const sections = parseSectionEmbeddings(written["library/article/_tree.embeddings.json"]!);
    expect([...sections.items.keys()]).toEqual(["1", "1.1", "2"]);

    // Every vector is current; only one section changes.
    const again = await memoryWiki(written);
    const current = await vectorItems(again.view, "mistral-embed");
    expect(current.filter((i) => i.status !== "current")).toEqual([]);
    expect(current.find((i) => i.id === "D1")?.vector).toBeDefined();
    const one = new Map([["SRC#2", unit(3)]]);
    const [change] = embeddingChanges(current, one, "mistral-embed");
    const updated = parseSectionEmbeddings((change as { content: string }).content);
    expect(updated.items.size).toBe(3);
    expect(cosineSimilarity(updated.items.get("2")!.vector, unit(3))).toBeGreaterThan(0.99);
    expect(
      cosineSimilarity(updated.items.get("1")!.vector, sections.items.get("1")!.vector),
    ).toBeGreaterThan(0.99);
  });
});

describe("publication of the common hierarchy", () => {
  const files: Files = {
    ...BASE,
    "library/article/_tree.json": serializeSourceTree(
      newSourceTreeDocument({ model: "m", textSha: "x", root: TREE }),
    ),
    "library/article/_tree.embeddings.json": "{}",
    "library/book/_tree.json": "{}",
  };

  it("publishes the index of a public source, and a category only if it is public", async () => {
    const wiki = await memoryWiki(files);
    const publication = await buildPublication(wiki.view);
    const paths = publication.files.map((f) => f.path);
    expect(paths).toContain("library/article/_tree.json");
    expect(paths).not.toContain("library/article/_tree.embeddings.json");
    expect(paths).not.toContain("library/book/_tree.json");
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
