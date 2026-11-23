/**
 * Creation of extracted knowledge in one batch of changes (§8.1, §8.6): the categories planned
 * by Eugenia, then the knowledge items, each with its first flashcard, citing the source they
 * were extracted from. Used for the knowledge proposed by the index of a source, added to the
 * wiki without review.
 */
import { categoryForSource } from "./hierarchy.ts";
import { createFlashcard, createPage, updatePage, type WikiView } from "./operations.ts";
import { serializeKnowledgeBody } from "./pages.ts";
import type { KnowledgeCandidate } from "./source-index.ts";
import type { WikiTree } from "./tree.ts";
import type { FileChange, SourceRef } from "./types.ts";

/** A knowledge item to create, in an existing category or a planned one. */
export interface KnowledgeDraft extends KnowledgeCandidate {
  /** Identifier of an existing category, or key of a planned category. */
  category: string;
}

/** A category to create, under an existing category or another planned one. */
export interface CategoryDraft {
  key: string;
  title: string;
  /** Identifier of an existing category, or key of another planned category. */
  parent: string;
}

export interface ExtractionPlan {
  knowledge: readonly KnowledgeDraft[];
  categories?: readonly CategoryDraft[];
  /** Source the knowledge was extracted from: cited, and filed with it if it is not yet. */
  sourceId?: string;
  now?: Date;
}

export interface ExtractionResult {
  changes: FileChange[];
  knowledge: { id: string; title: string }[];
  categories: { id: string; title: string }[];
}

/** Title or statement reduced to its words, to recognize knowledge already extracted. */
export function knowledgeKey(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[*_`]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Knowledge proposed for a source that is not in the wiki yet: a knowledge item extracted from
 * the source, or citing it, with the same title, is already there.
 */
export function newCandidates<T extends { title: string }>(
  tree: WikiTree,
  sourceId: string,
  candidates: readonly T[],
): T[] {
  const known = new Set<string>();
  for (const node of tree.nodes.values()) {
    if (node.type !== "knowledge") continue;
    if (node.extractedFrom === sourceId || node.refs.includes(sourceId)) {
      known.add(knowledgeKey(node.title));
    }
  }
  const seen = new Set<string>();
  return candidates.filter((c) => {
    const key = knowledgeKey(c.title);
    if (!key || known.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Changes creating the planned categories, then the knowledge and their first flashcard. */
export async function extractionChanges(
  view: WikiView,
  plan: ExtractionPlan,
): Promise<ExtractionResult> {
  const { tree } = view;
  const root = tree.nodes.get(tree.rootId)!;
  const reserved: string[] = [];
  const changes: FileChange[] = [];
  const planned = new Map((plan.categories ?? []).map((c) => [c.key, c]));
  const created = new Map<string, { id: string; path: string; parentId: string }>();
  const categories: { id: string; title: string }[] = [];

  // Planned categories that hold knowledge, directly or below.
  const used = new Set<string>();
  for (const k of plan.knowledge) {
    for (let key: string | undefined = k.category; key && planned.has(key) && !used.has(key);) {
      used.add(key);
      key = planned.get(key)!.parent;
    }
  }
  const location = (id: string): { id: string; path: string; isPublic: boolean } => {
    const fresh = created.get(id);
    if (fresh) return { id: fresh.id, path: fresh.path, isPublic: false };
    const existing = tree.nodes.get(id);
    const node =
      existing && existing.space === "wiki" && existing.type === "category" ? existing : root;
    return { id: node.id, path: node.path, isPublic: node.isPublic };
  };
  const make = (key: string, depth: number): void => {
    const category = planned.get(key);
    if (!category || created.has(key) || depth > planned.size) return;
    if (planned.has(category.parent)) make(category.parent, depth + 1);
    const parent = location(category.parent);
    const page = createPage(
      view,
      {
        parentPath: parent.path,
        parentIsPublic: parent.isPublic,
        title: category.title.trim() || "New category",
        ...(plan.now ? { now: plan.now } : {}),
      },
      reserved,
    );
    reserved.push(page.indexPath);
    changes.push(page.change);
    created.set(key, { id: page.id, path: page.path, parentId: parent.id });
    categories.push({ id: page.id, title: category.title.trim() });
  };
  for (const key of used) make(key, 0);

  const sources: SourceRef[] = plan.sourceId ? [{ ref: plan.sourceId }] : [];
  const knowledge: { id: string; title: string }[] = [];
  const filedIn: string[] = [];
  for (const draft of plan.knowledge) {
    const parent = location(draft.category);
    filedIn.push(parent.id);
    const page = createPage(
      view,
      {
        parentPath: parent.path,
        parentIsPublic: parent.isPublic,
        title: draft.title.trim() || "Knowledge",
        type: "knowledge",
        body: serializeKnowledgeBody({ statement: draft.statement }),
        sources,
        ...(plan.sourceId ? { extracted_from: plan.sourceId } : {}),
        ...(plan.now ? { now: plan.now } : {}),
      },
      reserved,
    );
    reserved.push(page.indexPath);
    changes.push(page.change);
    if (draft.question.trim() && draft.answer.trim()) {
      const card = createFlashcard(
        view,
        { path: page.path, isPublic: false },
        {
          question: draft.question,
          answer: draft.answer,
          ...(plan.now ? { now: plan.now } : {}),
        },
        reserved,
      );
      reserved.push(card.indexPath);
      changes.push(card.change);
    }
    knowledge.push({ id: page.id, title: draft.title.trim() });
  }

  // Common hierarchy: a source not filed yet is filed where its knowledge goes.
  const source = plan.sourceId ? tree.nodes.get(plan.sourceId) : undefined;
  if (source?.type === "source" && !source.category && filedIn.length > 0) {
    const parents = new Map([...created.values()].map((c) => [c.id, c.parentId]));
    const category = categoryForSource(
      filedIn,
      (id) => parents.get(id) ?? tree.nodes.get(id)?.parentId,
      tree.rootId,
    );
    if (category !== tree.rootId) {
      changes.push(...(await updatePage(view, source.id, { category }, plan.now)));
    }
  }
  return { changes, knowledge, categories };
}
