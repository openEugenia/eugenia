/** Prompts d'Eugenia : versions par défaut, surcharges du wiki et variables. */
import { parseDocument } from "@openeugenia/core";
import { DEFAULT_PROMPTS, type PromptName } from "./defaults.generated.ts";

export { DEFAULT_PROMPTS, type PromptName };

export const PROMPT_NAMES = Object.keys(DEFAULT_PROMPTS) as PromptName[];

/** Prompts lus dans `.notes/prompts/<nom>.md` du wiki. */
export type PromptOverrides = Partial<Record<PromptName, string>>;

export type PromptVariables = Record<string, string | undefined>;

export function isPromptName(name: string): name is PromptName {
  return Object.hasOwn(DEFAULT_PROMPTS, name);
}

/** Prompt système d'une tâche : surcharge éventuelle, sans frontmatter, variables remplacées. */
export function renderPrompt(
  name: PromptName,
  overrides: PromptOverrides = {},
  variables: PromptVariables = {},
): string {
  const raw = overrides[name] ?? DEFAULT_PROMPTS[name];
  const parsed = parseDocument(raw);
  const text = parsed.hasFrontmatter ? parsed.body : raw;
  const vars: PromptVariables = {
    wiki_title: "mon wiki",
    today: new Date().toISOString().slice(0, 10),
    ...variables,
  };
  return text
    .replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, key: string) => vars[key] ?? match)
    .trim();
}
