import { describe, expect, it } from "vitest";
import { gitBlobSha } from "@openeugenia/core";
import { OwnerBackend, pushCommit } from "../src/lib/backend.ts";
import type { Snapshot } from "../src/lib/db.ts";
import { emptyPending, queueCommit, stageChanges } from "../src/lib/pending.ts";

/** Simulated GitHub: a repository whose branch moved from C1 to C2 (file changed remotely). */
async function fakeGitHub(files: Record<string, string>) {
  const blobs = new Map<string, string>();
  const tree: { path: string; type: string; sha: string }[] = [];
  for (const [path, content] of Object.entries(files)) {
    const sha = await gitBlobSha(content);
    blobs.set(sha, content);
    tree.push({ path, type: "blob", sha });
  }
  const writes: string[] = [];
  let head = "c2";
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    if (method !== "GET") {
      writes.push(`${method} ${url.pathname}`);
      if (url.pathname.endsWith("/git/trees")) return json({ sha: "t3" }, 201);
      if (url.pathname.endsWith("/git/commits")) return json({ sha: "c3" }, 201);
      if (url.pathname.includes("/git/refs/heads/")) {
        head = "c3";
        return json({ object: { sha: "c3" } });
      }
      return json({ message: "inattendu" }, 500);
    }
    if (url.pathname.endsWith("/git/ref/heads/main")) return json({ object: { sha: head } });
    if (url.pathname.includes("/git/commits/")) return json({ tree: { sha: "t2" } });
    if (url.pathname.includes("/git/trees/")) return json({ truncated: false, tree });
    const blob = /\/git\/blobs\/([0-9a-f]+)$/.exec(url.pathname);
    if (blob)
      return json({
        content: btoa(unescape(encodeURIComponent(blobs.get(blob[1]!) ?? ""))),
        encoding: "base64",
      });
    return json({ message: "Not Found" }, 404);
  }) as typeof fetch;
  return { fetchImpl, writes };
}

describe("saving to the repository", () => {
  const resolved = {
    mode: "owner" as const,
    source: { owner: "alice", name: "wiki" },
    branch: "main",
    isPrivate: true,
    canWrite: true,
  };

  it("detects a conflict and writes nothing when the file changed remotely", async () => {
    const { fetchImpl, writes } = await fakeGitHub({
      "wiki/a/index.md": "Version distante",
      "wiki/b/index.md": "B",
    });
    const backend = new OwnerBackend(resolved, "jeton", fetchImpl);
    const snapshot: Snapshot = {
      repo: "alice/wiki",
      mode: "owner",
      branch: "main",
      headSha: "c1",
      treeSha: "t1",
      isPrivate: true,
      fetchedAt: "",
      files: [
        { path: "wiki/a/index.md", sha: await gitBlobSha("Version d'origine") },
        { path: "wiki/b/index.md", sha: await gitBlobSha("B") },
      ],
    };
    const remote = new Map(snapshot.files.map((f) => [f.path, f]));
    let state = await stageChanges(
      emptyPending(),
      [{ op: "write", path: "wiki/a/index.md", content: "Version locale" }],
      remote,
      "Edit A",
    );
    state = queueCommit(state, "Edit A");
    const outcome = await pushCommit(backend, snapshot, state, state.queue[0]!);
    expect(outcome.status).toBe("conflicts");
    if (outcome.status === "conflicts") {
      expect(outcome.conflicts).toEqual([
        {
          path: "wiki/a/index.md",
          local: "Version locale",
          remoteSha: await gitBlobSha("Version distante"),
          remote: "Version distante",
        },
      ]);
    }
    expect(writes).toEqual([]);
  });

  it("commits when the locally changed files did not change remotely", async () => {
    const { fetchImpl, writes } = await fakeGitHub({
      "wiki/a/index.md": "A",
      "wiki/b/index.md": "B changed elsewhere",
    });
    const backend = new OwnerBackend(resolved, "jeton", fetchImpl);
    const snapshot: Snapshot = {
      repo: "alice/wiki",
      mode: "owner",
      branch: "main",
      headSha: "c1",
      treeSha: "t1",
      fetchedAt: "",
      files: [
        { path: "wiki/a/index.md", sha: await gitBlobSha("A") },
        { path: "wiki/b/index.md", sha: await gitBlobSha("B") },
      ],
    };
    const remote = new Map(snapshot.files.map((f) => [f.path, f]));
    let state = await stageChanges(
      emptyPending(),
      [{ op: "write", path: "wiki/a/index.md", content: "A local" }],
      remote,
      "Edit A",
    );
    state = queueCommit(state, "Edit A");
    const outcome = await pushCommit(backend, snapshot, state, state.queue[0]!);
    expect(outcome.status).toBe("committed");
    expect(writes).toEqual([
      "POST /repos/alice/wiki/git/trees",
      "POST /repos/alice/wiki/git/commits",
      "PATCH /repos/alice/wiki/git/refs/heads/main",
    ]);
    if (outcome.status === "committed") {
      expect(outcome.snapshot.headSha).toBe("c3");
      expect(outcome.snapshot.files.find((f) => f.path === "wiki/a/index.md")!.sha).toBe(
        await gitBlobSha("A local"),
      );
      expect(outcome.snapshot.files.find((f) => f.path === "wiki/b/index.md")!.sha).toBe(
        await gitBlobSha("B changed elsewhere"),
      );
    }
  });
});
