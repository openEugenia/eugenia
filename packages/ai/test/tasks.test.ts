import { describe, expect, it } from "vitest";
import {
  AIError,
  askTree,
  evaluateAnswer,
  highlightKnowledge,
  locateQuote,
  proposeKnowledge,
  selectProvider,
  summarizeNode,
  type AskEvent,
  type TreeEntry,
} from "../src/index.ts";
import { FakeProvider } from "./fake.ts";

const TEXT =
  "Lilith est un démon féminin de la tradition juive, qui représente une divinité d'origine mésopotamienne. Dans les légendes juives, Lilith est présentée comme la première femme d'Adam, avant Ève.";

describe("extraction", () => {
  it("retrouve une citation exacte ou approchée", () => {
    expect(locateQuote(TEXT, "démon féminin")).toEqual({ start: 14, end: 27 });
    const approx = locateQuote("Il a dit « bonjour »  à tous.", 'dit "bonjour" à tous');
    expect(approx).toEqual({ start: 5, end: 28 });
    expect(locateQuote(TEXT, "absent du texte")).toBeNull();
  });

  it("surligne les connaissances proposées par Eugenia, avec leurs positions", async () => {
    const provider = new FakeProvider({
      json: [
        {
          highlights: [
            { quote: "Lilith est un démon féminin de la tradition juive", reason: "définition" },
            { quote: "inventé", reason: "introuvable" },
            { quote: "la première femme d'Adam, avant Ève", reason: "légende" },
          ],
        },
      ],
    });
    const highlights = await highlightKnowledge({ provider }, TEXT);
    expect(highlights.map((h) => h.quote)).toEqual([
      "Lilith est un démon féminin de la tradition juive",
      "la première femme d'Adam, avant Ève",
    ]);
    expect(TEXT.slice(highlights[1]!.start, highlights[1]!.end)).toBe(
      "la première femme d'Adam, avant Ève",
    );
    expect(provider.calls[0]!.messages[0]!.content).toContain("<etape>surlignage</etape>");
  });

  it("propose des flashcards et ne garde que des catégories connues", async () => {
    const provider = new FakeProvider({
      json: [
        {
          cards: [
            {
              highlight: 1,
              knowledge: "**Lilith** est un démon féminin de la tradition juive.",
              title: "Lilith",
              question: "Quel démon féminin… ?",
              answer: "Lilith",
              category: { existing_id: "REL", new_title: null, new_parent_id: null },
            },
            {
              highlight: 2,
              knowledge: "Lilith est **la première femme d'Adam**.",
              title: "Première femme d'Adam",
              question: "Qui… ?",
              answer: "Lilith",
              category: { existing_id: "INCONNU", new_title: "Mythes", new_parent_id: "REL" },
            },
            {
              highlight: 9,
              knowledge: "x",
              title: "x",
              question: "x",
              answer: "x",
              category: { existing_id: null, new_title: null, new_parent_id: null },
            },
          ],
        },
      ],
    });
    const proposals = await proposeKnowledge(
      { provider },
      {
        text: TEXT,
        highlights: [
          { id: "h1", quote: "Lilith est un démon" },
          { id: "h2", quote: "première femme d'Adam" },
        ],
        categories: [{ id: "REL", path: "Religion et croyances" }],
      },
    );
    expect(proposals.map((p) => [p.highlightId, p.category])).toEqual([
      ["h1", { existingId: "REL" }],
      ["h2", { newTitle: "Mythes", newParentId: "REL" }],
    ]);
  });
});

describe("descriptions et évaluation", () => {
  it("demande une description à partir des enfants", async () => {
    const provider = new FakeProvider({ text: ["  Une description.  "] });
    const text = await summarizeNode(
      { provider, variables: { wiki_title: "W" } },
      {
        title: "Astronomie",
        path: ["Racine", "Science"],
        children: [
          { title: "Lune", type: "flashcard", description: "La **Lune**…", isSubwiki: false },
        ],
      },
    );
    expect(text).toBe("Une description.");
    const message = provider.calls[0]!.messages[0]!.content;
    expect(message).toContain("Chemin : Racine > Science > Astronomie");
    expect(message).toContain("- [flashcard] Lune : La **Lune**…");
    expect(provider.calls[0]!.system).toContain("« W »");
  });

  it("borne le score entre 0 et 1", async () => {
    const provider = new FakeProvider({
      json: [{ score: 1.7, feedback: "Parfait", missing: [], superfluous: [] }],
    });
    const result = await evaluateAnswer(
      { provider },
      { knowledge: "**Lilith**", question: "Qui ?", expected: "Lilith", answer: "Lilith" },
    );
    expect(result.score).toBe(1);
  });
});

describe("questions sur l'arbre", () => {
  const entries: Record<string, TreeEntry> = {
    R: { id: "R", title: "Racine", type: "note", hasChildren: true },
    S: { id: "S", title: "Science", type: "note", hasChildren: true, description: "Sciences" },
    H: { id: "H", title: "Histoire", type: "note", hasChildren: true },
    L: { id: "L", title: "Lune noire", type: "flashcard", hasChildren: false },
  };
  const tree: Record<string, string[]> = { R: ["S", "H"], S: ["L"], H: [] };
  const navigator = {
    entry: (id: string) => entries[id],
    children: async (id: string) => (tree[id] ?? []).map((c) => entries[c]!),
    content: async (id: string) => `Contenu de ${id}`,
  };

  it("descend dans l'arbre puis répond en citant les pages lues", async () => {
    const provider = new FakeProvider({
      json: [
        { explore: ["S", "X"], read: [], enough: false },
        { explore: [], read: ["L"], enough: true },
      ],
      text: ["La [Lune noire](eugenia:L) est liée à Lilith. [Faux](eugenia:Z)"],
    });
    const events: AskEvent[] = [];
    for await (const event of askTree(
      { provider },
      { question: "Lune noire ?", scopeId: "R", navigator },
    ))
      events.push(event);
    expect(events.filter((e) => e.type === "explore" || e.type === "read")).toEqual([
      { type: "explore", ids: ["S"] },
      { type: "read", ids: ["L"] },
    ]);
    const done = events.at(-1);
    expect(done).toMatchObject({ type: "done", cited: ["L"], consulted: ["L"] });
    expect(provider.calls.at(-1)!.messages[0]!.content).toContain("Contenu de L");
  });
});

describe("IA locale pour le privé", () => {
  const remote = new FakeProvider({}, false);
  const local = new FakeProvider({}, true);

  it("bloque un traitement privé sans fournisseur local", () => {
    expect(() => selectProvider({ main: remote, localOnlyForPrivate: true }, true)).toThrow(
      AIError,
    );
    try {
      selectProvider({ main: remote, localOnlyForPrivate: true }, true);
    } catch (e) {
      expect((e as AIError).kind).toBe("privacy");
    }
  });

  it("utilise le fournisseur local pour le privé et le principal pour le public", () => {
    const selection = { main: remote, local, localOnlyForPrivate: true };
    expect(selectProvider(selection, true).provider).toBe(local);
    expect(selectProvider(selection, false).provider).toBe(remote);
  });

  it("signale l'envoi de contenu privé à un fournisseur distant", () => {
    expect(
      selectProvider({ main: remote, localOnlyForPrivate: false }, true).sendsPrivateToRemote,
    ).toBe(true);
    expect(
      selectProvider({ main: remote, localOnlyForPrivate: false }, false).sendsPrivateToRemote,
    ).toBe(false);
    expect(() => selectProvider({ localOnlyForPrivate: false }, false)).toThrow(
      /Aucun fournisseur/,
    );
  });
});
