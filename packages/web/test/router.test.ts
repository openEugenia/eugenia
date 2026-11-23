import { describe, expect, it } from "vitest";
import { href, parseHash, type Route } from "../src/lib/router.ts";
import { parseRepo } from "../src/lib/repo.ts";

describe("routes", () => {
  const routes: Route[] = [
    { name: "root" },
    { name: "node", id: "01ABC" },
    { name: "node", id: "01ABC", section: "origins/lilitu" },
    { name: "edit", id: "01ABC" },
    { name: "new", parentId: "01ABC", type: "flashcard" },
    { name: "new", parentId: "01ABC", type: "knowledge" },
    { name: "new", parentId: "virtual:library", type: "source" },
    { name: "new", parentId: "virtual:library", type: "source", category: "01CAT" },
    { name: "extract", id: "01ABC", discussion: "discussions/2026-01-01-1000-x.md" },
    { name: "extract", discussion: "discussions/2026-01-01-1000-x.md" },
    { name: "extract" },
    { name: "extract", id: "01ABC", index: "origins/lilitu" },
    { name: "extract", id: "01ABC", index: "." },
    { name: "quiz", id: "01ABC" },
    { name: "discussion", path: "discussions/2026-01-01-1000-x.md" },
    { name: "discussion", about: "01ABC" },
    { name: "discussion", about: "01ABC", kind: "note" },
    { name: "discussion", kind: "note" },
    { name: "discussion" },
    { name: "discussions" },
    { name: "discussions", kind: "quiz", q: "moon" },
    { name: "discussions", category: "01CAT" },
    { name: "library", kind: "book", q: "Descartes" },
    { name: "library", category: "unfiled" },
    { name: "ask", id: "01ABC" },
    { name: "graph", id: "01ABC" },
    { name: "dashboard" },
    { name: "search", q: "black moon" },
    { name: "settings" },
    { name: "changes" },
    { name: "summaries", id: "01ABC" },
    { name: "tasks" },
    { name: "new-wiki" },
  ];
  it.each(routes)("round trip %o", (route) => {
    expect(parseHash(href(route))).toEqual(route);
  });

  it("unknown route", () => {
    expect(parseHash("#/unknown")).toEqual({ name: "not-found" });
  });
});

describe("repositories", () => {
  it("accepts owner/name, a GitHub URL or an app URL", () => {
    expect(parseRepo("alice/wiki")).toEqual({ owner: "alice", name: "wiki" });
    expect(parseRepo("https://github.com/alice/wiki.git")).toEqual({
      owner: "alice",
      name: "wiki",
    });
    expect(parseRepo("https://openeugenia.github.io/eugenia/?repo=alice/wiki#/")).toEqual({
      owner: "alice",
      name: "wiki",
    });
    expect(parseRepo("alice")).toBeNull();
    expect(parseRepo("a/b/c")).toBeNull();
  });
});
