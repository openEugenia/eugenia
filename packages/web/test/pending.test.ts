import { describe, expect, it } from "vitest";
import { gitBlobSha, type RepoFile } from "@openeugenia/core";
import {
  discardChanges,
  emptyPending,
  generatedMessage,
  queueCommit,
  stageChanges,
  uncommittedPaths,
  workingFiles,
} from "../src/lib/pending.ts";

async function remote(files: Record<string, string>): Promise<Map<string, RepoFile>> {
  const out = new Map<string, RepoFile>();
  for (const [path, content] of Object.entries(files))
    out.set(path, { path, sha: await gitBlobSha(content) });
  return out;
}

describe("modifications en attente", async () => {
  const base = await remote({
    "wiki/a/index.md": "A",
    "wiki/b/index.md": "B",
    "wiki/a/photo.png": "PNG",
  });

  it("garde le SHA distant de la première modification", async () => {
    let state = await stageChanges(
      emptyPending(),
      [{ op: "write", path: "wiki/a/index.md", content: "A1" }],
      base,
      "Modifier A",
    );
    state = await stageChanges(
      state,
      [{ op: "write", path: "wiki/a/index.md", content: "A2" }],
      base,
      "Modifier A encore",
    );
    const change = state.changes["wiki/a/index.md"]!;
    expect(change.baseSha).toBe(base.get("wiki/a/index.md")!.sha);
    expect(change.content).toBe("A2");
    expect(change.sha).toBe(await gitBlobSha("A2"));
    expect(state.log.map((e) => e.description)).toEqual(["Modifier A", "Modifier A encore"]);
  });

  it("oublie une modification qui revient au contenu d'origine", async () => {
    let state = await stageChanges(
      emptyPending(),
      [{ op: "write", path: "wiki/a/index.md", content: "A1" }],
      base,
      "x",
    );
    state = await stageChanges(
      state,
      [{ op: "write", path: "wiki/a/index.md", content: "A" }],
      base,
      "y",
    );
    expect(state.changes).toEqual({});
    expect(state.log).toEqual([]);
  });

  it("une page créée puis supprimée ne laisse aucune trace", async () => {
    let state = await stageChanges(
      emptyPending(),
      [{ op: "write", path: "wiki/c/index.md", content: "C" }],
      base,
      "Créer C",
    );
    state = await stageChanges(
      state,
      [{ op: "delete", path: "wiki/c/index.md" }],
      base,
      "Supprimer C",
    );
    expect(state.changes).toEqual({});
  });

  it("calcule la vue de travail (déplacement d'un fichier joint)", async () => {
    const state = await stageChanges(
      emptyPending(),
      [
        {
          op: "copy",
          path: "wiki/b/photo.png",
          from: "wiki/a/photo.png",
          sha: base.get("wiki/a/photo.png")!.sha,
        },
        { op: "delete", path: "wiki/a/photo.png" },
      ],
      base,
      "Déplacer la photo",
    );
    const files = workingFiles(base.values(), state);
    expect(files.has("wiki/a/photo.png")).toBe(false);
    expect(files.get("wiki/b/photo.png")!.sha).toBe(base.get("wiki/a/photo.png")!.sha);
    expect(state.changes["wiki/b/photo.png"]!.kind).toBe("copy");
  });

  it("recopie le contenu quand la source d'une copie n'existe pas encore à distance", async () => {
    let state = await stageChanges(
      emptyPending(),
      [{ op: "write", path: "wiki/c/index.md", content: "C" }],
      base,
      "Créer",
    );
    state = await stageChanges(
      state,
      [
        {
          op: "copy",
          path: "wiki/d/index.md",
          from: "wiki/c/index.md",
          sha: await gitBlobSha("C"),
        },
        { op: "delete", path: "wiki/c/index.md" },
      ],
      base,
      "Renommer",
    );
    expect(state.changes["wiki/d/index.md"]).toMatchObject({
      kind: "write",
      content: "C",
      baseSha: null,
    });
    expect(state.changes["wiki/c/index.md"]).toBeUndefined();
  });

  it("met en file des commits et génère leur message", async () => {
    let state = await stageChanges(
      emptyPending(),
      [{ op: "write", path: "wiki/a/index.md", content: "A1" }],
      base,
      "Modifier « A »",
    );
    state = await stageChanges(
      state,
      [{ op: "write", path: "wiki/b/index.md", content: "B1" }],
      base,
      "Modifier « B »",
    );
    expect(generatedMessage(state)).toBe(
      "Modifier « A » (+1)\n\n- Modifier « A »\n- Modifier « B »",
    );
    state = queueCommit(state, "Premier", ["wiki/a/index.md"]);
    expect(uncommittedPaths(state)).toEqual(["wiki/b/index.md"]);
    state = queueCommit(state, "Second");
    expect(state.queue.map((c) => [c.message, c.paths])).toEqual([
      ["Premier", ["wiki/a/index.md"]],
      ["Second", ["wiki/b/index.md"]],
    ]);
    state = discardChanges(state, ["wiki/b/index.md"]);
    expect(state.queue.map((c) => c.message)).toEqual(["Premier"]);
  });
});
