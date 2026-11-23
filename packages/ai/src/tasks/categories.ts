/** Subcategory suggestions for a category (§8.1). */
import { z } from "zod";
import { excerpt, systemPrompt, withSignal, type TaskContext } from "./context.ts";

export const CategorySuggestionsSchema = z.object({
  suggestions: z.array(z.object({ title: z.string(), reason: z.string() })),
});

export type CategorySuggestion = z.infer<typeof CategorySuggestionsSchema>["suggestions"][number];

export async function suggestCategories(
  context: TaskContext,
  input: {
    category: string;
    path: readonly string[];
    subcategories: readonly string[];
    samples: readonly string[];
  },
): Promise<CategorySuggestion[]> {
  const result = await context.provider.json(
    withSignal(context, {
      system: systemPrompt(context, "categories"),
      messages: [
        {
          role: "user" as const,
          content: [
            `<category>${[...input.path, input.category].join(" > ")}</category>`,
            `<subcategories>\n${input.subcategories.map((s) => `- ${s}`).join("\n") || "(none)"}\n</subcategories>`,
            `<knowledge>\n${input.samples.map((s) => `- ${excerpt(s, 300)}`).join("\n") || "(none)"}\n</knowledge>`,
          ].join("\n"),
        },
      ],
      schema: CategorySuggestionsSchema,
      name: "categories",
      effort: "low" as const,
    }),
  );
  const existing = new Set(input.subcategories.map((s) => s.toLowerCase()));
  return result.suggestions
    .filter((s) => s.title.trim() && !existing.has(s.title.trim().toLowerCase()))
    .slice(0, 5);
}
