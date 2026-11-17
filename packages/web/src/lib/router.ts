/**
 * Routage par ancre (`#/…`), compatible avec GitHub Pages ; le dépôt ouvert est porté
 * par le paramètre `?repo=owner/name` (§9.1).
 */
import { useSyncExternalStore } from "react";
import { parseRepo, repoLabel, type RepoRef } from "./repo.ts";

export type Route =
  | { name: "root" }
  | { name: "node"; id: string }
  | { name: "edit"; id: string }
  | { name: "new"; parentId: string; type: "note" | "flashcard" }
  | { name: "extract"; id: string; discussion?: string }
  | { name: "quiz"; id: string }
  | { name: "discussion"; id: string; path?: string }
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
          return { name: "node", id: second };
        case "edit":
          return { name: "edit", id: second };
        case "new":
          return {
            name: "new",
            parentId: second,
            type: query.get("type") === "flashcard" ? "flashcard" : "note",
          };
        case "extract":
          return {
            name: "extract",
            id: second,
            ...optional("discussion", query.get("discussion")),
          };
        case "quiz":
          return { name: "quiz", id: second };
        case "discuss":
          return { name: "discussion", id: second, ...optional("path", query.get("f")) };
        case "ask":
          return { name: "ask", id: second };
        default:
          return { name: "not-found" };
      }
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

export function href(route: Route): string {
  switch (route.name) {
    case "root":
    case "not-found":
      return "#/";
    case "node":
      return `#/n/${enc(route.id)}`;
    case "edit":
      return `#/n/${enc(route.id)}/edit`;
    case "new":
      return `#/n/${enc(route.parentId)}/new?type=${route.type}`;
    case "extract":
      return `#/n/${enc(route.id)}/extract${route.discussion ? `?discussion=${enc(route.discussion)}` : ""}`;
    case "quiz":
      return `#/n/${enc(route.id)}/quiz`;
    case "discussion":
      return `#/n/${enc(route.id)}/discuss${route.path ? `?f=${enc(route.path)}` : ""}`;
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

/** Adresse de l'application pour un dépôt. */
export function repoUrl(ref: RepoRef | null, hash = "#/"): string {
  const base = `${location.pathname}`;
  return ref ? `${base}?repo=${repoLabel(ref)}${hash}` : `${base}${hash}`;
}

export function openRepo(ref: RepoRef | null, hash = "#/"): void {
  history.pushState(null, "", repoUrl(ref, hash));
  window.dispatchEvent(new PopStateEvent("popstate"));
}
