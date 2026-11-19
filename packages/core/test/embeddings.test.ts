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

/** Vecteur pseudo-aléatoire reproductible, normé. */
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
  it("relit un vecteur quantifié sur 8 bits sans perte de direction", () => {
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
    // 1 octet par dimension, en base64.
    expect((data.vector as string).length).toBe(Math.ceil(1024 / 3) * 4);
    const doc = parseEmbedding(text);
    expect(doc.vector).toHaveLength(1024);
    expect(cosineSimilarity(original, doc.vector)).toBeGreaterThan(0.999);
  });

  it("refuse un fichier d'un autre format ou incohérent", () => {
    expect(() => parseEmbedding('{"format": "autre"}')).toThrow();
    const text = serializeEmbedding(
      newEmbeddingDocument({ model: "m", textSha: "abc1234", vector: [0.1, 0.2] }),
    );
    expect(() => parseEmbedding(text.replace('"dimensions": 2', '"dimensions": 3'))).toThrow();
  });
});

describe("texte envoyé au modèle", () => {
  it("garde le titre, les étiquettes et le texte, sans frontmatter ni adresse de lien", () => {
    const text = embeddingText(
      page(
        { id: "A", title: "Apogée", tags: ["astronomie"], updated: "2026-01-01T00:00:00Z" },
        "Point le plus **éloigné**, voir [Lune](../lune/index.md).",
      ),
    );
    expect(text).toBe("Apogée\nÉtiquettes : astronomie\n\nPoint le plus éloigné, voir Lune.");
  });

  it("assemble connaissance, question et réponse d'une flashcard, sans les titres de section", () => {
    const text = embeddingText(
      page(
        { id: "L", type: "flashcard", title: "Lilith" },
        "## Connaissance\n**Lilith** est un démon.\n\n## Question\nQui ?\n\n## Réponse attendue\nLilith",
      ),
    );
    expect(text).toBe("Lilith\n\nLilith est un démon.\n\nQui ?\n\nLilith");
  });
});

describe("état des embeddings d'un wiki", async () => {
  const lune = page({ id: "L", title: "Lune" }, "Satellite de la Terre.");
  const lunePath = "wiki/science/lune/index.md";
  const luneEmbedding = (textSha: string, model = "mistral-embed"): string =>
    serializeEmbedding(newEmbeddingDocument({ model, textSha, vector: vector(1, 8) }));
  const sha = await embeddingTextSha(embeddingText(lune));
  const files: Files = {
    ".notes/config.yml": CONFIG,
    "wiki/index.md": page({ id: "R", title: "Racine" }, ""),
    "wiki/science/index.md": page({ id: "S", title: "Science" }, "Les sciences."),
    [lunePath]: lune,
    "wiki/science/lune/_embedding.json": luneEmbedding(sha),
    "wiki/histoire/index.md": page({ id: "H", title: "Histoire" }, "Le passé."),
    "wiki/histoire/_embedding.json": luneEmbedding("0000000"),
    "wiki/autre/index.md": page({ id: "O", title: "Autre" }, ""),
    "wiki/autre/_embedding.json": luneEmbedding(sha, "autre-modele"),
  };
  const wiki = await memoryWiki(files);
  const entries = new Map(
    (await embeddingEntries(wiki.view, "mistral-embed")).map((e) => [e.node.id, e]),
  );

  it("rattache _embedding.json à sa page, sans en faire une pièce jointe", () => {
    const node = wiki.tree.nodes.get("L")!;
    expect(node.embedding?.path).toBe("wiki/science/lune/_embedding.json");
    expect(embeddingPath(node)).toBe("wiki/science/lune/_embedding.json");
    expect(node.attachments).toEqual([]);
  });

  it("distingue embeddings à jour, périmés et manquants", () => {
    expect(entries.get("L")!.status).toBe("current");
    expect(entries.get("H")!.status).toBe("stale");
    expect(entries.get("S")!.status).toBe("missing");
    expect(entries.get("O")!.status).toBe("stale");
  });

  it("garde un vecteur périmé du même modèle pour chercher, jamais celui d'un autre modèle", () => {
    expect(entries.get("H")!.vector).toBeDefined();
    expect(entries.get("O")!.vector).toBeUndefined();
  });

  it("reste à jour quand la page est déplacée (liens réécrits, texte identique)", async () => {
    const changes = await moveNode(wiki.view, "L", "H");
    const moved = { ...files };
    for (const change of changes) {
      if (change.op === "delete") delete moved[change.path];
      else if (change.op === "write") moved[change.path] = change.content;
      else if (change.op === "copy") moved[change.path] = files[change.from]!;
    }
    expect(moved["wiki/histoire/lune/_embedding.json"]).toBeDefined();
    const after = await memoryWiki(moved);
    const [entry] = await embeddingEntries(after.view, "mistral-embed", [
      after.tree.nodes.get("L")!,
    ]);
    expect(entry!.status).toBe("current");
  });
});

describe("similarité", () => {
  it("classe les pages de la plus à la moins proche, en ignorant les dimensions différentes", () => {
    const query = [1, 0, 0];
    const hits = rankBySimilarity(query, [
      { id: "loin", vector: [0, 1, 0] },
      { id: "proche", vector: [0.9, 0.1, 0] },
      { id: "autre-modele", vector: [1, 0] },
      { id: "moyen", vector: [0.5, 0.5, 0] },
    ]);
    expect(hits.map((h) => h.id)).toEqual(["proche", "moyen", "loin"]);
    expect(hits[0]!.score).toBeCloseTo(0.9939, 3);
  });
});
