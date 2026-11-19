/** Outils communs aux discussions et quiz : contexte, pages liées, liens `eugenia:`. */
import {
  ancestors,
  children,
  dirname,
  encodeLinkPath,
  relativePath,
  type WikiNode,
  type WikiTree,
} from "@openeugenia/core";
import type { RelatedPage } from "@openeugenia/ai";
import { EUGENIA_LINK_PREFIX } from "@openeugenia/ai/constants";
import { normalizeTerm } from "./text.ts";

/** Pages proposées à Eugenia pour ses suggestions de liens. */
export function relatedPages(
  tree: WikiTree,
  node: WikiNode | undefined,
  text: string,
  limit = 24,
): RelatedPage[] {
  const out = new Map<string, WikiNode>();
  // Les flashcards se lisent depuis leur connaissance : on propose les connaissances.
  const add = (n: WikiNode | undefined): void => {
    if (n && !n.virtual && n.type !== "flashcard" && n.id !== node?.id && out.size < limit)
      out.set(n.id, n);
  };
  const parent = node?.parentId ? tree.nodes.get(node.parentId) : undefined;
  add(parent);
  if (node) for (const child of children(tree, node.id).slice(0, 10)) add(child);
  if (parent) for (const sibling of children(tree, parent.id).slice(0, 10)) add(sibling);
  const words = normalizeTerm(text)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4);
  if (words.length > 0) {
    for (const candidate of tree.nodes.values()) {
      const title = normalizeTerm(candidate.title);
      if (words.some((w) => title.includes(w))) add(candidate);
    }
  }
  return [...out.values()].map((n) =>
    n.description
      ? { id: n.id, title: n.title, description: n.description }
      : { id: n.id, title: n.title },
  );
}

export function pathTitles(tree: WikiTree, node: WikiNode): string[] {
  return ancestors(tree, node.id).map((a) => a.title);
}

/** Remplace les liens `eugenia:ID` par des liens relatifs, lisibles hors de l'application. */
export function portableLinks(text: string, fromFile: string, tree: WikiTree): string {
  return text.replace(/\]\(eugenia:([^)\s]+)\)/g, (match, id: string) => {
    const target = tree.nodes.get(id);
    return target
      ? `](${encodeLinkPath(relativePath(dirname(fromFile), target.indexPath))})`
      : match;
  });
}

export function isEugeniaLink(url: string): boolean {
  return url.startsWith(EUGENIA_LINK_PREFIX);
}

/**
 * Clé de la vue d'une discussion. Une nouvelle discussion change d'adresse à son premier
 * message (elle reçoit son fichier) : elle garde sa clé pour ne pas être remontée, ce qui
 * interromprait la réponse en cours.
 */
const adopted = new Map<string, string>();

export function discussionViewKey(route: { path?: string; about?: string; kind?: string }): string {
  if (route.path) return adopted.get(route.path) ?? `discussion-${route.path}`;
  return `discussion-new-${route.about ?? ""}-${route.kind ?? ""}`;
}

export function adoptDiscussionPath(path: string, from: { about?: string; kind?: string }): void {
  adopted.set(path, discussionViewKey(from));
}
