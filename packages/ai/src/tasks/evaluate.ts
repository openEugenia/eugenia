/** Évaluation d'une réponse de quiz : retour détaillé et score dans [0, 1] (§8.3). */
import { z } from "zod";
import { systemPrompt, withSignal, type TaskContext } from "./context.ts";

export const EvaluationSchema = z.object({
  score: z.number(),
  feedback: z.string(),
  missing: z.array(z.string()),
  superfluous: z.array(z.string()),
});

export type Evaluation = z.infer<typeof EvaluationSchema>;

export interface EvaluationInput {
  knowledge: string;
  question: string;
  expected: string;
  answer: string;
}

export function evaluationMessage(input: EvaluationInput): string {
  return [
    `<connaissance>\n${input.knowledge}\n</connaissance>`,
    `<question>\n${input.question}\n</question>`,
    `<reponse_attendue>\n${input.expected}\n</reponse_attendue>`,
    `<reponse_utilisateur>\n${input.answer.trim() || "(pas de réponse)"}\n</reponse_utilisateur>`,
  ].join("\n");
}

export async function evaluateAnswer(
  context: TaskContext,
  input: EvaluationInput,
): Promise<Evaluation> {
  const result = await context.provider.json(
    withSignal(context, {
      system: systemPrompt(context, "evaluate"),
      messages: [{ role: "user" as const, content: evaluationMessage(input) }],
      schema: EvaluationSchema,
      name: "evaluation",
      effort: "low" as const,
    }),
  );
  const score = Number.isFinite(result.score) ? Math.min(1, Math.max(0, result.score)) : 0;
  return { ...result, score: Math.round(score * 100) / 100 };
}
