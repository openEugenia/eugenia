/** Dependency-free constants (usable without loading the SDKs). */

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";
export const DEFAULT_OLLAMA_URL = "http://localhost:11434/v1";
export const DEFAULT_OLLAMA_MODEL = "llama3.1";
export const DEFAULT_OPENAI_URL = "https://api.openai.com/v1";
export const DEFAULT_MISTRAL_URL = "https://api.mistral.ai/v1";
/** Default embedding model (semantic search), from Mistral. */
export const DEFAULT_EMBEDDING_MODEL = "mistral-embed";
/** Model of indexing presets, with or without reasoning (OpenAI-compatible Mistral API). */
export interface IndexModelPreset {
  id: string;
  label: string;
  model: string;
  /** `reasoning_effort` sent to the model (absent: the model does not support it). */
  reasoningEffort?: "none" | "low" | "medium" | "high";
  /** Trade-off, for the settings. */
  description: string;
}

/**
 * Models offered to index the sources (§8.6), from the slowest to the fastest. A model that
 * reasons thinks before writing the tree. Timings measured on a 30 KB text (2026-11).
 */
export const INDEX_MODEL_PRESETS: readonly IndexModelPreset[] = [
  {
    id: "large",
    label: "Mistral Large — with reasoning",
    model: "mistral-large-latest",
    reasoningEffort: "high",
    description: "Thinks the longest before writing; about 3½ minutes for a 30 KB text.",
  },
  {
    id: "small-reasoning",
    label: "Mistral Small — with reasoning",
    model: "mistral-small-latest",
    reasoningEffort: "high",
    description: "The most detailed trees in our tests; about 45 s for a 30 KB text.",
  },
  {
    id: "small",
    label: "Mistral Small — without reasoning",
    model: "mistral-small-latest",
    reasoningEffort: "none",
    description:
      "Fast and cheap, with plenty of knowledge to extract; about 25 s for a 30 KB text.",
  },
  {
    id: "ministral-14b",
    label: "Ministral 14B",
    model: "ministral-14b-latest",
    description: "Without reasoning; detailed trees, less knowledge to extract; about 30 s.",
  },
  {
    id: "ministral-8b",
    label: "Ministral 8B",
    model: "ministral-8b-latest",
    description: "The fastest and cheapest, with shallower trees; about 15 s.",
  },
];

/** Default indexing preset. */
export const DEFAULT_INDEX_PRESET = "small";

/** Default model for indexing sources (the model of the default preset). */
export const DEFAULT_INDEX_MODEL = "mistral-small-latest";

export function indexPreset(id: string | undefined): IndexModelPreset | undefined {
  return INDEX_MODEL_PRESETS.find((p) => p.id === id);
}

/** Internal link produced by Eugenia: `[Title](eugenia:ID)`. */
export const EUGENIA_LINK_PREFIX = "eugenia:";
