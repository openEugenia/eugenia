/** Evaluation of a quiz answer: detailed feedback and score in [0, 1] (§8.3). */
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
    `<knowledge>\n${input.knowledge}\n</knowledge>`,
    `<question>\n${input.question}\n</question>`,
    `<expected_answer>\n${input.expected}\n</expected_answer>`,
    `<user_answer>\n${input.answer.trim() || "(no answer)"}\n</user_answer>`,
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
