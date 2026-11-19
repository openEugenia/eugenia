/**
 * Tests en conditions réelles contre l'API de Mistral (compatible OpenAI).
 *
 * Exclus de `pnpm test` : lancez `pnpm test:live`, avec MISTRAL_API_KEY dans le fichier
 * `.env` à la racine du dépôt (ignoré par git) ou dans l'environnement. Sans clé, ces tests
 * sont ignorés.
 *
 * L'offre gratuite limite chaque modèle à 2 requêtes par minute : les tests se répartissent
 * sur plusieurs modèles et les requêtes refusées pour cette raison (429) sont rejouées après
 * une pause. Les réponses d'un modèle varient d'une exécution à l'autre : un échec isolé des
 * tests d'évaluation est à relancer avant d'être interprété.
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
  /** `response_format` de chaque requête acceptée (hors 429), dans l'ordre. */
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
        formats.push(body.response_format?.type ?? "texte");
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

describe.skipIf(!KEY)("Mistral, API réelle", () => {
  describe("fournisseur compatible OpenAI", () => {
    it("répond à une requête simple", async () => {
      const { provider } = mistral("ministral-3b-latest");
      const text = await provider.complete({
        system: "Réponds en un seul mot, sans ponctuation.",
        messages: [{ role: "user", content: "Quelle est la capitale de la France ?" }],
        maxTokens: 20,
      });
      expect(text.toLowerCase()).toContain("paris");
    });

    it("diffuse la réponse en plusieurs fragments", async () => {
      const { provider } = mistral("ministral-3b-latest");
      const chunks: string[] = [];
      for await (const chunk of provider.stream({
        system: "Tu réponds uniquement par des nombres en chiffres, séparés par des espaces.",
        messages: [{ role: "user", content: "Compte de 1 à 20." }],
        maxTokens: 100,
      }))
        chunks.push(chunk);
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.join("")).toMatch(/1\D+2\D+3\D+4/);
    });

    it("obtient une sortie JSON stricte dès le premier format essayé", async () => {
      const { provider, formats } = mistral("ministral-8b-latest");
      const result = await provider.json({
        system: "Tu extrais des informations factuelles du texte fourni.",
        messages: [
          { role: "user", content: "Lyon, en France, compte environ 0,5 million d'habitants." },
        ],
        schema: z.object({
          city: z.string(),
          country: z.string(),
          population_millions: z.number(),
        }),
        name: "ville",
        maxTokens: 200,
      });
      expect(result.city).toMatch(/lyon/i);
      expect(result.country).toMatch(/france/i);
      expect(result.population_millions).toBeCloseTo(0.5, 0);
      // Sans repli vers `json_object` ou le texte libre : une seule requête.
      expect(formats()).toEqual(["json_schema"]);
    });

    it("signale une clé refusée comme une erreur d'authentification", async () => {
      const { provider } = mistral("ministral-3b-latest", "cle-invalide");
      await expect(
        provider.complete({ system: "", messages: [{ role: "user", content: "Bonjour" }] }),
      ).rejects.toMatchObject({ name: "AIError", kind: "auth", status: 401 });
    });
  });

  describe("évaluation d'une réponse de quiz", () => {
    const { provider } = mistral("ministral-14b-latest");
    const card = {
      knowledge:
        "En programmation par contraintes, une **variable** prend sa valeur dans un **domaine fini** de valeurs possibles : des booléens, des entiers ou des ensembles.",
      question:
        "En programmation par contraintes, dans quoi une variable prend-elle sa valeur, et de quels types peuvent être ces valeurs ?",
      expected: "Dans un domaine fini de valeurs possibles : booléens, entiers ou ensembles.",
    };

    it("ne tient pas compte de l'ordre d'une énumération", async () => {
      const result = await evaluateAnswer(
        { provider },
        {
          ...card,
          answer: "Dans un domaine fini de valeurs : des ensembles, des entiers ou des booléens.",
        },
      );
      expect(result.score, result.feedback).toBeGreaterThanOrEqual(0.9);
      expect(result.missing).toEqual([]);
      expect(result.feedback).not.toMatch(/\bordre\b/i);
    });

    it("sanctionne une réponse fausse", async () => {
      const result = await evaluateAnswer(
        { provider },
        { ...card, answer: "Dans un intervalle continu de nombres réels." },
      );
      expect(result.score, result.feedback).toBeLessThan(0.5);
    });
  });

  describe("description d'un sous-wiki", () => {
    const { provider } = mistral("ministral-8b-latest");
    const firstPerson = /\b(je|j'|j’|mon|ma|mes|m'|m’)/i;
    const thirdPerson =
      /\b(l['’]utilisateur|l['’]auteur|ce (sous-)?wiki (explore|rassemble|contient))/i;
    const children = [
      {
        title: "Apogée",
        type: "flashcard",
        description:
          "L'**apogée** est le point de l'orbite d'un corps autour de la Terre où il en est le plus éloigné.",
        isSubwiki: false,
      },
      {
        title: "Exoplanètes",
        type: "flashcard",
        description:
          "**51 Pegasi b** est la première exoplanète découverte autour d'une étoile semblable au Soleil, en 1995.",
        isSubwiki: false,
      },
    ];

    it("présente la racine à la première personne : « Voici mon wiki… »", async () => {
      const text = await summarizeNode(
        { provider, variables: { wiki_title: "Mes connaissances" } },
        { title: "Mes connaissances", path: [], children },
      );
      expect(text).toMatch(/^Voici mon wiki/i);
      expect(text).not.toMatch(thirdPerson);
    });

    it("décrit une branche à la première personne", async () => {
      const text = await summarizeNode(
        { provider, variables: { wiki_title: "Mes connaissances" } },
        { title: "Astronomie", path: ["Mes connaissances", "Science"], children },
      );
      expect(text).toMatch(firstPerson);
      expect(text).not.toMatch(thirdPerson);
    });
  });

  describe("embeddings (mistral-embed)", () => {
    const { provider } = mistral(DEFAULT_EMBEDDING_MODEL);
    const pages: Record<string, string> = {
      apogee:
        "Apogée\n\nL'apogée est le point de l'orbite d'un corps autour de la Terre où il en est le plus éloigné.",
      lilith:
        "Lilith\n\nLilith est un démon féminin de la tradition juive, inspiré d'une divinité d'origine mésopotamienne.",
      cogito:
        "Cogito\n\nJe pense, donc je suis : Descartes fonde la certitude sur la conscience de sa propre pensée.",
      exoplanetes:
        "Exoplanètes\n\n51 Pegasi b est la première exoplanète découverte autour d'une étoile semblable au Soleil, en 1995.",
    };

    it("retrouve la page qui répond à une question, sans mot en commun", async () => {
      const ids = Object.keys(pages);
      const vectors = await embedTexts(provider, Object.values(pages));
      expect(vectors.map((v) => v.length)).toEqual([1024, 1024, 1024, 1024]);
      // Les vecteurs passent par le format enregistré (quantifié sur 8 bits).
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
      expect(await best("Jusqu'où un satellite peut-il s'écarter de notre planète ?")).toBe(
        "apogee",
      );
      expect(await best("figure démoniaque des légendes hébraïques")).toBe("lilith");
      expect(await best("philosophe qui doute de tout sauf de sa propre existence")).toBe("cogito");
    });
  });
});
