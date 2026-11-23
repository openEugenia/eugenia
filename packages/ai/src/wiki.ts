/**
 * Bridge between the wiki model (@openeugenia/core) and Eugenia's tasks: data sent for
 * descriptions, categories offered during extraction, tree navigation and prompts overridden
 * by the wiki.
 */
import {
  ancestors,
  basename,
  buildHierarchy,
  dirname,
  discussionAncestors,
  discussionText,
  findIndexNode,
  indexAncestry,
  hierarchyAncestors,
  isCategory,
  isSearchableDiscussion,
  markdownToText,
  needsSummary,
  parseDiscussion,
  parseFlashcardBody,
  parseKnowledgeBody,
  parsePage,
  parseSectionId,
  readSourceIndex,
  parseSummary,
  PROMPTS_DIR,
  scopedChildren,
  sectionId,
  type ExtractionPlan,
  type Hierarchy,
  type KnowledgeCandidate,
  type SourceIndexNode,
  type PageType,
  type PlacedDiscussion,
  type SummaryDocument,
  type SummaryScope,
  type WikiNode,
  type WikiView,
} from "@openeugenia/core";
import { isPromptName, type PromptOverrides } from "./prompts/index.ts";
import { isAbortError } from "./errors.ts";
import type { TreeEntry, TreeNavigator } from "./tasks/ask.ts";
import { categorizeKnowledge } from "./tasks/categorize.ts";
import type { TaskContext } from "./tasks/context.ts";
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

export interface NavigatorOptions {
  /** Descriptions already read, by path. */
  summaries?: ReadonlyMap<string, SummaryDocument>;
  /** Common hierarchy (discussions placed in the tree); without it, no discussion. */
  hierarchy?: Hierarchy;
}

/**
 * Navigation in the common hierarchy for questions (§8.5), limited to a scope: categories, then
 * their knowledge items, the sources filed in them and the discussions placed in them; a source
 * goes down into the sections of its index. The content of a knowledge item includes its
 * flashcards; the content of an indexed source is its index summary, not its full text.
 * In the public scope, only public elements are shown.
 */
export function treeNavigator(
  view: WikiView,
  scope: SummaryScope,
  options: NavigatorOptions = {},
): TreeNavigator {
  const { summaries } = options;
  const tree = view.tree;
  const hierarchy = options.hierarchy ?? buildHierarchy(tree, []);
  const visible = (node: WikiNode): boolean => scope === "private" || node.isPublic;
  const visibleDiscussion = (d: PlacedDiscussion): boolean =>
    isSearchableDiscussion(d.meta) && (scope === "private" || d.meta.visibility === "public");
  const indexes = new Map<string, Promise<SourceIndexNode | null>>();
  const indexOf = (source: WikiNode): Promise<SourceIndexNode | null> => {
    if (!source.sourceIndex?.root) return Promise.resolve(null);
    let loaded = indexes.get(source.id);
    if (!loaded) {
      loaded = readSourceIndex(view, source).then(
        (doc) => doc?.root ?? null,
        () => null,
      );
      indexes.set(source.id, loaded);
    }
    return loaded;
  };
  const discussionsAt = (id: string): PlacedDiscussion[] =>
    (hierarchy.discussionsAt.get(id) ?? []).filter(visibleDiscussion);
  const navigable = (node: WikiNode): WikiNode[] => {
    if (node.type !== "category") return [];
    return [
      ...scopedChildren(tree, node, scope),
      ...(hierarchy.sourcesAt.get(node.id) ?? []).filter(visible),
    ];
  };
  const pagePath = (node: WikiNode): string[] => hierarchyAncestors(tree, node).map((a) => a.title);

  const pageEntry = async (node: WikiNode, withPath: boolean): Promise<TreeEntry> => {
    const kids = navigable(node);
    let description = node.description;
    let hasChildren = kids.length > 0 || discussionsAt(node.id).length > 0;
    if (node.type === "source") {
      const index = await indexOf(node);
      if (index?.description) description = index.description;
      hasChildren ||= (index?.children.length ?? 0) > 0;
    }
    const file = scope === "public" ? node.summaries.public : node.summaries.private;
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
      hasChildren,
    };
    if (description) entry.description = description;
    if (withPath) entry.path = pagePath(node);
    return entry;
  };
  const sectionEntry = (source: WikiNode, node: SourceIndexNode, path?: string[]): TreeEntry => {
    const entry: TreeEntry = {
      id: sectionId(source.id, node.key),
      title: node.name,
      type: "section",
      hasChildren: node.children.length > 0,
    };
    if (node.description) entry.description = node.description;
    if (path) entry.path = path;
    return entry;
  };
  const discussionEntry = (d: PlacedDiscussion, withPath: boolean): TreeEntry => {
    const entry: TreeEntry = {
      id: d.meta.id,
      title: d.meta.title || "Discussion",
      type: d.meta.kind === "discussion" ? "discussion" : `discussion (${d.meta.kind})`,
      hasChildren: false,
    };
    if (d.meta.preview) entry.description = d.meta.preview;
    if (withPath) entry.path = discussionAncestors(tree, hierarchy, d.path).map((a) => a.title);
    return entry;
  };
  /** Source and node of a section, if visible. */
  const section = async (
    id: string,
  ): Promise<{ source: WikiNode; index: SourceIndexNode; node: SourceIndexNode } | undefined> => {
    const ref = parseSectionId(id);
    const source = ref ? tree.nodes.get(ref.sourceId) : undefined;
    if (!ref || !source || source.type !== "source" || !visible(source)) return undefined;
    const index = await indexOf(source);
    const node = index ? findIndexNode(index, ref.key) : undefined;
    return index && node ? { source, index, node } : undefined;
  };
  const discussion = (id: string): PlacedDiscussion | undefined => {
    const d = hierarchy.discussionById.get(id);
    return d && visibleDiscussion(d) ? d : undefined;
  };

  return {
    entry(id) {
      const node = tree.nodes.get(id);
      if (!node || !visible(node)) return undefined;
      const entry: TreeEntry = {
        id: node.id,
        title: node.title,
        type: PAGE_TYPE_LABELS[node.type],
        hasChildren: navigable(node).length > 0,
      };
      if (node.description) entry.description = node.description;
      return entry;
    },
    async resolve(id) {
      const node = tree.nodes.get(id);
      if (node) return visible(node) && !node.virtual ? pageEntry(node, true) : undefined;
      const found = await section(id);
      if (found) {
        // Enclosing sections, between the source and the section.
        const between = indexAncestry(found.index, found.node.key).slice(1, -1);
        const path = [...pagePath(found.source), found.source.title, ...between.map((n) => n.name)];
        return sectionEntry(found.source, found.node, path);
      }
      const d = discussion(id);
      return d ? discussionEntry(d, true) : undefined;
    },
    async children(id) {
      const found = await section(id);
      if (found) return found.node.children.map((child) => sectionEntry(found.source, child));
      const node = tree.nodes.get(id);
      if (!node || !visible(node)) return [];
      const out: TreeEntry[] = await Promise.all(navigable(node).map((n) => pageEntry(n, false)));
      if (node.type === "source") {
        const index = await indexOf(node);
        for (const child of index?.children ?? []) out.push(sectionEntry(node, child));
      }
      for (const d of discussionsAt(node.id)) out.push(discussionEntry(d, false));
      return out;
    },
    async content(id) {
      const found = await section(id);
      if (found) {
        const { node } = found;
        const subsections = node.children.map((c) => c.name);
        return [
          node.description,
          node.knowledge.length > 0
            ? `Key facts:\n${node.knowledge.map((k) => `- ${markdownToText(k.statement)}`).join("\n")}`
            : "",
          subsections.length > 0 ? `Subsections: ${subsections.join("; ")}.` : "",
        ]
          .filter(Boolean)
          .join("\n\n");
      }
      const d = discussion(id);
      if (d) return discussionText(parseDiscussion(await view.readText(d.path)));
      const node = tree.nodes.get(id);
      if (!node || !visible(node)) return "";
      if (node.type === "source") {
        const index = await indexOf(node);
        if (index) {
          const doc = parsePage(await view.readText(node.indexPath));
          const f = doc.fields;
          return [
            f.authors?.length ? `Authors: ${f.authors.join(", ")}` : "",
            f.published ? `Published: ${f.published}` : "",
            f.url ? `URL: ${f.url}` : "",
            `Summary of the source (from its index): ${index.description}`,
            index.children.length > 0
              ? `Sections: ${index.children.map((c) => c.name).join("; ")}.`
              : "",
          ]
            .filter(Boolean)
            .join("\n");
        }
      }
      const text = await pageText(view, node);
      if (node.type !== "knowledge") return text;
      const cards = await Promise.all(
        scopedChildren(tree, node, scope)
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

/**
 * Plan to add the knowledge proposed by the index of a source to the wiki, without review:
 * Eugenia files it in the categories of the wiki, as for an extraction (§8.1), creating the
 * categories that group it best. If she cannot, everything goes to the category of the source.
 */
export async function indexExtractionPlan(
  context: TaskContext,
  view: WikiView,
  source: WikiNode,
  candidates: readonly KnowledgeCandidate[],
  summary?: string,
): Promise<ExtractionPlan & { categorized: boolean }> {
  const fallback = source.filedIn ?? view.tree.rootId;
  const all = (): ExtractionPlan & { categorized: boolean } => ({
    sourceId: source.id,
    knowledge: candidates.map((c) => ({ ...c, category: fallback })),
    categorized: false,
  });
  if (candidates.length === 0) return all();
  try {
    const plan = await categorizeKnowledge(context, {
      document: source.title,
      ...(summary ? { excerpt: summary } : {}),
      categories: categoryOptions(view),
      knowledge: candidates.map((c) => ({ title: c.title, knowledge: c.statement })),
      fallbackId: fallback,
    });
    return {
      sourceId: source.id,
      categories: plan.newCategories.map((c) => ({ key: c.key, title: c.title, parent: c.parent })),
      knowledge: candidates.map((c, i) => ({ ...c, category: plan.assignments[i] ?? fallback })),
      categorized: true,
    };
  } catch (error) {
    if (isAbortError(error)) throw error;
    return all();
  }
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
