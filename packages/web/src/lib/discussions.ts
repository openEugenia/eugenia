/** Tools shared by discussions and quizzes: context, related pages, `eugenia:` links. */
import {
  ancestors,
  children,
  dirname,
  encodeLinkPath,
  parseSectionId,
  relativePath,
  type WikiNode,
  type WikiTree,
} from "@openeugenia/core";
import type { RelatedPage } from "@openeugenia/ai";
import { EUGENIA_LINK_PREFIX } from "@openeugenia/ai/constants";
import { href } from "./router.ts";
import { normalizeTerm } from "./text.ts";

/** Pages offered to Eugenia for her link suggestions. */
export function relatedPages(
  tree: WikiTree,
  node: WikiNode | undefined,
  text: string,
  limit = 24,
): RelatedPage[] {
  const out = new Map<string, WikiNode>();
  // Flashcards are read from their knowledge item: offer the knowledge items.
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

/**
 * Replaces `eugenia:ID` links with relative links, readable outside the app: to the page, to
 * the source of a section of its index, or to the file of a discussion.
 */
export function portableLinks(
  text: string,
  fromFile: string,
  tree: WikiTree,
  discussionById?: ReadonlyMap<string, { path: string }>,
): string {
  return text.replace(/\]\(eugenia:([^)\s]+)\)/g, (match, id: string) => {
    const section = parseSectionId(id);
    const target = tree.nodes.get(section ? section.sourceId : id);
    const file = target?.indexPath ?? discussionById?.get(id)?.path;
    return file ? `](${encodeLinkPath(relativePath(dirname(fromFile), file))})` : match;
  });
}

/** Address and title of an element cited by Eugenia: page, section of a source index, discussion. */
export function elementLink(
  tree: WikiTree,
  discussionById: ReadonlyMap<string, { path: string; meta: { title: string } }>,
  id: string,
): { href: string; title: string } | undefined {
  const node = tree.nodes.get(id);
  if (node) return { href: href({ name: "node", id }), title: node.title };
  const section = parseSectionId(id);
  const source = section ? tree.nodes.get(section.sourceId) : undefined;
  if (section && source) {
    return {
      href: href({ name: "node", id: source.id, section: section.key }),
      title: source.title,
    };
  }
  const discussion = discussionById.get(id);
  return discussion
    ? { href: href({ name: "discussion", path: discussion.path }), title: discussion.meta.title }
    : undefined;
}

export function isEugeniaLink(url: string): boolean {
  return url.startsWith(EUGENIA_LINK_PREFIX);
}

/**
 * Key of a discussion view. A new discussion changes address on its first message (it gets
 * its file): it keeps its key so as not to be remounted, which would interrupt the answer in
 * progress.
 */
const adopted = new Map<string, string>();

export function discussionViewKey(route: { path?: string; about?: string; kind?: string }): string {
  if (route.path) return adopted.get(route.path) ?? `discussion-${route.path}`;
  return `discussion-new-${route.about ?? ""}-${route.kind ?? ""}`;
}

export function adoptDiscussionPath(path: string, from: { about?: string; kind?: string }): void {
  adopted.set(path, discussionViewKey(from));
}
