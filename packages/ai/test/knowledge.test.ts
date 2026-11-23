import { describe, expect, it } from "vitest";
import {
  buildHierarchy,
  gitBlobSha,
  loadWiki,
  newSourceTreeDocument,
  serializeSourceTree,
  type KnowledgeNode,
} from "@openeugenia/core";
import {
  AIError,
  askTree,
  assembleTree,
  createProvider,
  discussionRequest,
  gatherKnowledge,
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
  children: [],
});

describe("indexing a source", () => {
  it("validates a recursive knowledge tree", () => {
    const tree = {
      name: "A",
      description: "a",
      children: [{ ...leaf("B"), children: [leaf("C")] }],
    };
    expect(KnowledgeNodeSchema.parse(tree)).toEqual(tree);
    expect(KnowledgeNodeSchema.safeParse({ name: "A", children: [] }).success).toBe(false);
  });

  it("describes a short source in a single request", async () => {
    const tree = {
      name: "Photosynthesis",
      description: "Light into sugar.",
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
        { name: "Part 1", description: "First.", children: [leaf("Origins"), leaf("Myths")] },
        {
          name: "Part 2",
          description: "Second.",
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
      return { name: `Half ${calls}`, description: "", children: [leaf(`Topic ${calls}`)] } as T;
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
  const index = serializeSourceTree(
    newSourceTreeDocument({
      model: "m",
      textSha: "x",
      root: {
        name: "Article on Lilith",
        description: "From Mesopotamia to astrology.",
        children: [
          {
            name: "Origins",
            description: "Lilith comes from Mesopotamia.",
            children: [leaf("Lilitu", "Wind demons.")],
          },
          leaf("Black Moon", "The apogee of the Moon."),
        ],
      },
    }),
  );
  const source: Record<string, string> = {
    ".notes/config.yml": "title: Test\nroot: wiki/\n",
    "wiki/index.md": "---\nid: R\ntitle: Root\nvisibility: public\n---\n",
    "wiki/religion/index.md": "---\nid: REL\ntitle: Religion\nvisibility: public\n---\n",
    "wiki/religion/lilith/index.md":
      "---\nid: K\ntype: knowledge\ntitle: Lilith\nvisibility: public\n---\n\n**Lilith** is a demon.\n",
    "library/article/index.md":
      "---\nid: SRC\ntype: source\ntitle: Article on Lilith\ncategory: REL\nvisibility: public\n---\n\nFull text.\n",
    "library/article/_tree.json": index,
    "library/secret/index.md":
      "---\nid: SEC\ntype: source\ntitle: Secret\ncategory: REL\n---\n\nHidden.\n",
    "discussions/2026-01-01-1000-chat.md":
      "---\nid: D\ntype: discussion\ntitle: Chat\nabout: K\n---\n\n## user · 2026-01-01T10:00:00Z\nIs Lilith a demon?\n",
    "discussions/2026-01-01-1100-quiz.md":
      "---\nid: Q\ntype: discussion\nkind: quiz\ntitle: Quiz\nscope_node: REL\n---\n",
  };
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
      "SRC#1 Origins",
      "SRC#2 Black Moon",
    ]);
    expect((await navigator.children("SRC#1")).map((c) => c.id)).toEqual(["SRC#1.1"]);
    expect(await navigator.content("SRC#1")).toBe(
      "Lilith comes from Mesopotamia.\n\nSubsections: Lilitu.",
    );
    expect(await navigator.content("SRC")).toContain("Summary of the source (from its index)");
    expect(await navigator.content("SRC")).not.toContain("Full text.");
    expect(await navigator.content("D")).toBe("Chat\n\nUser: Is Lilith a demon?");
    expect(await navigator.resolve("SRC#1.1")).toMatchObject({
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
      text: ["Lilith comes from [Origins](eugenia:SRC#1). [Unread](eugenia:K)"],
    });
    const events: AskEvent[] = [];
    for await (const event of askTree(
      { provider },
      {
        question: "Where does Lilith come from?",
        scopeId: "R",
        navigator,
        candidates: [
          { id: "SRC#1", score: 0.82 },
          { id: "Q", score: 0.8 },
        ],
        autoRead: 1,
      },
    ))
      events.push(event);
    expect(events.slice(0, 2)).toEqual([
      { type: "found", ids: ["SRC#1"] },
      { type: "read", ids: ["SRC#1"] },
    ]);
    const exploration = provider.calls[0]!.messages[0]!.content;
    expect(exploration).toContain(
      "- SRC#1 | Origins | section | has children | in: Root › Religion › Article on Lilith | found by meaning (82%)",
    );
    expect(exploration).toContain(
      "### Origins (section, SRC#1)\nIn: Root › Religion › Article on Lilith",
    );
    expect(provider.calls[1]!.system).toContain("using only what you have read");
    expect(events.at(-1)).toMatchObject({ type: "done", cited: ["SRC#1"], consulted: ["SRC#1"] });
  });

  it("grounds a discussion in the knowledge found", async () => {
    const navigator = treeNavigator(view, "private", { hierarchy });
    const provider = new FakeProvider({
      json: [
        // A section can only be read once its source has been explored.
        { explore: ["SRC"], read: ["SRC#2"], enough: false },
        { explore: [], read: ["SRC#2"], enough: true },
      ],
    });
    const knowledge = await gatherKnowledge(
      { provider },
      { question: "Black Moon?", scopeId: "REL", navigator, maxRounds: 2 },
    );
    expect(knowledge.map((k) => k.id)).toEqual(["SRC#2"]);
    expect(knowledge[0]!.path).toEqual(["Root", "Religion", "Article on Lilith"]);
    const request: GenerateRequest = discussionRequest(
      { provider },
      { related: [], knowledge, history: [{ role: "user", content: "Black Moon?" }] },
    );
    expect(request.system).toContain("based only on the user's wiki");
    expect(request.system).toContain("<knowledge>\n### Black Moon (section, SRC#2)");
    const empty = discussionRequest({ provider }, { related: [], history: [] });
    expect(empty.system).toContain("(nothing found in the wiki for this message)");
  });
});
