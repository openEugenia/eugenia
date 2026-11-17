import type { PromptName, PromptOverrides, PromptVariables } from "../prompts/index.ts";
import { renderPrompt } from "../prompts/index.ts";
import type { AIProvider } from "../types.ts";

/** Contexte commun des tâches d'Eugenia. */
export interface TaskContext {
  provider: AIProvider;
  prompts?: PromptOverrides;
  variables?: PromptVariables;
  signal?: AbortSignal;
}

export function systemPrompt(context: TaskContext, name: PromptName): string {
  return renderPrompt(name, context.prompts, context.variables);
}

export function withSignal<T extends object>(
  context: TaskContext,
  request: T,
): T & { signal?: AbortSignal } {
  return context.signal ? { ...request, signal: context.signal } : request;
}

/** Tronque un contenu trop long pour une tâche qui n'en a besoin que d'un aperçu. */
export function excerpt(text: string, max: number): string {
  const clean = text.trim();
  return clean.length <= max ? clean : `${clean.slice(0, max)}\n[…]`;
}

/** Découpe un long texte en morceaux d'au plus `max` caractères, sur des paragraphes. */
export function splitText(text: string, max = 12000): { text: string; offset: number }[] {
  if (text.length <= max) return [{ text, offset: 0 }];
  const chunks: { text: string; offset: number }[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + max);
    if (end < text.length) {
      const paragraph = text.lastIndexOf("\n\n", end);
      const sentence = text.lastIndexOf(". ", end);
      if (paragraph > start + max / 2) end = paragraph + 2;
      else if (sentence > start + max / 2) end = sentence + 2;
    }
    chunks.push({ text: text.slice(start, end), offset: start });
    start = end;
  }
  return chunks;
}
