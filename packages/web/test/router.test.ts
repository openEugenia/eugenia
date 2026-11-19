import { describe, expect, it } from "vitest";
import { href, parseHash, type Route } from "../src/lib/router.ts";
import { parseRepo } from "../src/lib/repo.ts";

describe("routes", () => {
  const routes: Route[] = [
    { name: "root" },
    { name: "node", id: "01ABC" },
    { name: "edit", id: "01ABC" },
    { name: "new", parentId: "01ABC", type: "flashcard" },
    { name: "new", parentId: "01ABC", type: "knowledge" },
    { name: "new", parentId: "virtual:library", type: "source" },
    { name: "extract", id: "01ABC", discussion: "discussions/2026-01-01-1000-x.md" },
    { name: "extract", discussion: "discussions/2026-01-01-1000-x.md" },
    { name: "extract" },
    { name: "quiz", id: "01ABC" },
    { name: "discussion", path: "discussions/2026-01-01-1000-x.md" },
    { name: "discussion", about: "01ABC" },
    { name: "discussion", about: "01ABC", kind: "note" },
    { name: "discussion", kind: "note" },
    { name: "discussion" },
    { name: "discussions" },
    { name: "discussions", kind: "quiz", q: "lune" },
    { name: "library", kind: "book", q: "Descartes" },
    { name: "ask", id: "01ABC" },
    { name: "graph", id: "01ABC" },
    { name: "dashboard" },
    { name: "search", q: "lune noire" },
    { name: "settings" },
    { name: "changes" },
    { name: "summaries", id: "01ABC" },
    { name: "new-wiki" },
  ];
  it.each(routes)("aller-retour %o", (route) => {
    expect(parseHash(href(route))).toEqual(route);
  });

  it("route inconnue", () => {
    expect(parseHash("#/inconnu")).toEqual({ name: "not-found" });
  });
});

describe("dépôts", () => {
  it("accepte owner/name, une URL GitHub ou une URL de l'application", () => {
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
