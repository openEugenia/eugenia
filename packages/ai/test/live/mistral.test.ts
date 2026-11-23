/**
 * Real-world tests against Mistral's API (OpenAI-compatible).
 *
 * Excluded from `pnpm test`: run `pnpm test:live`, with MISTRAL_API_KEY in the `.env` file at
 * the repository root (ignored by git) or in the environment. Without a key, these tests are
 * skipped.
 *
 * The free tier limits each model to 2 requests per minute: the tests are spread over several
 * models, and requests refused for that reason (429) are replayed after a pause. A model's
 * answers vary from one run to the next: rerun an isolated failure of the evaluation tests
 * before interpreting it.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  newEmbeddingDocument,
  parseEmbedding,
  rankBySimilarity,
  serializeEmbedding,
} from "@openeugenia/core";
import {
  createProvider,
  DEFAULT_EMBEDDING_MODEL,
  embedQuery,
  embedTexts,
  evaluateAnswer,
  summarizeNode,
  type AIProvider,
} from "../../src/index.ts";

const KEY = process.env.MISTRAL_API_KEY;
const BASE_URL = "https://api.mistral.ai/v1";
const RETRY_DELAY_MS = 20_000;
const MAX_RETRIES = 4;

interface LiveProvider {
  provider: AIProvider;
  /** `response_format` of each accepted request (except 429), in order. */
  formats: () => string[];
}

function mistral(model: string, apiKey = KEY): LiveProvider {
  const formats: string[] = [];
  const patientFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(input, init);
      if (response.status !== 429 || attempt >= MAX_RETRIES) {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          response_format?: { type?: string };
        };
        formats.push(body.response_format?.type ?? "text");
        return response;
      }
      await response.body?.cancel();
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  };
  const provider = createProvider(
    { kind: "openai", baseUrl: BASE_URL, model, label: "Mistral", ...(apiKey ? { apiKey } : {}) },
    { fetch: patientFetch },
  );
  return { provider, formats: () => [...formats] };
}

describe.skipIf(!KEY)("Mistral, real API", () => {
  describe("OpenAI-compatible provider", () => {
    it("answers a simple request", async () => {
      const { provider } = mistral("ministral-3b-latest");
      const text = await provider.complete({
        system: "Answer in a single word, without punctuation.",
        messages: [{ role: "user", content: "What is the capital of France?" }],
        maxTokens: 20,
      });
      expect(text.toLowerCase()).toContain("paris");
    });

    it("streams the answer in several fragments", async () => {
      const { provider } = mistral("ministral-3b-latest");
      const chunks: string[] = [];
      for await (const chunk of provider.stream({
        system: "You answer only with numbers in digits, separated by spaces.",
        messages: [{ role: "user", content: "Count from 1 to 20." }],
        maxTokens: 100,
      }))
        chunks.push(chunk);
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.join("")).toMatch(/1\D+2\D+3\D+4/);
    });

    it("gets a strict JSON output with the first format tried", async () => {
      const { provider, formats } = mistral("ministral-8b-latest");
      const result = await provider.json({
        system: "You extract factual information from the text provided.",
        messages: [
          { role: "user", content: "Lyon, in France, has about 0.5 million inhabitants." },
        ],
        schema: z.object({
          city: z.string(),
          country: z.string(),
          population_millions: z.number(),
        }),
        name: "city",
        maxTokens: 200,
      });
      expect(result.city).toMatch(/lyon/i);
      expect(result.country).toMatch(/france/i);
      expect(result.population_millions).toBeCloseTo(0.5, 0);
      // No fallback to `json_object` or free text: a single request.
      expect(formats()).toEqual(["json_schema"]);
    });

    it("reports a refused key as an authentication error", async () => {
      const { provider } = mistral("ministral-3b-latest", "invalid-key");
      await expect(
        provider.complete({ system: "", messages: [{ role: "user", content: "Hello" }] }),
      ).rejects.toMatchObject({ name: "AIError", kind: "auth", status: 401 });
    });
  });

  describe("evaluation of a quiz answer", () => {
    const { provider } = mistral("ministral-14b-latest");
    const card = {
      knowledge:
        "In constraint programming, a **variable** takes its value in a **finite domain** of possible values: booleans, integers or sets.",
      question:
        "In constraint programming, where does a variable take its value, and what types can these values have?",
      expected: "In a finite domain of possible values: booleans, integers or sets.",
    };

    it("ignores the order of a list", async () => {
      const result = await evaluateAnswer(
        { provider },
        {
          ...card,
          answer: "In a finite domain of values: sets, integers or booleans.",
        },
      );
      expect(result.score, result.feedback).toBeGreaterThanOrEqual(0.9);
      expect(result.missing).toEqual([]);
      expect(result.feedback).not.toMatch(/\border\b/i);
    });

    it("penalizes a wrong answer", async () => {
      const result = await evaluateAnswer(
        { provider },
        { ...card, answer: "In a continuous interval of real numbers." },
      );
      expect(result.score, result.feedback).toBeLessThan(0.5);
    });
  });

  describe("description of a sub-wiki", () => {
    const { provider } = mistral("ministral-8b-latest");
    const firstPerson = /\b(I|I'm|I've|my|me)\b/;
    const thirdPerson = /\b(the user|the author|this (sub-)?wiki (explores|gathers|contains))/i;
    const children = [
      {
        title: "Apogee",
        type: "flashcard",
        description:
          "The **apogee** is the point of the orbit of a body around the Earth where it is farthest from it.",
        isSubwiki: false,
      },
      {
        title: "Exoplanets",
        type: "flashcard",
        description:
          "**51 Pegasi b** is the first exoplanet discovered around a Sun-like star, in 1995.",
        isSubwiki: false,
      },
    ];

    it('presents the root in the first person: "This is my wiki…"', async () => {
      const text = await summarizeNode(
        { provider, variables: { wiki_title: "My knowledge" } },
        { title: "My knowledge", path: [], children },
      );
      expect(text).toMatch(/^This is my wiki/i);
      expect(text).not.toMatch(thirdPerson);
    });

    it("describes a branch in the first person", async () => {
      const text = await summarizeNode(
        { provider, variables: { wiki_title: "My knowledge" } },
        { title: "Astronomy", path: ["My knowledge", "Science"], children },
      );
      expect(text).toMatch(firstPerson);
      expect(text).not.toMatch(thirdPerson);
    });
  });

  describe("embeddings (mistral-embed)", () => {
    const { provider } = mistral(DEFAULT_EMBEDDING_MODEL);
    const pages: Record<string, string> = {
      apogee:
        "Apogee\n\nThe apogee is the point of the orbit of a body around the Earth where it is farthest from it.",
      lilith:
        "Lilith\n\nLilith is a female demon of Jewish tradition, inspired by a deity of Mesopotamian origin.",
      cogito:
        "Cogito\n\nI think, therefore I am: Descartes grounds certainty on the awareness of his own thinking.",
      exoplanets:
        "Exoplanets\n\n51 Pegasi b is the first exoplanet discovered around a Sun-like star, in 1995.",
    };

    it("finds the page that answers a question, with no word in common", async () => {
      const ids = Object.keys(pages);
      const vectors = await embedTexts(provider, Object.values(pages));
      expect(vectors.map((v) => v.length)).toEqual([1024, 1024, 1024, 1024]);
      // The vectors go through the stored format (8-bit quantized).
      const items = ids.map((id, i) => ({
        id,
        vector: parseEmbedding(
          serializeEmbedding(
            newEmbeddingDocument({ model: "m", textSha: "0", vector: vectors[i]! }),
          ),
        ).vector,
      }));
      const best = async (query: string): Promise<string | undefined> =>
        rankBySimilarity(await embedQuery(provider, query), items)[0]?.id;
      expect(await best("How far can a satellite move away from our planet?")).toBe("apogee");
      expect(await best("demonic figure of Hebrew legends")).toBe("lilith");
      expect(await best("philosopher who doubts everything except his own existence")).toBe(
        "cogito",
      );
    });
  });
});
