/** @openeugenia/ai — Eugenia : fournisseurs d'IA, prompts et tâches. */
export * from "./types.ts";
export * from "./constants.ts";
export * from "./errors.ts";
export { extractJson } from "./json.ts";
export { readSSE, type SSEEvent } from "./sse.ts";
export {
  AnthropicProvider,
  supportsEffort,
  supportsServerFallback,
} from "./providers/anthropic.ts";
export { isLocalUrl, OpenAICompatibleProvider } from "./providers/openai.ts";
export {
  createProvider,
  selectProvider,
  type ProviderSelection,
  type SelectedProvider,
} from "./providers/factory.ts";
export * from "./prompts/index.ts";
export * from "./tasks/context.ts";
export * from "./tasks/extract.ts";
export * from "./tasks/summarize.ts";
export * from "./tasks/evaluate.ts";
export * from "./tasks/discuss.ts";
export * from "./tasks/flashcards.ts";
export * from "./tasks/ask.ts";
export * from "./tasks/categories.ts";
export * from "./tasks/embed.ts";
export * from "./wiki.ts";
