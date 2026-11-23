/** Dependency-free constants (usable without loading the SDKs). */

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";
export const DEFAULT_OLLAMA_URL = "http://localhost:11434/v1";
export const DEFAULT_OLLAMA_MODEL = "llama3.1";
export const DEFAULT_OPENAI_URL = "https://api.openai.com/v1";
export const DEFAULT_MISTRAL_URL = "https://api.mistral.ai/v1";
/** Default embedding model (semantic search), from Mistral. */
export const DEFAULT_EMBEDDING_MODEL = "mistral-embed";
/**
 * Default model for indexing sources: a large Mistral model, which reads a whole source and
 * describes it as a knowledge tree, then read at low cost by smaller models.
 */
export const DEFAULT_INDEX_MODEL = "mistral-large-latest";

/** Internal link produced by Eugenia: `[Title](eugenia:ID)`. */
export const EUGENIA_LINK_PREFIX = "eugenia:";
