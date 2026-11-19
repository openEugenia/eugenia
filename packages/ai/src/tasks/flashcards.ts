/**
 * Flashcards d'une connaissance atomique : Eugenia propose de nouvelles questions qui testent
 * la même connaissance sous d'autres angles, sans reprendre les flashcards existantes.
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
  /** Énoncé de la connaissance (la partie en gras est la cible d'apprentissage). */
  knowledge: string;
  title: string;
  /** Titres des catégories, de la racine au parent. */
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
    .map((c, i) => `${i + 1}. Question : ${c.question}\n   Réponse attendue : ${c.answer}`)
    .join("\n");
  const result = await context.provider.json(
    withSignal(context, {
      system: systemPrompt(context, "flashcards"),
      messages: [
        {
          role: "user" as const,
          content: [
            `<connaissance>\nTitre : ${input.title}\nChemin : ${[...input.path, input.title].join(" > ")}\n\n${input.knowledge}\n</connaissance>`,
            `<flashcards_existantes>\n${existing || "(aucune)"}\n</flashcards_existantes>`,
            `<nombre>${count}</nombre>`,
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
