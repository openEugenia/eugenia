import { describe, expect, it } from "vitest";
import { gitBlobSha, loadWiki } from "@openeugenia/core";
import {
  AIError,
  askTree,
  categoryOptions,
  discussionRequest,
  evaluateAnswer,
  pageText,
  proposeFlashcards,
  treeNavigator,
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
    expect(message).toContain("Niveau : branche");
    expect(message).toContain("- [flashcard] Lune : La **Lune**…");
    expect(provider.calls[0]!.system).toContain("« W »");
    expect(provider.calls[0]!.system).toContain("première personne");
  });

  it("signale la racine du wiki, décrite par « Voici mon wiki… »", async () => {
    const provider = new FakeProvider({ text: ["Voici mon wiki."] });
    await summarizeNode({ provider }, { title: "Racine", path: [], children: [] });
    expect(provider.calls[0]!.messages[0]!.content).toContain("Niveau : racine du wiki");
    expect(provider.calls[0]!.system).toContain("« Voici mon wiki… »");
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
    R: { id: "R", title: "Racine", type: "catégorie", hasChildren: true },
    S: { id: "S", title: "Science", type: "catégorie", hasChildren: true, description: "Sciences" },
    H: { id: "H", title: "Histoire", type: "catégorie", hasChildren: true },
    L: { id: "L", title: "Lune noire", type: "connaissance", hasChildren: false },
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

describe("flashcards d'une connaissance", () => {
  it("propose de nouvelles flashcards, sans doublon des existantes", async () => {
    const provider = new FakeProvider({
      json: [
        {
          cards: [
            { question: "Qui est Lilith ?", answer: "Un démon féminin" },
            { question: "Quel est le nom du démon ?", answer: "Lilith" },
            { question: "  ", answer: "vide" },
          ],
        },
      ],
    });
    const cards = await proposeFlashcards(
      { provider },
      {
        knowledge: "**Lilith** est un démon féminin.",
        title: "Lilith",
        path: ["Religion"],
        existing: [{ question: "Quel est le nom du démon ?", answer: "Lilith" }],
        count: 2,
      },
    );
    expect(cards).toEqual([{ question: "Qui est Lilith ?", answer: "Un démon féminin" }]);
    const content = provider.calls[0]!.messages[0]!.content;
    expect(content).toContain("Chemin : Religion > Lilith");
    expect(content).toContain("<nombre>2</nombre>");
  });
});

describe("discussions", () => {
  it("répond à une note rapide avec son propre prompt et la bibliothèque", () => {
    const request = discussionRequest(
      { provider: new FakeProvider({}) },
      {
        kind: "note",
        related: [],
        sources: [{ id: "S1", title: "Un article" }],
        history: [{ role: "user", content: "Une idée." }],
      },
    );
    expect(request.system).toContain("note rapide");
    expect(request.system).toContain("<bibliotheque>\n- S1 | Un article\n</bibliotheque>");
    expect(request.system).not.toContain("<page>");
  });
});

describe("passerelle avec le wiki", async () => {
  const source: Record<string, string> = {
    ".notes/config.yml": "title: Test\nroot: wiki/\n",
    "wiki/index.md": "---\nid: R\ntype: category\ntitle: Racine\n---\n",
    "wiki/science/index.md": "---\nid: S\ntitle: Science\n---\n",
    "wiki/science/lune/index.md":
      "---\nid: K\ntype: knowledge\ntitle: Lune noire\n---\n\nLa **Lune noire** est un point.\n\n## Notes\nVoir l'apogée.\n",
    "wiki/science/lune/carte/index.md":
      "---\nid: C\ntype: flashcard\ntitle: Carte\n---\n\n## Question\nQuel point ?\n\n## Réponse attendue\nLa Lune noire\n",
    "library/livre/index.md":
      "---\nid: L\ntype: source\ntitle: Livre\nauthors: [Ada]\npublished: '1843'\n---\n\nRésumé.\n",
  };
  const files = await Promise.all(
    Object.entries(source).map(async ([path, text]) => ({ path, sha: await gitBlobSha(text) })),
  );
  const readText = async (path: string): Promise<string> => source[path]!;
  const wiki = await loadWiki({ files, readText });
  const view = { config: wiki.config, tree: wiki.tree, files: wiki.files, readText };

  it("décrit chaque type de page", async () => {
    const node = (id: string) => wiki.tree.nodes.get(id)!;
    expect(await pageText(view, node("K"))).toBe(
      "Connaissance : La Lune noire est un point.\n\nNotes\nVoir l'apogée.",
    );
    expect(await pageText(view, node("C"))).toBe(
      "Connaissance : La Lune noire est un point.\nQuestion : Quel point ?\nRéponse attendue : La Lune noire",
    );
    expect(await pageText(view, node("L"))).toBe("Auteurs : Ada\nPublication : 1843\nRésumé.");
  });

  it("ne propose que des catégories et s'arrête aux connaissances", async () => {
    expect(categoryOptions(view).map((c) => c.id)).toEqual(["R", "S"]);
    const navigator = treeNavigator(view, "private");
    const [lune] = await navigator.children("S");
    expect(lune).toMatchObject({ id: "K", type: "connaissance", hasChildren: false });
    expect(await navigator.content("K")).toContain("Flashcards :\n- Quel point ? → La Lune noire");
  });
});
