/** Extraction de connaissances atomiques : surlignage puis propositions (§8.1). */
import { z } from "zod";
import { excerpt, splitText, systemPrompt, withSignal, type TaskContext } from "./context.ts";

export const HighlightsSchema = z.object({
  highlights: z.array(z.object({ quote: z.string(), reason: z.string() })),
});

export const ProposalsSchema = z.object({
  cards: z.array(
    z.object({
      highlight: z.number().int(),
      knowledge: z.string(),
      title: z.string(),
      question: z.string(),
      answer: z.string(),
      category: z.object({
        existing_id: z.string().nullable(),
        new_title: z.string().nullable(),
        new_parent_id: z.string().nullable(),
      }),
    }),
  ),
});

export interface Highlight {
  id: string;
  start: number;
  end: number;
  quote: string;
  reason?: string;
  origin: "eugenia" | "user";
}

export interface CategoryOption {
  id: string;
  /** Chemin lisible : « Science > Astronomie ». */
  path: string;
  description?: string;
}

export interface KnowledgeProposal {
  highlightId: string;
  knowledge: string;
  title: string;
  question: string;
  answer: string;
  category: { existingId?: string; newTitle?: string; newParentId?: string };
}

let counter = 0;
export function highlightId(): string {
  counter += 1;
  return `h${Date.now().toString(36)}${counter.toString(36)}`;
}

/**
 * Texte normalisé pour comparer une citation au texte : sans espaces (les espaces des
 * guillemets français varient), apostrophes et guillemets unifiés, en minuscules ; `map`
 * donne la position d'origine de chaque caractère.
 */
function normalized(text: string): { value: string; map: number[] } {
  let value = "";
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let c = text[i]!;
    if (/\s/.test(c)) continue;
    if (c === "’" || c === "‘") c = "'";
    else if (c === "“" || c === "”" || c === "«" || c === "»") c = '"';
    value += c.toLowerCase();
    map.push(i);
  }
  return { value, map };
}

/** Position d'une citation dans le texte : exacte, sinon à la ponctuation et aux espaces près. */
export function locateQuote(
  text: string,
  quote: string,
  from = 0,
): { start: number; end: number } | null {
  const q = quote.trim();
  if (q === "") return null;
  let index = text.indexOf(q, from);
  if (index < 0) index = text.indexOf(q);
  if (index >= 0) return { start: index, end: index + q.length };
  const t = normalized(text);
  const n = normalized(q).value;
  if (n === "") return null;
  const startNorm = t.map.findIndex((pos) => pos >= from);
  let found = t.value.indexOf(n, Math.max(0, startNorm));
  if (found < 0) found = t.value.indexOf(n);
  if (found < 0) return null;
  const start = t.map[found]!;
  const end = (t.map[found + n.length - 1] ?? text.length - 1) + 1;
  return { start, end };
}

/** Étape 2 : Eugenia surligne les connaissances candidates du texte. */
export async function highlightKnowledge(context: TaskContext, text: string): Promise<Highlight[]> {
  const highlights: Highlight[] = [];
  for (const chunk of splitText(text)) {
    const result = await context.provider.json(
      withSignal(context, {
        system: systemPrompt(context, "extract"),
        messages: [
          {
            role: "user" as const,
            content: `<etape>surlignage</etape>\n<texte>\n${chunk.text}\n</texte>`,
          },
        ],
        schema: HighlightsSchema,
        name: "highlights",
        effort: "high" as const,
      }),
    );
    let cursor = 0;
    for (const item of result.highlights) {
      const position = locateQuote(chunk.text, item.quote, cursor);
      if (!position) continue;
      cursor = position.start;
      const start = chunk.offset + position.start;
      const end = chunk.offset + position.end;
      if (highlights.some((h) => h.start === start && h.end === end)) continue;
      highlights.push({
        id: highlightId(),
        start,
        end,
        quote: text.slice(start, end),
        reason: item.reason,
        origin: "eugenia",
      });
    }
  }
  return highlights.sort((a, b) => a.start - b.start || a.end - b.end);
}

function categoriesBlock(categories: readonly CategoryOption[]): string {
  return categories
    .map(
      (c) =>
        `- id: ${c.id} | chemin : ${c.path}${c.description ? ` | ${excerpt(c.description, 160)}` : ""}`,
    )
    .join("\n");
}

/** Étape 4 : Eugenia propose une flashcard par passage surligné. */
export async function proposeKnowledge(
  context: TaskContext,
  input: {
    text: string;
    highlights: readonly Pick<Highlight, "id" | "quote">[];
    categories: readonly CategoryOption[];
  },
): Promise<KnowledgeProposal[]> {
  const known = new Set(input.categories.map((c) => c.id));
  const proposals: KnowledgeProposal[] = [];
  const batchSize = 15;
  for (let i = 0; i < input.highlights.length; i += batchSize) {
    const batch = input.highlights.slice(i, i + batchSize);
    const passages = batch.map((h, n) => `${n + 1}. « ${h.quote} »`).join("\n");
    const result = await context.provider.json(
      withSignal(context, {
        system: systemPrompt(context, "extract"),
        messages: [
          {
            role: "user" as const,
            content: [
              "<etape>proposition</etape>",
              `<texte>\n${excerpt(input.text, 60000)}\n</texte>`,
              `<passages>\n${passages}\n</passages>`,
              `<categories>\n${categoriesBlock(input.categories)}\n</categories>`,
            ].join("\n"),
          },
        ],
        schema: ProposalsSchema,
        name: "proposals",
        effort: "high" as const,
      }),
    );
    for (const card of result.cards) {
      const highlight = batch[card.highlight - 1];
      if (!highlight) continue;
      const category: KnowledgeProposal["category"] = {};
      if (card.category.existing_id && known.has(card.category.existing_id)) {
        category.existingId = card.category.existing_id;
      } else if (card.category.new_title?.trim()) {
        category.newTitle = card.category.new_title.trim();
        if (card.category.new_parent_id && known.has(card.category.new_parent_id)) {
          category.newParentId = card.category.new_parent_id;
        }
      }
      proposals.push({
        highlightId: highlight.id,
        knowledge: card.knowledge.trim(),
        title: card.title.trim(),
        question: card.question.trim(),
        answer: card.answer.trim(),
        category,
      });
    }
  }
  return proposals;
}
