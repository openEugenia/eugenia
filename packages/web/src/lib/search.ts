/** Recherche plein texte côté client (MiniSearch), avec filtres (§9.2, vue 9). */
import MiniSearch from "minisearch";
import {
  ancestors,
  currentMastery,
  dayNumber,
  markdownToText,
  parseDocument,
  type CardState,
  type WikiNode,
  type WikiTree,
} from "@openeugenia/core";

export interface SearchDocument {
  id: string;
  title: string;
  text: string;
  tags: string;
  path: string;
}

import { normalizeTerm } from "./text.ts";

export { normalizeTerm };

export function createIndex(): MiniSearch<SearchDocument> {
  return new MiniSearch<SearchDocument>({
    fields: ["title", "text", "tags", "path"],
    storeFields: ["title"],
    processTerm: (term) => {
      const t = normalizeTerm(term);
      return t.length > 1 ? t : null;
    },
    searchOptions: {
      boost: { title: 4, tags: 2, path: 0.5 },
      prefix: true,
      fuzzy: 0.2,
      combineWith: "AND",
    },
  });
}

export function documentFor(
  tree: WikiTree,
  node: WikiNode,
  content: string | undefined,
): SearchDocument {
  const body =
    content !== undefined ? markdownToText(parseDocument(content).body) : (node.description ?? "");
  return {
    id: node.id,
    title: node.title,
    text: body,
    tags: node.tags.join(" "),
    path: ancestors(tree, node.id)
      .map((a) => a.title)
      .join(" "),
  };
}

export interface SearchFilters {
  type?: "note" | "flashcard" | "";
  tag?: string;
  visibility?: "public" | "private" | "";
  /** Maîtrise : `low` sous le seuil, `mid`, `high` au-dessus de 70 %. */
  mastery?: "low" | "mid" | "high" | "";
}

export function matchesFilters(
  node: WikiNode,
  filters: SearchFilters,
  mastery: ReadonlyMap<string, CardState>,
  threshold: number,
): boolean {
  if (filters.type && node.type !== filters.type) return false;
  if (filters.tag && !node.tags.includes(filters.tag)) return false;
  if (filters.visibility && (filters.visibility === "public") !== node.isPublic) return false;
  if (filters.mastery) {
    const state = mastery.get(node.id);
    if (!state) return false;
    const value = currentMastery(state, dayNumber(Date.now()));
    if (filters.mastery === "low" && value >= threshold) return false;
    if (filters.mastery === "mid" && (value < threshold || value >= 0.7)) return false;
    if (filters.mastery === "high" && value < 0.7) return false;
  }
  return true;
}

/** Extrait du texte autour du premier terme trouvé. */
export function snippet(text: string, terms: readonly string[], length = 180): string {
  const normalized = normalizeTerm(text);
  let at = -1;
  for (const term of terms) {
    at = normalized.indexOf(normalizeTerm(term));
    if (at >= 0) break;
  }
  const start = Math.max(0, at < 0 ? 0 : at - 60);
  const out = text
    .slice(start, start + length)
    .replace(/\s+/g, " ")
    .trim();
  return `${start > 0 ? "…" : ""}${out}${start + length < text.length ? "…" : ""}`;
}
