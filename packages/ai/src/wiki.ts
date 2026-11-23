/**
 * Bridge between the wiki model (@openeugenia/core) and Eugenia's tasks: data sent for
 * descriptions, categories offered during extraction, tree navigation and prompts overridden
 * by the wiki.
 */
import {
  ancestors,
  basename,
  dirname,
  isCategory,
  markdownToText,
  needsSummary,
  parseFlashcardBody,
  parseKnowledgeBody,
  parsePage,
  parseSummary,
  PROMPTS_DIR,
  scopedChildren,
  type PageType,
  type SummaryDocument,
  type SummaryScope,
  type WikiNode,
  type WikiView,
} from "@openeugenia/core";
import { isPromptName, type PromptOverrides } from "./prompts/index.ts";
import type { TreeEntry, TreeNavigator } from "./tasks/ask.ts";
import type { CategoryOption } from "./tasks/extract.ts";
import type { SummaryInput } from "./tasks/summarize.ts";

/** Label of a page type in the data sent to Eugenia. */
export const PAGE_TYPE_LABELS: Record<PageType, string> = {
  category: "category",
  knowledge: "knowledge",
  flashcard: "flashcard",
  source: "source",
};

/**
 * Text of a page for Eugenia: statement of a knowledge item, question and answer of a
 * flashcard (with the statement of its knowledge item), record and content of a source.
 */
export async function pageText(
  view: Pick<WikiView, "readText" | "files"> & { tree?: WikiView["tree"] },
  node: WikiNode,
): Promise<string> {
  if (node.virtual || !view.files.has(node.indexPath)) return "";
  const doc = parsePage(await view.readText(node.indexPath));
  if (node.type === "flashcard") {
    const card = parseFlashcardBody(doc.body);
    const parent = node.parentId ? view.tree?.nodes.get(node.parentId) : undefined;
    let knowledge = card.knowledge ?? "";
    if (!knowledge && parent?.type === "knowledge" && view.files.has(parent.indexPath)) {
      knowledge = parseKnowledgeBody(
        parsePage(await view.readText(parent.indexPath)).body,
      ).statement;
    }
    return [
      knowledge ? `Knowledge: ${markdownToText(knowledge)}` : "",
      card.question ? `Question: ${markdownToText(card.question)}` : "",
      card.answer ? `Expected answer: ${markdownToText(card.answer)}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (node.type === "knowledge") {
    const content = parseKnowledgeBody(doc.body);
    return [
      `Knowledge: ${markdownToText(content.statement)}`,
      content.notes ? markdownToText(content.notes) : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  if (node.type === "source") {
    const f = doc.fields;
    const record = [
      f.authors?.length ? `Authors: ${f.authors.join(", ")}` : "",
      f.published ? `Published: ${f.published}` : "",
      f.url ? `URL: ${f.url}` : "",
    ].filter(Boolean);
    return [...record, markdownToText(doc.body)].filter(Boolean).join("\n");
  }
  return markdownToText(doc.body);
}

async function summaryBody(
  view: Pick<WikiView, "readText">,
  path: string,
  summaries?: ReadonlyMap<string, SummaryDocument>,
): Promise<string> {
  const doc = summaries?.get(path) ?? parseSummary(await view.readText(path));
  return markdownToText(doc.body);
}

/** Data for a sub-wiki description: the page, then its children for the scope. */
export async function summaryInputFor(
  view: WikiView,
  nodeId: string,
  scope: SummaryScope,
  summaries?: ReadonlyMap<string, SummaryDocument>,
): Promise<SummaryInput> {
  const node = view.tree.nodes.get(nodeId);
  if (!node) throw new Error(`Node not found: ${nodeId}`);
  const children = await Promise.all(
    scopedChildren(view.tree, node, scope).map(async (child) => {
      const isSubwiki = needsSummary(view.tree, child, scope);
      const file = scope === "public" ? child.summaries.public : child.summaries.private;
      const description =
        isSubwiki && file
          ? await summaryBody(view, file.path, summaries)
          : await pageText(view, child);
      return {
        title: child.title,
        type: PAGE_TYPE_LABELS[child.type],
        description: description || child.description || "",
        isSubwiki,
      };
    }),
  );
  const input: SummaryInput = {
    title: node.title,
    path: ancestors(view.tree, nodeId).map((a) => a.title),
    children,
  };
  const content = await pageText(view, node);
  if (content) input.content = content;
  return input;
}

/** Does the content of a task involve a private node? */
export function involvesPrivate(nodes: Iterable<WikiNode>): boolean {
  for (const node of nodes) if (!node.isPublic) return true;
  return false;
}

/** Categories offered during extraction: all the categories of the wiki, with their path. */
export function categoryOptions(view: Pick<WikiView, "tree">, limit = 400): CategoryOption[] {
  const out: CategoryOption[] = [];
  const visit = (node: WikiNode, path: string[]): void => {
    if (out.length >= limit) return;
    if (isCategory(node)) {
      const option: CategoryOption = { id: node.id, path: [...path, node.title].join(" > ") };
      if (node.description) option.description = node.description;
      out.push(option);
      for (const id of node.childIds) visit(view.tree.nodes.get(id)!, [...path, node.title]);
    }
  };
  const root = view.tree.nodes.get(view.tree.rootId);
  if (root) visit(root, []);
  return out;
}

/**
 * Tree navigation for questions (§8.5), limited to a scope. It goes down from categories to
 * knowledge items, whose content includes their flashcards.
 */
export function treeNavigator(
  view: WikiView,
  scope: SummaryScope,
  summaries?: ReadonlyMap<string, SummaryDocument>,
): TreeNavigator {
  const navigable = (node: WikiNode): WikiNode[] =>
    node.type === "category" ? scopedChildren(view.tree, node, scope) : [];
  const toEntry = async (node: WikiNode): Promise<TreeEntry> => {
    const kids = navigable(node);
    const file = scope === "public" ? node.summaries.public : node.summaries.private;
    let description = node.description;
    if (kids.length > 0 && file) {
      try {
        description = await summaryBody(view, file.path, summaries);
      } catch {
        // unreadable description: keep the short description
      }
    }
    const entry: TreeEntry = {
      id: node.id,
      title: node.title,
      type: PAGE_TYPE_LABELS[node.type],
      hasChildren: kids.length > 0,
    };
    if (description) entry.description = description;
    return entry;
  };
  return {
    entry(id) {
      const node = view.tree.nodes.get(id);
      if (!node) return undefined;
      const entry: TreeEntry = {
        id: node.id,
        title: node.title,
        type: PAGE_TYPE_LABELS[node.type],
        hasChildren: navigable(node).length > 0,
      };
      if (node.description) entry.description = node.description;
      return entry;
    },
    async children(id) {
      const node = view.tree.nodes.get(id);
      return node ? Promise.all(navigable(node).map(toEntry)) : [];
    },
    async content(id) {
      const node = view.tree.nodes.get(id);
      if (!node) return "";
      const text = await pageText(view, node);
      if (node.type !== "knowledge") return text;
      const cards = await Promise.all(
        scopedChildren(view.tree, node, scope)
          .filter((c) => c.type === "flashcard")
          .map(async (c) => {
            const card = parseFlashcardBody(parsePage(await view.readText(c.indexPath)).body);
            return `- ${markdownToText(card.question)} → ${markdownToText(card.answer)}`;
          }),
      );
      return cards.length > 0 ? `${text}\n\nFlashcards:\n${cards.join("\n")}` : text;
    },
  };
}

/** Prompts overridden by the wiki: `.notes/prompts/<name>.md`. */
export async function loadPromptOverrides(
  paths: Iterable<string>,
  readText: (path: string) => Promise<string>,
): Promise<PromptOverrides> {
  const overrides: PromptOverrides = {};
  for (const path of paths) {
    if (dirname(path) !== PROMPTS_DIR || !path.endsWith(".md")) continue;
    const name = basename(path).slice(0, -3);
    if (isPromptName(name)) overrides[name] = await readText(path);
  }
  return overrides;
}
