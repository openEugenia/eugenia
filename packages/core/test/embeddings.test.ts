import { describe, expect, it } from "vitest";
import {
  cosineSimilarity,
  embeddingEntries,
  embeddingPath,
  embeddingText,
  embeddingTextSha,
  moveNode,
  newEmbeddingDocument,
  parseEmbedding,
  rankBySimilarity,
  serializeEmbedding,
} from "../src/index.ts";
import { memoryWiki, page, type Files } from "./helpers.ts";

const CONFIG = "title: Test\nroot: wiki/\n";

/** Reproducible, normalized pseudo-random vector. */
function vector(seed: number, size = 1024): number[] {
  let x = seed;
  const out = Array.from({ length: size }, () => {
    x = (x * 1103515245 + 12345) % 2 ** 31;
    return x / 2 ** 31 - 0.5;
  });
  const norm = Math.hypot(...out);
  return out.map((v) => v / norm);
}

describe("format _embedding.json", () => {
  it("reads back an 8-bit quantized vector without losing its direction", () => {
    const original = vector(7);
    const text = serializeEmbedding(
      newEmbeddingDocument({
        model: "mistral-embed",
        textSha: "abc1234",
        vector: original,
        now: new Date("2026-11-18T10:00:00.123Z"),
      }),
    );
    const data = JSON.parse(text) as Record<string, unknown>;
    expect(data).toMatchObject({
      format: "eugenia-embedding",
      version: 1,
      model: "mistral-embed",
      text_sha: "abc1234",
      generated: "2026-11-18T10:00:00Z",
      dimensions: 1024,
      encoding: "int8",
    });
    // 1 byte per dimension, in base64.
    expect((data.vector as string).length).toBe(Math.ceil(1024 / 3) * 4);
    const doc = parseEmbedding(text);
    expect(doc.vector).toHaveLength(1024);
    expect(cosineSimilarity(original, doc.vector)).toBeGreaterThan(0.999);
  });

  it("refuses a file of another format or an inconsistent one", () => {
    expect(() => parseEmbedding('{"format": "other"}')).toThrow();
    const text = serializeEmbedding(
      newEmbeddingDocument({ model: "m", textSha: "abc1234", vector: [0.1, 0.2] }),
    );
    expect(() => parseEmbedding(text.replace('"dimensions": 2', '"dimensions": 3'))).toThrow();
  });
});

describe("text sent to the model", () => {
  it("keeps the title, tags and text, without frontmatter or link URLs", () => {
    const text = embeddingText(
      page(
        { id: "A", title: "Apogee", tags: ["astronomy"], updated: "2026-01-01T00:00:00Z" },
        "**Farthest** point, see [Moon](../moon/index.md).",
      ),
    );
    expect(text).toBe("Apogee\nTags: astronomy\n\nFarthest point, see Moon.");
  });

  it("puts together knowledge, question and answer of a flashcard, without section headings", () => {
    const text = embeddingText(
      page(
        { id: "L", type: "flashcard", title: "Lilith" },
        "## Knowledge\n**Lilith** is a demon.\n\n## Question\nWho?\n\n## Expected answer\nLilith",
      ),
    );
    expect(text).toBe("Lilith\n\nLilith is a demon.\n\nWho?\n\nLilith");
  });
});

describe("embedding state of a wiki", async () => {
  const moon = page({ id: "L", title: "Moon" }, "Satellite of the Earth.");
  const moonPath = "wiki/science/moon/index.md";
  const moonEmbedding = (textSha: string, model = "mistral-embed"): string =>
    serializeEmbedding(newEmbeddingDocument({ model, textSha, vector: vector(1, 8) }));
  const sha = await embeddingTextSha(embeddingText(moon));
  const files: Files = {
    ".notes/config.yml": CONFIG,
    "wiki/index.md": page({ id: "R", title: "Root" }, ""),
    "wiki/science/index.md": page({ id: "S", title: "Science" }, "The sciences."),
    [moonPath]: moon,
    "wiki/science/moon/_embedding.json": moonEmbedding(sha),
    "wiki/history/index.md": page({ id: "H", title: "History" }, "The past."),
    "wiki/history/_embedding.json": moonEmbedding("0000000"),
    "wiki/other/index.md": page({ id: "O", title: "Other" }, ""),
    "wiki/other/_embedding.json": moonEmbedding(sha, "other-model"),
  };
  const wiki = await memoryWiki(files);
  const entries = new Map(
    (await embeddingEntries(wiki.view, "mistral-embed")).map((e) => [e.node.id, e]),
  );

  it("attaches _embedding.json to its page, without making it an attachment", () => {
    const node = wiki.tree.nodes.get("L")!;
    expect(node.embedding?.path).toBe("wiki/science/moon/_embedding.json");
    expect(embeddingPath(node)).toBe("wiki/science/moon/_embedding.json");
    expect(node.attachments).toEqual([]);
  });

  it("tells current, stale and missing embeddings apart", () => {
    expect(entries.get("L")!.status).toBe("current");
    expect(entries.get("H")!.status).toBe("stale");
    expect(entries.get("S")!.status).toBe("missing");
    expect(entries.get("O")!.status).toBe("stale");
  });

  it("keeps a stale vector of the same model for searching, never one of another model", () => {
    expect(entries.get("H")!.vector).toBeDefined();
    expect(entries.get("O")!.vector).toBeUndefined();
  });

  it("stays current when the page is moved (rewritten links, identical text)", async () => {
    const changes = await moveNode(wiki.view, "L", "H");
    const moved = { ...files };
    for (const change of changes) {
      if (change.op === "delete") delete moved[change.path];
      else if (change.op === "write") moved[change.path] = change.content;
      else if (change.op === "copy") moved[change.path] = files[change.from]!;
    }
    expect(moved["wiki/history/moon/_embedding.json"]).toBeDefined();
    const after = await memoryWiki(moved);
    const [entry] = await embeddingEntries(after.view, "mistral-embed", [
      after.tree.nodes.get("L")!,
    ]);
    expect(entry!.status).toBe("current");
  });
});

describe("similarity", () => {
  it("ranks pages from closest to farthest, ignoring different dimensions", () => {
    const query = [1, 0, 0];
    const hits = rankBySimilarity(query, [
      { id: "far", vector: [0, 1, 0] },
      { id: "close", vector: [0.9, 0.1, 0] },
      { id: "other-model", vector: [1, 0] },
      { id: "middle", vector: [0.5, 0.5, 0] },
    ]);
    expect(hits.map((h) => h.id)).toEqual(["close", "middle", "far"]);
    expect(hits[0]!.score).toBeCloseTo(0.9939, 3);
  });
});
