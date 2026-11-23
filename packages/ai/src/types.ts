/** Common interface of AI providers (specification §11.1). */
import type { z } from "zod";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface GenerateRequest {
  /** System prompt (Eugenia's role for the task). */
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
  /** Reasoning depth, for models that support it. */
  effort?: Effort;
  /** Caches the conversation prefix (multi-turn discussions). */
  cache?: boolean;
  signal?: AbortSignal;
}

export interface JsonRequest<T> extends GenerateRequest {
  /** Schema of the structured output, validated client-side. */
  schema: z.ZodType<T>;
  /** Short name of the format (used by OpenAI-compatible APIs). */
  name: string;
}

export type ProviderKind = "anthropic" | "openai" | "ollama";

/**
 * Reasoning of a model that supports it (OpenAI-compatible `reasoning_effort`): `none` turns it
 * off (Mistral Small 4), `low` keeps it short (Mistral Large 4). Not sent when absent.
 */
export type ReasoningEffort = "none" | "low" | "medium" | "high";

export interface ProviderInfo {
  kind: ProviderKind;
  label: string;
  model: string;
  /** The model runs on the user's device or local network. */
  local: boolean;
}

export interface AIProvider {
  readonly info: ProviderInfo;
  /** Complete text answer. */
  complete(request: GenerateRequest): Promise<string>;
  /** Streamed answer (text fragments). */
  stream(request: GenerateRequest): AsyncIterable<string>;
  /** Structured JSON output, validated by the schema. */
  json<T>(request: JsonRequest<T>): Promise<T>;
  /** Number of input tokens (an estimate if the provider cannot count). */
  countTokens(request: GenerateRequest): Promise<number>;
  /** Embedding vectors, in the order of the texts (OpenAI-compatible providers). */
  embed?(texts: string[], signal?: AbortSignal): Promise<number[][]>;
}

/** Configuration of a provider, as entered in the settings. */
export interface ProviderConfig {
  kind: ProviderKind;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  label?: string;
  /** OpenAI-compatible providers: reasoning of the model, if it supports it. */
  reasoningEffort?: ReasoningEffort;
}
