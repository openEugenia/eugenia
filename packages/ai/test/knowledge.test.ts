import { describe, expect, it } from "vitest";
import {
  buildHierarchy,
  gitBlobSha,
  loadWiki,
  sourceIndexChanges,
  type KnowledgeNode,
} from "@openeugenia/core";
import {
  AIError,
  askTree,
  assembleTree,
  createProvider,
  discussionRequest,
  gatherKnowledge,
  indexExtractionPlan,
  indexSource,
  KnowledgeNodeSchema,
  messageText,
  mergeDuplicates,
  treeNavigator,
  type AskEvent,
  type GenerateRequest,
  type IndexProgress,
  type JsonRequest,
} from "../src/index.ts";
import { FakeProvider } from "./fake.ts";

const leaf = (name: string, description = `About ${name}.`): KnowledgeNode => ({
  name,
  description,
  knowledge: [],
  children: [],
});

describe("indexing a source", () => {
  it("validates a recursive knowledge tree", () => {
    const tree = {
      name: "A",
      description: "a",
      knowledge: [{ title: "Fact", statement: "**A** is a fact.", question: "What?", answer: "A" }],
      children: [{ ...leaf("B"), children: [leaf("C")] }],
    };
    expect(KnowledgeNodeSchema.parse(tree)).toEqual(tree);
    expect(KnowledgeNodeSchema.safeParse({ name: "A", children: [] }).success).toBe(false);
  });

  it("describes a short source in a single request", async () => {
    const tree = {
      name: "Photosynthesis",
      description: "Light into sugar.",
      knowledge: [],
      children: [leaf("Calvin cycle")],
    };
    const provider = new FakeProvider({ json: [tree] });
    const progress: IndexProgress[] = [];
    const result = await indexSource(
      { provider, variables: { wiki_title: "My wiki" } },
      { title: "Photosynthesis", text: "# Photosynthesis\n\nText." },
      { onProgress: (p) => progress.push(p) },
    );
    expect(result).toEqual(tree);
    expect(provider.calls).toHaveLength(1);
    const request = provider.calls[0] as JsonRequest<unknown>;
    expect(request.name).toBe("knowledge_tree");
    expect(request.system).toContain("hierarchical knowledge tree");
    expect(request.messages[0]!.content).toContain("<step>tree</step>");
    expect(request.messages[0]!.content).not.toContain("<part>");
    expect(progress.at(-1)).toEqual({ done: 1, total: 1 });
  });

  it("reads a long source in parts, then gathers their topics", async () => {
    const paragraph = (n: number): string => `Paragraph ${n}. ${"word ".repeat(30)}`;
    const text = Array.from({ length: 6 }, (_, i) => paragraph(i)).join("\n\n");
    const provider = new FakeProvider({
      json: [
        {
          name: "Part 1",
          description: "First.",
          knowledge: [],
          children: [leaf("Origins"), leaf("Myths")],
        },
        {
          name: "Part 2",
          description: "Second.",
          knowledge: [],
          children: [leaf("Origins", "More origins."), leaf("Astrology")],
        },
        {
          name: "Lilith",
          description: "The whole source.",
          groups: [
            { name: "Origins", description: "Where it comes from.", members: ["P1.1", "p2.1"] },
            { name: "Astrology", description: "", members: ["P2.2", "P9.9"] },
          ],
        },
      ],
    });
    const progress: IndexProgress[] = [];
    const result = await indexSource(
      { provider },
      { title: "Lilith", text },
      { partSize: Math.ceil(text.length / 2) + 10, onProgress: (p) => progress.push(p) },
    );
    expect(provider.calls[0]!.messages[0]!.content).toContain("<part>1 of 2</part>");
    expect(provider.calls[2]!.messages[0]!.content).toContain("<step>assemble</step>");
    expect(provider.calls[2]!.messages[0]!.content).toContain(
      "- P2.2 | Astrology | About Astrology.",
    );
    expect(result.name).toBe("Lilith");
    expect(result.description).toBe("The whole source.");
    // Duplicates merged within a group; a single-topic group keeps its topic; leftovers kept.
    expect(result.children.map((c) => c.name)).toEqual(["Origins", "Astrology", "Myths"]);
    expect(result.children[0]).toEqual({
      name: "Origins",
      description: "About Origins.\n\nMore origins.",
      knowledge: [],
      children: [],
    });
    expect(progress.some((p) => p.assembling)).toBe(true);
  });

  it("splits a part whose tree is cut off", async () => {
    const text = Array.from({ length: 8 }, (_, i) => `Paragraph ${i}. ${"word ".repeat(40)}`).join(
      "\n\n",
    );
    let calls = 0;
    const provider = new FakeProvider({});
    provider.json = async <T>(request: JsonRequest<T>): Promise<T> => {
      provider.calls.push(request);
      calls++;
      if (calls === 1) throw new AIError("invalid_output", "cut off");
      if (request.name === "assembly")
        return { name: "Whole", description: "All.", groups: [] } as T;
      return {
        name: `Half ${calls}`,
        description: "",
        knowledge: [],
        children: [leaf(`Topic ${calls}`)],
      } as T;
    };
    const result = await indexSource({ provider }, { title: "Long", text }, { minPartSize: 100 });
    expect(result.name).toBe("Whole");
    expect(result.children.map((c) => c.name)).toEqual(["Topic 2", "Topic 3"]);
    expect(provider.calls[1]!.messages[0]!.content).toContain("<part>1 of 2</part>");
  });

  it("keeps the topics in order without a plan", () => {
    const tree = assembleTree(
      "Title",
      [{ ...leaf("P1"), children: [leaf("A")] }, leaf("Alone")],
      null,
    );
    expect(tree).toMatchObject({ name: "Title", description: "About P1.\n\nAbout Alone." });
    expect(tree.children.map((c) => c.name)).toEqual(["A", "Alone"]);
    expect(mergeDuplicates([leaf("Été"), leaf("ete", "Other.")])).toHaveLength(1);
  });
});

describe("reasoning models (content in chunks)", () => {
  it("keeps the text of the answer, without the reasoning", async () => {
    expect(messageText("plain")).toBe("plain");
    expect(
      messageText([
        { type: "thinking", thinking: [{ type: "text", text: "hmm" }] },
        { type: "text", text: '{"a":' },
        { type: "text", text: "1}" },
      ]),
    ).toBe('{"a":1}');
    expect(messageText(null)).toBe("");

    const calls: Record<string, unknown>[] = [];
    const respond = (content: unknown, finish = "stop"): Response =>
      Response.json({ choices: [{ message: { content }, finish_reason: finish }] });
    const queue = [
      respond([
        { type: "thinking", thinking: [] },
        { type: "text", text: '{"name":"Paris"}' },
      ]),
      respond([{ type: "text", text: '{"name":' }], "length"),
    ];
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return queue.shift()!;
    }) as typeof fetch;
    const provider = createProvider(
      {
        kind: "openai",
        baseUrl: "https://api.mistral.ai/v1",
        model: "mistral-large-latest",
        apiKey: "k",
      },
      { fetch: fetchImpl },
    );
    const { z } = await import("zod");
    const schema = z.object({ name: z.string() });
    expect(await provider.json({ system: "S", messages: [], schema, name: "city" })).toEqual({
      name: "Paris",
    });
    // A truncated answer is not requested again in another format.
    await expect(
      provider.json({ system: "S", messages: [], schema, name: "city" }),
    ).rejects.toMatchObject({
      kind: "invalid_output",
    });
    expect(calls).toHaveLength(2);
  });
});

describe("search in the common hierarchy", async () => {
  const source: Record<string, string> = {
    ".notes/config.yml": "title: Test\nroot: wiki/\n",
    "wiki/index.md": "---\nid: R\ntitle: Root\nvisibility: public\n---\n",
    "wiki/religion/index.md": "---\nid: REL\ntitle: Religion\nvisibility: public\n---\n",
    "wiki/religion/lilith/index.md":
      "---\nid: K\ntype: knowledge\ntitle: Lilith\nvisibility: public\n---\n\n**Lilith** is a demon.\n",
    "library/article/index.md":
      "---\nid: SRC\ntype: source\ntitle: Article on Lilith\ncategory: REL\nvisibility: public\n---\n\nFull text.\n",
    "library/secret/index.md":
      "---\nid: SEC\ntype: source\ntitle: Secret\ncategory: REL\n---\n\nHidden.\n",
    "discussions/2026-01-01-1000-chat.md":
      "---\nid: D\ntype: discussion\ntitle: Chat\nabout: K\n---\n\n## user · 2026-01-01T10:00:00Z\nIs Lilith a demon?\n",
    "discussions/2026-01-01-1100-quiz.md":
      "---\nid: Q\ntype: discussion\nkind: quiz\ntitle: Quiz\nscope_node: REL\n---\n",
  };
  // The index of the article, written like the app does: one page per node.
  const before = await Promise.all(
    Object.entries(source).map(async ([path, text]) => ({ path, sha: await gitBlobSha(text) })),
  );
  const unindexed = await loadWiki({ files: before, readText: async (p) => source[p]! });
  const index = sourceIndexChanges(
    { config: unindexed.config, files: unindexed.files },
    unindexed.tree.nodes.get("SRC")!,
    {
      model: "m",
      textSha: "x",
      root: {
        name: "Article on Lilith",
        description: "From Mesopotamia to astrology.",
        knowledge: [],
        children: [
          {
            name: "Origins",
            description: "Lilith comes from Mesopotamia.",
            knowledge: [
              {
                title: "Mesopotamian origin",
                statement: "**Lilith** comes from Mesopotamia.",
                question: "Where does Lilith come from?",
                answer: "Mesopotamia",
              },
            ],
            children: [leaf("Lilitu", "Wind demons.")],
          },
          leaf("Black Moon", "The apogee of the Moon."),
        ],
      },
    },
  );
  for (const change of index) if (change.op === "write") source[change.path] = change.content;
  const files = await Promise.all(
    Object.entries(source).map(async ([path, text]) => ({ path, sha: await gitBlobSha(text) })),
  );
  const readText = async (path: string): Promise<string> => source[path]!;
  const wiki = await loadWiki({ files, readText });
  const view = { config: wiki.config, tree: wiki.tree, files: wiki.files, readText };
  const hierarchy = buildHierarchy(
    wiki.tree,
    [...wiki.discussions].map(([path, meta]) => ({ path, meta })),
  );

  it("goes from categories to sources, the sections of their index and discussions", async () => {
    const navigator = treeNavigator(view, "private", { hierarchy });
    const children = await navigator.children("REL");
    expect(children.map((c) => `${c.id}:${c.type}:${c.hasChildren}`)).toEqual([
      "K:knowledge:true",
      "SRC:source:true",
      "SEC:source:false",
    ]);
    // The description of an indexed source is the summary of its index.
    expect(children[1]!.description).toBe("From Mesopotamia to astrology.");
    expect((await navigator.children("K")).map((c) => c.id)).toEqual(["D"]);
    expect((await navigator.children("SRC")).map((c) => `${c.id} ${c.title}`)).toEqual([
      "SRC#origins Origins",
      "SRC#black-moon Black Moon",
    ]);
    expect((await navigator.children("SRC#origins")).map((c) => c.id)).toEqual([
      "SRC#origins/lilitu",
    ]);
    // The content of a section includes the knowledge it proposes.
    expect(await navigator.content("SRC#origins")).toBe(
      "Lilith comes from Mesopotamia.\n\nKey facts:\n- Lilith comes from Mesopotamia.\n\nSubsections: Lilitu.",
    );
    expect(await navigator.content("SRC")).toContain("Summary of the source (from its index)");
    expect(await navigator.content("SRC")).not.toContain("Full text.");
    expect(await navigator.content("D")).toBe("Chat\n\nUser: Is Lilith a demon?");
    expect(await navigator.resolve("SRC#origins/lilitu")).toMatchObject({
      title: "Lilitu",
      type: "section",
      path: ["Root", "Religion", "Article on Lilith", "Origins"],
    });
    expect(await navigator.resolve("D")).toMatchObject({ path: ["Root", "Religion", "Lilith"] });
    // Quizzes are not searched.
    expect(await navigator.resolve("Q")).toBeUndefined();
  });

  it("only shows public elements in the public scope", async () => {
    const navigator = treeNavigator(view, "public", { hierarchy });
    expect((await navigator.children("REL")).map((c) => c.id)).toEqual(["K", "SRC"]);
    expect(await navigator.resolve("D")).toBeUndefined();
    expect(await navigator.resolve("SEC")).toBeUndefined();
  });

  it("starts from the elements found by meaning, and only cites what was read", async () => {
    const navigator = treeNavigator(view, "private", { hierarchy });
    const provider = new FakeProvider({
      json: [{ explore: [], read: [], enough: true }],
      text: ["Lilith comes from [Origins](eugenia:SRC#origins). [Unread](eugenia:K)"],
    });
    const events: AskEvent[] = [];
    for await (const event of askTree(
      { provider },
      {
        question: "Where does Lilith come from?",
        scopeId: "R",
        navigator,
        candidates: [
          { id: "SRC#origins", score: 0.82 },
          { id: "Q", score: 0.8 },
        ],
        autoRead: 1,
      },
    ))
      events.push(event);
    expect(events.slice(0, 2)).toEqual([
      { type: "found", ids: ["SRC#origins"] },
      { type: "read", ids: ["SRC#origins"] },
    ]);
    const exploration = provider.calls[0]!.messages[0]!.content;
    expect(exploration).toContain(
      "- SRC#origins | Origins | section | has children | in: Root › Religion › Article on Lilith | found by meaning (82%)",
    );
    expect(exploration).toContain(
      "### Origins (section, SRC#origins)\nIn: Root › Religion › Article on Lilith",
    );
    expect(provider.calls[1]!.system).toContain("using only what you have read");
    expect(events.at(-1)).toMatchObject({
      type: "done",
      cited: ["SRC#origins"],
      consulted: ["SRC#origins"],
    });
  });

  it("files the knowledge proposed by the index, or puts it in the category of the source", async () => {
    const candidates = [
      { title: "Lilitu", statement: "**Lilitu** are wind demons.", question: "Q?", answer: "A" },
      { title: "Origin", statement: "**Lilith** is Mesopotamian.", question: "Q?", answer: "A" },
    ];
    const source = wiki.tree.nodes.get("SRC")!;
    const provider = new FakeProvider({
      json: [
        {
          new_categories: [{ key: "n1", title: "Demons", parent: "REL", reason: "Groups demons." }],
          assignments: [
            { item: 1, category: "n1" },
            { item: 2, category: "REL" },
          ],
        },
      ],
    });
    const plan = await indexExtractionPlan({ provider }, view, source, candidates, "Summary.");
    expect(plan.categorized).toBe(true);
    expect(plan.sourceId).toBe("SRC");
    expect(plan.categories).toEqual([{ key: "new:1", title: "Demons", parent: "REL" }]);
    expect(plan.knowledge.map((k) => k.category)).toEqual(["new:1", "REL"]);
    expect(provider.calls[0]!.messages[0]!.content).toContain("Excerpt:\nSummary.");

    // Without an answer of Eugenia: the category of the source.
    const failing = new FakeProvider({ json: [{ nothing: true }] });
    const fallback = await indexExtractionPlan({ provider: failing }, view, source, candidates);
    expect(fallback.categorized).toBe(false);
    expect(fallback.knowledge.map((k) => k.category)).toEqual(["REL", "REL"]);
  });

  it("grounds a discussion in the knowledge found", async () => {
    const navigator = treeNavigator(view, "private", { hierarchy });
    const provider = new FakeProvider({
      json: [
        // A section can only be read once its source has been explored.
        { explore: ["SRC"], read: ["SRC#black-moon"], enough: false },
        { explore: [], read: ["SRC#black-moon"], enough: true },
      ],
    });
    const knowledge = await gatherKnowledge(
      { provider },
      { question: "Black Moon?", scopeId: "REL", navigator, maxRounds: 2 },
    );
    expect(knowledge.map((k) => k.id)).toEqual(["SRC#black-moon"]);
    expect(knowledge[0]!.path).toEqual(["Root", "Religion", "Article on Lilith"]);
    const request: GenerateRequest = discussionRequest(
      { provider },
      { related: [], knowledge, history: [{ role: "user", content: "Black Moon?" }] },
    );
    expect(request.system).toContain("based only on the user's wiki");
    expect(request.system).toContain("<knowledge>\n### Black Moon (section, SRC#black-moon)");
    const empty = discussionRequest({ provider }, { related: [], history: [] });
    expect(empty.system).toContain("(nothing found in the wiki for this message)");
  });
});

describe("reasoning of the model", () => {
  it("sends the reasoning effort of the preset, only to chat requests", async () => {
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return Response.json({
        choices: [{ message: { content: "Paris" }, finish_reason: "stop" }],
        data: [{ index: 0, embedding: [1, 0] }],
      });
    }) as typeof fetch;
    const small = createProvider(
      {
        kind: "openai",
        baseUrl: "https://api.mistral.ai/v1",
        model: "mistral-small-latest",
        apiKey: "k",
        reasoningEffort: "none",
      },
      { fetch: fetchImpl },
    );
    await small.complete({ system: "S", messages: [] });
    await small.embed!(["text"]);
    const ministral = createProvider(
      { kind: "openai", baseUrl: "https://api.mistral.ai/v1", model: "ministral-8b-latest" },
      { fetch: fetchImpl },
    );
    await ministral.complete({ system: "S", messages: [] });
    expect(bodies.map((b) => b.reasoning_effort)).toEqual(["none", undefined, undefined]);
  });
});
