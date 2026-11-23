/** Personal settings, kept in the browser only (§5.9, §7, §11.1). */
import type { ProviderConfig } from "@openeugenia/ai";
import { DEFAULT_INDEX_MODEL, DEFAULT_MISTRAL_URL } from "@openeugenia/ai/constants";
import { getSettingsRecord, putSettingsRecord } from "./db.ts";

export type Theme = "auto" | "light" | "dark";

export interface AISettings {
  /** Main provider (Claude, OpenAI-compatible…). */
  main?: ProviderConfig;
  /** Local provider (Ollama…). */
  local?: ProviderConfig;
  /** Embeddings for semantic search (Mistral by default, or OpenAI-compatible). */
  embeddings?: ProviderConfig;
  /**
   * Indexing of sources: a large model (Mistral Large by default) that describes each source as
   * a knowledge tree. Without a key of its own, it uses the Mistral key of the semantic search.
   */
  indexing?: ProviderConfig;
  /** Index each new or changed source automatically (default: yes). */
  autoIndex?: boolean;
  /** Keep private nodes for the local AI; `null`: question not asked yet. */
  localOnlyForPrivate: boolean | null;
  /** The "private content to a remote provider" warning was acknowledged. */
  remoteWarningAcknowledged: boolean;
}

export interface Settings {
  /** Fine-grained GitHub token (read/write limited to the private repository). */
  githubToken?: string;
  ai: AISettings;
  theme: Theme;
}

export const DEFAULT_SETTINGS: Settings = {
  ai: { localOnlyForPrivate: null, remoteWarningAcknowledged: false },
  theme: "auto",
};

export async function loadSettings(): Promise<Settings> {
  try {
    const stored = await getSettingsRecord();
    return stored
      ? { ...DEFAULT_SETTINGS, ...stored, ai: { ...DEFAULT_SETTINGS.ai, ...stored.ai } }
      : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: Settings): Promise<void> {
  await putSettingsRecord(settings);
}

export function hasAI(settings: Settings): boolean {
  return Boolean(settings.ai.main || settings.ai.local);
}

export function hasEmbeddings(settings: Settings): boolean {
  return Boolean(settings.ai.embeddings?.model);
}

/**
 * Provider of the indexing of sources: its own settings, otherwise Mistral Large with the key
 * of the semantic search (if it is a Mistral key).
 */
export function indexingConfig(settings: Settings): ProviderConfig | undefined {
  const { indexing, embeddings } = settings.ai;
  const mistralKey =
    embeddings?.apiKey && (embeddings.baseUrl ?? DEFAULT_MISTRAL_URL) === DEFAULT_MISTRAL_URL
      ? embeddings.apiKey
      : undefined;
  if (indexing?.model) {
    const baseUrl = indexing.baseUrl || DEFAULT_MISTRAL_URL;
    const apiKey = indexing.apiKey || (baseUrl === DEFAULT_MISTRAL_URL ? mistralKey : undefined);
    return { ...indexing, baseUrl, ...(apiKey ? { apiKey } : {}) };
  }
  return mistralKey
    ? {
        kind: "openai",
        baseUrl: DEFAULT_MISTRAL_URL,
        model: DEFAULT_INDEX_MODEL,
        apiKey: mistralKey,
        label: "Mistral",
      }
    : undefined;
}

export function hasIndexing(settings: Settings): boolean {
  return indexingConfig(settings) !== undefined;
}
