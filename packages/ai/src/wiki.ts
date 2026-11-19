/**
 * Passerelle entre le modèle du wiki (@openeugenia/core) et les tâches d'Eugenia :
 * données envoyées pour les descriptions, catégories proposées à l'extraction,
 * navigation dans l'arbre et prompts surchargés par le wiki.
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

/** Libellé d'un type de page dans les données envoyées à Eugenia. */
export const PAGE_TYPE_LABELS: Record<PageType, string> = {
  category: "catégorie",
  knowledge: "connaissance",
  flashcard: "flashcard",
  source: "source",
};

/**
 * Texte d'une page pour Eugenia : énoncé d'une connaissance, question et réponse d'une
 * flashcard (avec l'énoncé de sa connaissance), notice et contenu d'une source.
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
      knowledge ? `Connaissance : ${markdownToText(knowledge)}` : "",
      card.question ? `Question : ${markdownToText(card.question)}` : "",
      card.answer ? `Réponse attendue : ${markdownToText(card.answer)}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (node.type === "knowledge") {
    const content = parseKnowledgeBody(doc.body);
    return [
      `Connaissance : ${markdownToText(content.statement)}`,
      content.notes ? markdownToText(content.notes) : "",
    ]
      .filter(Boolean)
      .join("\n\n");
  }
  if (node.type === "source") {
    const f = doc.fields;
    const notice = [
      f.authors?.length ? `Auteurs : ${f.authors.join(", ")}` : "",
      f.published ? `Publication : ${f.published}` : "",
      f.url ? `Adresse : ${f.url}` : "",
    ].filter(Boolean);
    return [...notice, markdownToText(doc.body)].filter(Boolean).join("\n");
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

/** Données d'une description de sous-wiki : la page, puis ses enfants pour la portée. */
export async function summaryInputFor(
  view: WikiView,
  nodeId: string,
  scope: SummaryScope,
  summaries?: ReadonlyMap<string, SummaryDocument>,
): Promise<SummaryInput> {
  const node = view.tree.nodes.get(nodeId);
  if (!node) throw new Error(`Nœud introuvable : ${nodeId}`);
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

/** Le contenu d'une tâche implique-t-il un nœud privé ? */
export function involvesPrivate(nodes: Iterable<WikiNode>): boolean {
  for (const node of nodes) if (!node.isPublic) return true;
  return false;
}

/** Catégories proposées à l'extraction : toutes les catégories du wiki, avec leur chemin. */
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
 * Navigation dans l'arbre pour les questions (§8.5), limitée à une portée. Elle descend des
 * catégories jusqu'aux connaissances, dont le contenu inclut leurs flashcards.
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
        // description illisible : on garde la description courte
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
      return cards.length > 0 ? `${text}\n\nFlashcards :\n${cards.join("\n")}` : text;
    },
  };
}

/** Prompts surchargés par le wiki : `.notes/prompts/<nom>.md`. */
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
