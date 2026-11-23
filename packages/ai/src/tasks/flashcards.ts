/**
 * Flashcards of an atomic knowledge item: Eugenia proposes new questions that test the same
 * knowledge from other angles, without repeating the existing flashcards.
 */
import { z } from "zod";
import { systemPrompt, withSignal, type TaskContext } from "./context.ts";

export const FlashcardsSchema = z.object({
  cards: z.array(z.object({ question: z.string(), answer: z.string() })),
});

export interface FlashcardDraft {
  question: string;
  answer: string;
}

export interface FlashcardsInput {
  /** Statement of the knowledge item (the bold part is the learning target). */
  knowledge: string;
  title: string;
  /** Titles of the categories, from the root to the parent. */
  path: readonly string[];
  existing: readonly FlashcardDraft[];
  count?: number;
}

export async function proposeFlashcards(
  context: TaskContext,
  input: FlashcardsInput,
): Promise<FlashcardDraft[]> {
  const count = Math.min(5, Math.max(1, input.count ?? 3));
  const existing = input.existing
    .map((c, i) => `${i + 1}. Question: ${c.question}\n   Expected answer: ${c.answer}`)
    .join("\n");
  const result = await context.provider.json(
    withSignal(context, {
      system: systemPrompt(context, "flashcards"),
      messages: [
        {
          role: "user" as const,
          content: [
            `<knowledge>\nTitle: ${input.title}\nPath: ${[...input.path, input.title].join(" > ")}\n\n${input.knowledge}\n</knowledge>`,
            `<existing_flashcards>\n${existing || "(none)"}\n</existing_flashcards>`,
            `<count>${count}</count>`,
          ].join("\n"),
        },
      ],
      schema: FlashcardsSchema,
      name: "flashcards",
      effort: "medium" as const,
    }),
  );
  const seen = new Set(input.existing.map((c) => c.question.trim().toLowerCase()));
  const out: FlashcardDraft[] = [];
  for (const card of result.cards) {
    const question = card.question.trim();
    const answer = card.answer.trim();
    if (!question || !answer || seen.has(question.toLowerCase())) continue;
    seen.add(question.toLowerCase());
    out.push({ question, answer });
  }
  return out.slice(0, count);
}
