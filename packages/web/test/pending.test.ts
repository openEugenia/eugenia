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

describe("pending changes", async () => {
  const base = await remote({
    "wiki/a/index.md": "A",
    "wiki/b/index.md": "B",
    "wiki/a/photo.png": "PNG",
  });

  it("keeps the remote SHA of the first change", async () => {
    let state = await stageChanges(
      emptyPending(),
      [{ op: "write", path: "wiki/a/index.md", content: "A1" }],
      base,
      "Edit A",
    );
    state = await stageChanges(
      state,
      [{ op: "write", path: "wiki/a/index.md", content: "A2" }],
      base,
      "Edit A again",
    );
    const change = state.changes["wiki/a/index.md"]!;
    expect(change.baseSha).toBe(base.get("wiki/a/index.md")!.sha);
    expect(change.content).toBe("A2");
    expect(change.sha).toBe(await gitBlobSha("A2"));
    expect(state.log.map((e) => e.description)).toEqual(["Edit A", "Edit A again"]);
  });

  it("forgets a change that goes back to the original content", async () => {
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

  it("a page created then deleted leaves no trace", async () => {
    let state = await stageChanges(
      emptyPending(),
      [{ op: "write", path: "wiki/c/index.md", content: "C" }],
      base,
      "Create C",
    );
    state = await stageChanges(
      state,
      [{ op: "delete", path: "wiki/c/index.md" }],
      base,
      "Delete C",
    );
    expect(state.changes).toEqual({});
  });

  it("computes the working view (move of an attached file)", async () => {
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
      "Move the photo",
    );
    const files = workingFiles(base.values(), state);
    expect(files.has("wiki/a/photo.png")).toBe(false);
    expect(files.get("wiki/b/photo.png")!.sha).toBe(base.get("wiki/a/photo.png")!.sha);
    expect(state.changes["wiki/b/photo.png"]!.kind).toBe("copy");
  });

  it("copies the content when the source of a copy does not exist remotely yet", async () => {
    let state = await stageChanges(
      emptyPending(),
      [{ op: "write", path: "wiki/c/index.md", content: "C" }],
      base,
      "Create",
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
      "Rename",
    );
    expect(state.changes["wiki/d/index.md"]).toMatchObject({
      kind: "write",
      content: "C",
      baseSha: null,
    });
    expect(state.changes["wiki/c/index.md"]).toBeUndefined();
  });

  it("queues commits and generates their message", async () => {
    let state = await stageChanges(
      emptyPending(),
      [{ op: "write", path: "wiki/a/index.md", content: "A1" }],
      base,
      'Edit "A"',
    );
    state = await stageChanges(
      state,
      [{ op: "write", path: "wiki/b/index.md", content: "B1" }],
      base,
      'Edit "B"',
    );
    expect(generatedMessage(state)).toBe('Edit "A" (+1)\n\n- Edit "A"\n- Edit "B"');
    state = queueCommit(state, "First", ["wiki/a/index.md"]);
    expect(uncommittedPaths(state)).toEqual(["wiki/b/index.md"]);
    state = queueCommit(state, "Second");
    expect(state.queue.map((c) => [c.message, c.paths])).toEqual([
      ["First", ["wiki/a/index.md"]],
      ["Second", ["wiki/b/index.md"]],
    ]);
    state = discardChanges(state, ["wiki/b/index.md"]);
    expect(state.queue.map((c) => c.message)).toEqual(["First"]);
  });
});
