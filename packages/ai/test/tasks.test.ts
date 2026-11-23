import { describe, expect, it } from "vitest";
import { gitBlobSha, loadWiki } from "@openeugenia/core";
import {
  AIError,
  askTree,
  categorizeKnowledge,
  categoryOptions,
  discussionRequest,
  evaluateAnswer,
  pageText,
  proposeFlashcards,
  resolveCategoryPlan,
  treeNavigator,
  highlightKnowledge,
  locateQuote,
  proposeKnowledge,
  selectProvider,
  summarizeNode,
  type AskEvent,
  type CategoryOption,
  type TreeEntry,
} from "../src/index.ts";
import { FakeProvider } from "./fake.ts";

const TEXT =
  "Lilith is a female demon of Jewish tradition, who stands for a deity of Mesopotamian origin. In Jewish legends, Lilith is presented as Adam's first wife, before Eve.";

describe("extraction", () => {
  it("finds an exact or approximate quote", () => {
    expect(locateQuote(TEXT, "female demon")).toEqual({ start: 12, end: 24 });
    const approx = locateQuote("He said « hello »  to all.", 'said "hello" to all');
    expect(approx).toEqual({ start: 3, end: 25 });
    expect(locateQuote(TEXT, "not in the text")).toBeNull();
  });

  it("highlights the knowledge proposed by Eugenia, with its positions", async () => {
    const provider = new FakeProvider({
      json: [
        {
          highlights: [
            { quote: "Lilith is a female demon of Jewish tradition", reason: "definition" },
            { quote: "made up", reason: "not found" },
            { quote: "Adam's first wife, before Eve", reason: "legend" },
          ],
        },
      ],
    });
    const highlights = await highlightKnowledge({ provider }, TEXT);
    expect(highlights.map((h) => h.quote)).toEqual([
      "Lilith is a female demon of Jewish tradition",
      "Adam's first wife, before Eve",
    ]);
    expect(TEXT.slice(highlights[1]!.start, highlights[1]!.end)).toBe(
      "Adam's first wife, before Eve",
    );
    expect(provider.calls[0]!.messages[0]!.content).toContain("<step>highlight</step>");
  });

  it("proposes knowledge and flashcards for known passages only", async () => {
    const provider = new FakeProvider({
      json: [
        {
          cards: [
            {
              highlight: 1,
              knowledge: "**Lilith** is a female demon of Jewish tradition.",
              title: "Lilith",
              question: "Which female demon…?",
              answer: "Lilith",
            },
            {
              highlight: 2,
              knowledge: "Lilith is **Adam's first wife**.",
              title: "Adam's first wife",
              question: "Who…?",
              answer: "Lilith",
            },
            { highlight: 9, knowledge: "x", title: "x", question: "x", answer: "x" },
          ],
        },
      ],
    });
    const proposals = await proposeKnowledge(
      { provider },
      {
        text: TEXT,
        highlights: [
          { id: "h1", quote: "Lilith is a female demon" },
          { id: "h2", quote: "Adam's first wife" },
        ],
      },
    );
    expect(proposals.map((p) => [p.highlightId, p.title])).toEqual([
      ["h1", "Lilith"],
      ["h2", "Adam's first wife"],
    ]);
    expect(provider.calls[0]!.messages[0]!.content).toContain("<step>propose</step>");
  });
});

describe("categories of the knowledge of a document", () => {
  const categories: CategoryOption[] = [
    { id: "R", path: "My wiki" },
    { id: "SCI", path: "My wiki > Science" },
    { id: "ASTRO", path: "My wiki > Science > Astronomy" },
    { id: "REL", path: "My wiki > Religion and beliefs" },
  ];
  const knowledge = [
    { title: "51 Pegasi b", knowledge: "**51 Pegasi b** is the first exoplanet…" },
    { title: "Hot Jupiters", knowledge: "A **hot Jupiter** is…" },
    { title: "Radial velocity", knowledge: "The **radial velocity** method…" },
    { title: "Apogee", knowledge: "The **apogee** is…" },
  ];

  it("reuses existing categories and creates nested ones that group the document", async () => {
    const provider = new FakeProvider({
      json: [
        {
          new_categories: [
            { key: "n1", title: "Exoplanets", parent: "n2", reason: "Three items on exoplanets." },
            { key: "n2", title: "Planetary systems", parent: "ASTRO", reason: "Parent topic." },
          ],
          assignments: [
            { item: 1, category: "n1" },
            { item: 2, category: "n1" },
            { item: 3, category: "n2" },
            { item: 4, category: "ASTRO" },
          ],
        },
      ],
    });
    const plan = await categorizeKnowledge(
      { provider },
      { document: "51 Pegasi b", categories, knowledge, fallbackId: "R" },
    );
    expect(plan.newCategories).toEqual([
      { key: "new:2", title: "Planetary systems", parent: "ASTRO", reason: "Parent topic." },
      { key: "new:1", title: "Exoplanets", parent: "new:2", reason: "Three items on exoplanets." },
    ]);
    expect(plan.assignments).toEqual(["new:1", "new:1", "new:2", "ASTRO"]);
    const content = provider.calls[0]!.messages[0]!.content;
    expect(content).toContain("- ASTRO | My wiki > Science > Astronomy");
    expect(content).toContain("3. Radial velocity: The **radial velocity** method…");
    expect(provider.calls[0]!.system).toContain("Wikipedia");
  });

  it("merges duplicates, falls back on unknown categories and drops empty ones", () => {
    const plan = resolveCategoryPlan(
      {
        new_categories: [
          { key: "a", title: "astronomy", parent: "SCI", reason: "" },
          { key: "b", title: "Myths", parent: "REL", reason: "" },
          { key: "c", title: "myths ", parent: "REL", reason: "" },
          { key: "d", title: "Unused", parent: "R", reason: "" },
          { key: "e", title: "Loop", parent: "f", reason: "" },
          { key: "f", title: "Other loop", parent: "e", reason: "" },
          { key: "g", title: "Orphan", parent: "UNKNOWN", reason: "" },
        ],
        assignments: [
          { item: 1, category: "a" },
          { item: 2, category: "c" },
          { item: 3, category: "e" },
          { item: 4, category: "g" },
          { item: 7, category: "REL" },
        ],
      },
      { categories, knowledge, fallbackId: "SCI" },
    );
    expect(plan.assignments).toEqual(["ASTRO", "new:2", "new:5", "new:7"]);
    expect(plan.newCategories.map((c) => [c.key, c.title, c.parent])).toEqual([
      // The cycle is cut at "Loop", so "Other loop" no longer contains anything.
      ["new:2", "Myths", "REL"],
      ["new:5", "Loop", "SCI"],
      ["new:7", "Orphan", "SCI"],
    ]);
  });

  it("files every item in the fallback when Eugenia answers nothing usable", () => {
    const plan = resolveCategoryPlan(
      { new_categories: [], assignments: [] },
      { categories, knowledge: knowledge.slice(0, 2), fallbackId: "REL" },
    );
    expect(plan).toEqual({ newCategories: [], assignments: ["REL", "REL"] });
  });
});

describe("descriptions and evaluation", () => {
  it("asks for a description from the children", async () => {
    const provider = new FakeProvider({ text: ["  A description.  "] });
    const text = await summarizeNode(
      { provider, variables: { wiki_title: "W" } },
      {
        title: "Astronomy",
        path: ["Root", "Science"],
        children: [
          { title: "Moon", type: "flashcard", description: "The **Moon**…", isSubwiki: false },
        ],
      },
    );
    expect(text).toBe("A description.");
    const message = provider.calls[0]!.messages[0]!.content;
    expect(message).toContain("Path: Root > Science > Astronomy");
    expect(message).toContain("Level: branch");
    expect(message).toContain("- [flashcard] Moon: The **Moon**…");
    expect(provider.calls[0]!.system).toContain('("W")');
    expect(provider.calls[0]!.system).toContain("first person");
  });

  it('marks the root of the wiki, described with "This is my wiki…"', async () => {
    const provider = new FakeProvider({ text: ["This is my wiki."] });
    await summarizeNode({ provider }, { title: "Root", path: [], children: [] });
    expect(provider.calls[0]!.messages[0]!.content).toContain("Level: root of the wiki");
    expect(provider.calls[0]!.system).toContain('"This is my wiki…"');
  });

  it("keeps the score between 0 and 1", async () => {
    const provider = new FakeProvider({
      json: [{ score: 1.7, feedback: "Perfect", missing: [], superfluous: [] }],
    });
    const result = await evaluateAnswer(
      { provider },
      { knowledge: "**Lilith**", question: "Who?", expected: "Lilith", answer: "Lilith" },
    );
    expect(result.score).toBe(1);
  });
});

describe("questions about the tree", () => {
  const entries: Record<string, TreeEntry> = {
    R: { id: "R", title: "Root", type: "category", hasChildren: true },
    S: { id: "S", title: "Science", type: "category", hasChildren: true, description: "Sciences" },
    H: { id: "H", title: "History", type: "category", hasChildren: true },
    L: { id: "L", title: "Black Moon", type: "knowledge", hasChildren: false },
  };
  const tree: Record<string, string[]> = { R: ["S", "H"], S: ["L"], H: [] };
  const navigator = {
    entry: (id: string) => entries[id],
    children: async (id: string) => (tree[id] ?? []).map((c) => entries[c]!),
    content: async (id: string) => `Content of ${id}`,
  };

  it("goes down the tree, then answers citing the pages read", async () => {
    const provider = new FakeProvider({
      json: [
        { explore: ["S", "X"], read: [], enough: false },
        { explore: [], read: ["L"], enough: true },
      ],
      text: ["The [Black Moon](eugenia:L) is linked to Lilith. [Wrong](eugenia:Z)"],
    });
    const events: AskEvent[] = [];
    for await (const event of askTree(
      { provider },
      { question: "Black Moon?", scopeId: "R", navigator },
    ))
      events.push(event);
    expect(events.filter((e) => e.type === "explore" || e.type === "read")).toEqual([
      { type: "explore", ids: ["S"] },
      { type: "read", ids: ["L"] },
    ]);
    const done = events.at(-1);
    expect(done).toMatchObject({ type: "done", cited: ["L"], consulted: ["L"] });
    expect(provider.calls.at(-1)!.messages[0]!.content).toContain("Content of L");
    expect(provider.calls.at(-1)!.messages[0]!.content).toContain("<step>answer</step>");
  });
});

describe("local AI for private content", () => {
  const remote = new FakeProvider({}, false);
  const local = new FakeProvider({}, true);

  it("blocks a private task without a local provider", () => {
    expect(() => selectProvider({ main: remote, localOnlyForPrivate: true }, true)).toThrow(
      AIError,
    );
    try {
      selectProvider({ main: remote, localOnlyForPrivate: true }, true);
    } catch (e) {
      expect((e as AIError).kind).toBe("privacy");
    }
  });

  it("uses the local provider for private content and the main one for public content", () => {
    const selection = { main: remote, local, localOnlyForPrivate: true };
    expect(selectProvider(selection, true).provider).toBe(local);
    expect(selectProvider(selection, false).provider).toBe(remote);
  });

  it("reports private content sent to a remote provider", () => {
    expect(
      selectProvider({ main: remote, localOnlyForPrivate: false }, true).sendsPrivateToRemote,
    ).toBe(true);
    expect(
      selectProvider({ main: remote, localOnlyForPrivate: false }, false).sendsPrivateToRemote,
    ).toBe(false);
    expect(() => selectProvider({ localOnlyForPrivate: false }, false)).toThrow(/No AI provider/);
  });
});

describe("flashcards of a knowledge item", () => {
  it("proposes new flashcards, without duplicating existing ones", async () => {
    const provider = new FakeProvider({
      json: [
        {
          cards: [
            { question: "Who is Lilith?", answer: "A female demon" },
            { question: "What is the name of the demon?", answer: "Lilith" },
            { question: "  ", answer: "empty" },
          ],
        },
      ],
    });
    const cards = await proposeFlashcards(
      { provider },
      {
        knowledge: "**Lilith** is a female demon.",
        title: "Lilith",
        path: ["Religion"],
        existing: [{ question: "What is the name of the demon?", answer: "Lilith" }],
        count: 2,
      },
    );
    expect(cards).toEqual([{ question: "Who is Lilith?", answer: "A female demon" }]);
    const content = provider.calls[0]!.messages[0]!.content;
    expect(content).toContain("Path: Religion > Lilith");
    expect(content).toContain("<count>2</count>");
  });
});

describe("discussions", () => {
  it("answers a quick note with its own prompt and the library", () => {
    const request = discussionRequest(
      { provider: new FakeProvider({}) },
      {
        kind: "note",
        related: [],
        sources: [{ id: "S1", title: "An article" }],
        history: [{ role: "user", content: "An idea." }],
      },
    );
    expect(request.system).toContain("quick note");
    expect(request.system).toContain("<library>\n- S1 | An article\n</library>");
    expect(request.system).not.toContain("<page>");
  });
});

describe("bridge with the wiki", async () => {
  const source: Record<string, string> = {
    ".notes/config.yml": "title: Test\nroot: wiki/\n",
    "wiki/index.md": "---\nid: R\ntype: category\ntitle: Root\n---\n",
    "wiki/science/index.md": "---\nid: S\ntitle: Science\n---\n",
    "wiki/science/moon/index.md":
      "---\nid: K\ntype: knowledge\ntitle: Black Moon\n---\n\nThe **Black Moon** is a point.\n\n## Notes\nSee the apogee.\n",
    "wiki/science/moon/card/index.md":
      "---\nid: C\ntype: flashcard\ntitle: Card\n---\n\n## Question\nWhich point?\n\n## Expected answer\nThe Black Moon\n",
    "library/book/index.md":
      "---\nid: L\ntype: source\ntitle: Book\nauthors: [Ada]\npublished: '1843'\n---\n\nSummary.\n",
  };
  const files = await Promise.all(
    Object.entries(source).map(async ([path, text]) => ({ path, sha: await gitBlobSha(text) })),
  );
  const readText = async (path: string): Promise<string> => source[path]!;
  const wiki = await loadWiki({ files, readText });
  const view = { config: wiki.config, tree: wiki.tree, files: wiki.files, readText };

  it("describes each page type", async () => {
    const node = (id: string) => wiki.tree.nodes.get(id)!;
    expect(await pageText(view, node("K"))).toBe(
      "Knowledge: The Black Moon is a point.\n\nNotes\nSee the apogee.",
    );
    expect(await pageText(view, node("C"))).toBe(
      "Knowledge: The Black Moon is a point.\nQuestion: Which point?\nExpected answer: The Black Moon",
    );
    expect(await pageText(view, node("L"))).toBe("Authors: Ada\nPublished: 1843\nSummary.");
  });

  it("only offers categories and stops at knowledge items", async () => {
    expect(categoryOptions(view).map((c) => c.id)).toEqual(["R", "S"]);
    const navigator = treeNavigator(view, "private");
    const [moon] = await navigator.children("S");
    expect(moon).toMatchObject({ id: "K", type: "knowledge", hasChildren: false });
    expect(await navigator.content("K")).toContain("Flashcards:\n- Which point? → The Black Moon");
  });
});
