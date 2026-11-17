import { describe, expect, it } from "vitest";
import {
  gitBlobSha,
  newSummaryDocument,
  parseSummary,
  regenerationOrder,
  serializeSummary,
  shortSha,
  summarySources,
  summaryInvolvesPrivate,
  summaryStates,
} from "../src/index.ts";
import { CONFIG, memoryWiki, page, type Files } from "./helpers.ts";

async function summaryFor(
  files: Files,
  nodeId: string,
  scope: "private" | "public" = "private",
): Promise<string> {
  const wiki = await memoryWiki(files);
  const node = wiki.tree.nodes.get(nodeId)!;
  return serializeSummary(
    newSummaryDocument({
      id: `S-${nodeId}`,
      scope,
      body: `Description de ${node.title}.`,
      sources: summarySources(wiki.tree, node, scope),
    }),
  );
}

const BASE: Files = {
  ".notes/config.yml": CONFIG,
  "wiki/index.md": page({ id: "R", title: "Racine" }),
  "wiki/sci/index.md": page({ id: "S", title: "Science" }),
  "wiki/sci/astro/index.md": page({ id: "A", title: "Astronomie" }),
  "wiki/sci/astro/lune/index.md": page(
    { id: "L", type: "flashcard", title: "Lune" },
    "## Connaissance\nLa **Lune**.",
  ),
  "wiki/sci/bio/index.md": page({ id: "B", type: "flashcard", title: "Biologie" }),
};

describe("descriptions des sous-wikis", async () => {
  // Génération ascendante : astro, puis science, puis racine.
  const files: Files = { ...BASE };
  files["wiki/sci/astro/_summary.md"] = await summaryFor(files, "A");
  files["wiki/sci/_summary.md"] = await summaryFor(files, "S");
  files["wiki/_summary.md"] = await summaryFor(files, "R");

  it("écrit et relit une description", () => {
    const doc = parseSummary(files["wiki/sci/_summary.md"]!);
    expect(doc.fields.scope).toBe("private");
    expect(Object.keys(doc.fields.sources).sort()).toEqual(["A", "B", "S"]);
    expect(doc.body).toBe("Description de Science.\n");
  });

  it("utilise la description d'un enfant qui a des enfants, sinon son contenu", async () => {
    const wiki = await memoryWiki(files);
    const sources = summarySources(wiki.tree, wiki.tree.nodes.get("S")!, "private");
    expect(sources.get("A")).toBe(await gitBlobSha(files["wiki/sci/astro/_summary.md"]!));
    expect(sources.get("B")).toBe(await gitBlobSha(files["wiki/sci/bio/index.md"]!));
    expect(shortSha(sources.get("B")!)).toHaveLength(7);
  });

  it("toutes les descriptions sont à jour après une génération ascendante", async () => {
    const wiki = await memoryWiki(files);
    const states = summaryStates(wiki.tree, "private", wiki.summaries);
    expect(Object.fromEntries([...states].map(([id, s]) => [id, s.status]))).toEqual({
      R: "fresh",
      S: "fresh",
      A: "fresh",
      L: "none",
      B: "none",
    });
  });

  it("une modification rend périmées la description du parent et celles des ancêtres", async () => {
    const changed = {
      ...files,
      "wiki/sci/astro/lune/index.md": page(
        { id: "L", type: "flashcard", title: "Lune" },
        "Modifiée",
      ),
    };
    const wiki = await memoryWiki(changed);
    const states = summaryStates(wiki.tree, "private", wiki.summaries);
    expect(states.get("A")).toEqual({ status: "stale", direct: true });
    expect(states.get("S")).toEqual({ status: "stale", direct: false });
    expect(states.get("R")!.status).toBe("stale");
    expect(regenerationOrder(wiki.tree, states).map((n) => n.id)).toEqual(["A", "S", "R"]);
  });

  it("une description verrouillée n'est jamais proposée et ne propage pas sa péremption", async () => {
    const locked = parseSummary(files["wiki/sci/astro/_summary.md"]!);
    locked.fields.locked = true;
    const lockedFiles: Files = { ...files, "wiki/sci/astro/_summary.md": serializeSummary(locked) };
    lockedFiles["wiki/sci/_summary.md"] = await summaryFor(lockedFiles, "S");
    lockedFiles["wiki/_summary.md"] = await summaryFor(lockedFiles, "R");
    const changed = {
      ...lockedFiles,
      "wiki/sci/astro/mars/index.md": page({ id: "M", type: "flashcard", title: "Mars" }),
    };
    const wiki = await memoryWiki(changed);
    const states = summaryStates(wiki.tree, "private", wiki.summaries);
    expect(states.get("A")!.status).toBe("locked");
    expect(states.get("S")!.status).toBe("fresh");
    expect(regenerationOrder(wiki.tree, states)).toEqual([]);
  });

  it("un ajout d'enfant rend la description périmée", async () => {
    const changed = {
      ...files,
      "wiki/sci/astro/mars/index.md": page({ id: "M", type: "flashcard", title: "Mars" }),
    };
    const wiki = await memoryWiki(changed);
    const states = summaryStates(wiki.tree, "private", wiki.summaries);
    expect(states.get("A")).toEqual({ status: "stale", direct: true });
  });

  it("signale les descriptions manquantes et la portée publique ne voit que les enfants publics", async () => {
    const wiki = await memoryWiki({
      ...BASE,
      "wiki/index.md": page({ id: "R", title: "Racine", visibility: "public" }),
      "wiki/sci/index.md": page({ id: "S", title: "Science", visibility: "public" }),
      "wiki/sci/astro/index.md": page({ id: "A", title: "Astronomie", visibility: "private" }),
    });
    const pub = summaryStates(wiki.tree, "public", wiki.summaries);
    expect(pub.get("R")!.status).toBe("missing");
    expect(pub.get("S")!.status).toBe("missing");
    expect(pub.get("A")!.status).toBe("none");
    const sources = summarySources(wiki.tree, wiki.tree.nodes.get("S")!, "public");
    expect([...sources.keys()].sort()).toEqual(["B", "S"]);
  });

  it("une description privée implique du contenu privé dès qu'un descendant est privé", async () => {
    const wiki = await memoryWiki({
      ...BASE,
      "wiki/index.md": page({ id: "R", title: "Racine", visibility: "public" }),
      "wiki/sci/index.md": page({ id: "S", title: "Science", visibility: "public" }),
      "wiki/sci/astro/index.md": page({ id: "A", title: "Astronomie", visibility: "public" }),
      "wiki/sci/astro/lune/index.md": page({
        id: "L",
        type: "flashcard",
        title: "Lune",
        visibility: "private",
      }),
      "wiki/sci/bio/index.md": page({
        id: "B",
        type: "flashcard",
        title: "Biologie",
        visibility: "public",
      }),
    });
    const sci = wiki.tree.nodes.get("S")!;
    expect(summaryInvolvesPrivate(wiki.tree, sci, "private")).toBe(true);
    expect(summaryInvolvesPrivate(wiki.tree, sci, "public")).toBe(false);
    expect(summaryInvolvesPrivate(wiki.tree, wiki.tree.nodes.get("B")!, "private")).toBe(false);
  });
});
