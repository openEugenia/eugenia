/**
 * Hash routing (`#/…`), compatible with GitHub Pages; the open repository is carried by the
 * `?repo=owner/name` parameter (§9.1).
 */
import { useSyncExternalStore } from "react";
import {
  DISCUSSION_KINDS,
  PAGE_TYPES,
  SOURCE_KINDS,
  type DiscussionKind,
  type PageType,
  type SourceKind,
} from "@openeugenia/core";
import { parseRepo, repoLabel, type RepoRef } from "./repo.ts";

export type Route =
  | { name: "root" }
  /** Page; for a source, `section` points to a section of its index (`2.1`). */
  | { name: "node"; id: string; section?: string }
  | { name: "edit"; id: string }
  /** New page; a new source is filed in `category`. */
  | { name: "new"; parentId: string; type: PageType; category?: string }
  /** Extraction from a page (source, category…), a discussion, or a new text. */
  | { name: "extract"; id?: string; discussion?: string }
  | { name: "quiz"; id: string }
  /**
   * Discussion: existing (`path`), or new, from a page (`about`) or not; `kind: "note"` for a
   * quick note.
   */
  | { name: "discussion"; path?: string; about?: string; kind?: "note" }
  | { name: "discussions"; kind?: DiscussionKind; q?: string }
  /** Library; `category`: the sources filed in a category (`unfiled`: at the root). */
  | { name: "library"; kind?: SourceKind; q?: string; category?: string }
  | { name: "ask"; id?: string }
  | { name: "graph"; id?: string }
  | { name: "dashboard" }
  | { name: "search"; q?: string }
  | { name: "settings" }
  | { name: "changes" }
  | { name: "summaries"; id?: string }
  | { name: "new-wiki" }
  | { name: "not-found" };

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, "") || "/";
  const [pathPart, queryPart = ""] = raw.split("?");
  const query = new URLSearchParams(queryPart);
  const segments = (pathPart ?? "/").split("/").filter(Boolean).map(decodeURIComponent);
  const [first, second, third] = segments;
  const optional = <K extends string>(key: K, value: string | null): Partial<Record<K, string>> =>
    value ? ({ [key]: value } as Record<K, string>) : {};
  switch (first) {
    case undefined:
      return { name: "root" };
    case "n":
      if (!second) return { name: "root" };
      switch (third) {
        case undefined:
          return { name: "node", id: second, ...optional("section", query.get("s")) };
        case "edit":
          return { name: "edit", id: second };
        case "new": {
          const type = query.get("type") as PageType | null;
          return {
            name: "new",
            parentId: second,
            type: type && PAGE_TYPES.includes(type) ? type : "category",
            ...optional("category", query.get("category")),
          };
        }
        case "extract":
          return {
            name: "extract",
            id: second,
            ...optional("discussion", query.get("discussion")),
          };
        case "quiz":
          return { name: "quiz", id: second };
        case "discuss":
          return { name: "discussion", about: second };
        case "note":
          return { name: "discussion", about: second, kind: "note" };
        case "ask":
          return { name: "ask", id: second };
        default:
          return { name: "not-found" };
      }
    case "d":
      if (second === "note") return { name: "discussion", kind: "note" };
      if (second === "new") return { name: "discussion" };
      return query.get("f") ? { name: "discussion", path: query.get("f")! } : { name: "not-found" };
    case "discussions": {
      const kind = query.get("kind") as DiscussionKind | null;
      return {
        name: "discussions",
        ...(kind && DISCUSSION_KINDS.includes(kind) ? { kind } : {}),
        ...optional("q", query.get("q")),
      };
    }
    case "library": {
      const kind = query.get("kind") as SourceKind | null;
      return {
        name: "library",
        ...(kind && SOURCE_KINDS.includes(kind) ? { kind } : {}),
        ...optional("q", query.get("q")),
        ...optional("category", query.get("category")),
      };
    }
    case "extract":
      return { name: "extract", ...optional("discussion", query.get("discussion")) };
    case "graph":
      return { name: "graph", ...optional("id", query.get("root")) };
    case "dashboard":
      return { name: "dashboard" };
    case "search":
      return { name: "search", ...optional("q", query.get("q")) };
    case "settings":
      return { name: "settings" };
    case "changes":
      return { name: "changes" };
    case "summaries":
      return { name: "summaries", ...optional("id", query.get("root")) };
    case "ask":
      return { name: "ask" };
    case "new-wiki":
      return { name: "new-wiki" };
    default:
      return { name: "not-found" };
  }
}

const enc = encodeURIComponent;

function queryString(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v);
  return entries.length > 0 ? `?${entries.map(([k, v]) => `${k}=${enc(v!)}`).join("&")}` : "";
}

export function href(route: Route): string {
  switch (route.name) {
    case "root":
    case "not-found":
      return "#/";
    case "node":
      return `#/n/${enc(route.id)}${queryString({ s: route.section })}`;
    case "edit":
      return `#/n/${enc(route.id)}/edit`;
    case "new":
      return `#/n/${enc(route.parentId)}/new?type=${route.type}${route.category ? `&category=${enc(route.category)}` : ""}`;
    case "extract": {
      const query = queryString({ discussion: route.discussion });
      return route.id ? `#/n/${enc(route.id)}/extract${query}` : `#/extract${query}`;
    }
    case "quiz":
      return `#/n/${enc(route.id)}/quiz`;
    case "discussion":
      if (route.path) return `#/d?f=${enc(route.path)}`;
      if (route.about)
        return `#/n/${enc(route.about)}/${route.kind === "note" ? "note" : "discuss"}`;
      return route.kind === "note" ? "#/d/note" : "#/d/new";
    case "discussions":
      return `#/discussions${queryString({ kind: route.kind, q: route.q })}`;
    case "library":
      return `#/library${queryString({ kind: route.kind, q: route.q, category: route.category })}`;
    case "ask":
      return route.id ? `#/n/${enc(route.id)}/ask` : "#/ask";
    case "graph":
      return route.id ? `#/graph?root=${enc(route.id)}` : "#/graph";
    case "dashboard":
      return "#/dashboard";
    case "search":
      return route.q ? `#/search?q=${enc(route.q)}` : "#/search";
    case "settings":
      return "#/settings";
    case "changes":
      return "#/changes";
    case "summaries":
      return route.id ? `#/summaries?root=${enc(route.id)}` : "#/summaries";
    case "new-wiki":
      return "#/new-wiki";
  }
}

export function navigate(route: Route | string, options: { replace?: boolean } = {}): void {
  const target = typeof route === "string" ? route : href(route);
  if (options.replace) {
    history.replaceState(history.state, "", `${location.pathname}${location.search}${target}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } else {
    location.hash = target;
  }
}

function subscribe(callback: () => void): () => void {
  window.addEventListener("hashchange", callback);
  window.addEventListener("popstate", callback);
  return () => {
    window.removeEventListener("hashchange", callback);
    window.removeEventListener("popstate", callback);
  };
}

export function useHash(): string {
  return useSyncExternalStore(subscribe, () => location.hash);
}

export function useRoute(): Route {
  return parseHash(useHash());
}

export function useSearch(): string {
  return useSyncExternalStore(subscribe, () => location.search);
}

export function currentRepo(): RepoRef | null {
  return parseRepo(new URLSearchParams(location.search).get("repo"));
}

export function useRepoParam(): RepoRef | null {
  const search = useSearch();
  return parseRepo(new URLSearchParams(search).get("repo"));
}

/** App URL for a repository. */
export function repoUrl(ref: RepoRef | null, hash = "#/"): string {
  const base = `${location.pathname}`;
  return ref ? `${base}?repo=${repoLabel(ref)}${hash}` : `${base}${hash}`;
}

export function openRepo(ref: RepoRef | null, hash = "#/"): void {
  history.pushState(null, "", repoUrl(ref, hash));
  window.dispatchEvent(new PopStateEvent("popstate"));
}
