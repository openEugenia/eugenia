/**
 * Passerelle entre le modèle du wiki (@openeugenia/core) et les tâches d'Eugenia :
 * données envoyées pour les descriptions, catégories proposées à l'extraction,
 * navigation dans l'arbre et prompts surchargés par le wiki.
 */
import {
  ancestors,
  basename,
  dirname,
  markdownToText,
  needsSummary,
  parseFlashcardBody,
  parsePage,
  parseSummary,
  PROMPTS_DIR,
  scopedChildren,
  type SummaryDocument,
  type SummaryScope,
  type WikiNode,
  type WikiView,
} from "@openeugenia/core";
import { isPromptName, type PromptOverrides } from "./prompts/index.ts";
import type { TreeEntry, TreeNavigator } from "./tasks/ask.ts";
import type { CategoryOption } from "./tasks/extract.ts";
import type { SummaryInput } from "./tasks/summarize.ts";

/** Texte d'une page pour Eugenia : énoncé, question et réponse pour une flashcard. */
export async function pageText(
  view: Pick<WikiView, "readText" | "files">,
  node: WikiNode,
): Promise<string> {
  if (node.virtual || !view.files.has(node.indexPath)) return "";
  const doc = parsePage(await view.readText(node.indexPath));
  if (node.type === "flashcard") {
    const card = parseFlashcardBody(doc.body);
    return [
      `Connaissance : ${card.knowledge}`,
      card.question ? `Question : ${card.question}` : "",
      card.answer ? `Réponse attendue : ${card.answer}` : "",
    ]
      .filter(Boolean)
      .join("\n");
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
        type: child.type,
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

/** Catégories proposées à l'extraction : toutes les notes, avec leur chemin lisible. */
export function categoryOptions(view: Pick<WikiView, "tree">, limit = 400): CategoryOption[] {
  const out: CategoryOption[] = [];
  const visit = (node: WikiNode, path: string[]): void => {
    if (out.length >= limit) return;
    if (node.type !== "flashcard") {
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

/** Navigation dans l'arbre pour les questions (§8.5), limitée à une portée. */
export function treeNavigator(
  view: WikiView,
  scope: SummaryScope,
  summaries?: ReadonlyMap<string, SummaryDocument>,
): TreeNavigator {
  const toEntry = async (node: WikiNode): Promise<TreeEntry> => {
    const kids = scopedChildren(view.tree, node, scope);
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
      type: node.type,
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
        type: node.type,
        hasChildren: scopedChildren(view.tree, node, scope).length > 0,
      };
      if (node.description) entry.description = node.description;
      return entry;
    },
    async children(id) {
      const node = view.tree.nodes.get(id);
      return node ? Promise.all(scopedChildren(view.tree, node, scope).map(toEntry)) : [];
    },
    async content(id) {
      const node = view.tree.nodes.get(id);
      return node ? pageText(view, node) : "";
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
