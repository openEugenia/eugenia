/**
 * Extraction of atomic knowledge: highlighting, then proposals (§8.1). The categories of the
 * proposals are chosen afterwards, for the whole document (see `categorize.ts`).
 */
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
  /** Readable path: "Science > Astronomy". */
  path: string;
  description?: string;
}

export interface KnowledgeProposal {
  highlightId: string;
  knowledge: string;
  title: string;
  question: string;
  answer: string;
}

let counter = 0;
export function highlightId(): string {
  counter += 1;
  return `h${Date.now().toString(36)}${counter.toString(36)}`;
}

/**
 * Normalized text to compare a quote with the text: without spaces (spaces around quotation
 * marks vary), with unified apostrophes and quotation marks, in lowercase; `map` gives the
 * original position of each character.
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

/** Position of a quote in the text: exact, otherwise up to punctuation and spaces. */
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

/** Step 2: Eugenia highlights the candidate knowledge of the text. */
export async function highlightKnowledge(context: TaskContext, text: string): Promise<Highlight[]> {
  const highlights: Highlight[] = [];
  for (const chunk of splitText(text)) {
    const result = await context.provider.json(
      withSignal(context, {
        system: systemPrompt(context, "extract"),
        messages: [
          {
            role: "user" as const,
            content: `<step>highlight</step>\n<text>\n${chunk.text}\n</text>`,
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

/** Step 4: Eugenia proposes a knowledge item and its first flashcard per highlighted passage. */
export async function proposeKnowledge(
  context: TaskContext,
  input: {
    text: string;
    highlights: readonly Pick<Highlight, "id" | "quote">[];
  },
): Promise<KnowledgeProposal[]> {
  const proposals: KnowledgeProposal[] = [];
  const batchSize = 15;
  for (let i = 0; i < input.highlights.length; i += batchSize) {
    const batch = input.highlights.slice(i, i + batchSize);
    const passages = batch.map((h, n) => `${n + 1}. "${h.quote}"`).join("\n");
    const result = await context.provider.json(
      withSignal(context, {
        system: systemPrompt(context, "extract"),
        messages: [
          {
            role: "user" as const,
            content: [
              "<step>propose</step>",
              `<text>\n${excerpt(input.text, 60000)}\n</text>`,
              `<passages>\n${passages}\n</passages>`,
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
      proposals.push({
        highlightId: highlight.id,
        knowledge: card.knowledge.trim(),
        title: card.title.trim(),
        question: card.question.trim(),
        answer: card.answer.trim(),
      });
    }
  }
  return proposals;
}
