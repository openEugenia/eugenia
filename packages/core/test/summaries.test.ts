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
      body: `Description of ${node.title}.`,
      sources: summarySources(wiki.tree, node, scope),
    }),
  );
}

const BASE: Files = {
  ".notes/config.yml": CONFIG,
  "wiki/index.md": page({ id: "R", title: "Root" }),
  "wiki/sci/index.md": page({ id: "S", title: "Science" }),
  "wiki/sci/astro/index.md": page({ id: "A", title: "Astronomy" }),
  "wiki/sci/astro/moon/index.md": page(
    { id: "L", type: "flashcard", title: "Moon" },
    "## Knowledge\nThe **Moon**.",
  ),
  "wiki/sci/bio/index.md": page({ id: "B", type: "flashcard", title: "Biology" }),
};

describe("sub-wiki descriptions", async () => {
  // Bottom-up generation: astro, then science, then root.
  const files: Files = { ...BASE };
  files["wiki/sci/astro/_summary.md"] = await summaryFor(files, "A");
  files["wiki/sci/_summary.md"] = await summaryFor(files, "S");
  files["wiki/_summary.md"] = await summaryFor(files, "R");

  it("writes and reads back a description", () => {
    const doc = parseSummary(files["wiki/sci/_summary.md"]!);
    expect(doc.fields.scope).toBe("private");
    expect(Object.keys(doc.fields.sources).sort()).toEqual(["A", "B", "S"]);
    expect(doc.body).toBe("Description of Science.\n");
  });

  it("uses the description of a child that has children, otherwise its content", async () => {
    const wiki = await memoryWiki(files);
    const sources = summarySources(wiki.tree, wiki.tree.nodes.get("S")!, "private");
    expect(sources.get("A")).toBe(await gitBlobSha(files["wiki/sci/astro/_summary.md"]!));
    expect(sources.get("B")).toBe(await gitBlobSha(files["wiki/sci/bio/index.md"]!));
    expect(shortSha(sources.get("B")!)).toHaveLength(7);
  });

  it("all descriptions are fresh after a bottom-up generation", async () => {
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

  it("a change makes the parent's and ancestors' descriptions stale", async () => {
    const changed = {
      ...files,
      "wiki/sci/astro/moon/index.md": page(
        { id: "L", type: "flashcard", title: "Moon" },
        "Changed",
      ),
    };
    const wiki = await memoryWiki(changed);
    const states = summaryStates(wiki.tree, "private", wiki.summaries);
    expect(states.get("A")).toEqual({ status: "stale", direct: true });
    expect(states.get("S")).toEqual({ status: "stale", direct: false });
    expect(states.get("R")!.status).toBe("stale");
    expect(regenerationOrder(wiki.tree, states).map((n) => n.id)).toEqual(["A", "S", "R"]);
  });

  it("a locked description is never offered and does not propagate its staleness", async () => {
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

  it("adding a child makes the description stale", async () => {
    const changed = {
      ...files,
      "wiki/sci/astro/mars/index.md": page({ id: "M", type: "flashcard", title: "Mars" }),
    };
    const wiki = await memoryWiki(changed);
    const states = summaryStates(wiki.tree, "private", wiki.summaries);
    expect(states.get("A")).toEqual({ status: "stale", direct: true });
  });

  it("reports missing descriptions, and the public scope only sees public children", async () => {
    const wiki = await memoryWiki({
      ...BASE,
      "wiki/index.md": page({ id: "R", title: "Root", visibility: "public" }),
      "wiki/sci/index.md": page({ id: "S", title: "Science", visibility: "public" }),
      "wiki/sci/astro/index.md": page({ id: "A", title: "Astronomy", visibility: "private" }),
    });
    const pub = summaryStates(wiki.tree, "public", wiki.summaries);
    expect(pub.get("R")!.status).toBe("missing");
    expect(pub.get("S")!.status).toBe("missing");
    expect(pub.get("A")!.status).toBe("none");
    const sources = summarySources(wiki.tree, wiki.tree.nodes.get("S")!, "public");
    expect([...sources.keys()].sort()).toEqual(["B", "S"]);
  });

  it("a private description involves private content as soon as a descendant is private", async () => {
    const wiki = await memoryWiki({
      ...BASE,
      "wiki/index.md": page({ id: "R", title: "Root", visibility: "public" }),
      "wiki/sci/index.md": page({ id: "S", title: "Science", visibility: "public" }),
      "wiki/sci/astro/index.md": page({ id: "A", title: "Astronomy", visibility: "public" }),
      "wiki/sci/astro/moon/index.md": page({
        id: "L",
        type: "flashcard",
        title: "Moon",
        visibility: "private",
      }),
      "wiki/sci/bio/index.md": page({
        id: "B",
        type: "flashcard",
        title: "Biology",
        visibility: "public",
      }),
    });
    const sci = wiki.tree.nodes.get("S")!;
    expect(summaryInvolvesPrivate(wiki.tree, sci, "private")).toBe(true);
    expect(summaryInvolvesPrivate(wiki.tree, sci, "public")).toBe(false);
    expect(summaryInvolvesPrivate(wiki.tree, wiki.tree.nodes.get("B")!, "private")).toBe(false);
  });
});
