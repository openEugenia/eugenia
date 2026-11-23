/** Personal settings, kept in the browser only (§5.9, §7, §11.1). */
import type { ProviderConfig } from "@openeugenia/ai";
import { DEFAULT_INDEX_PRESET, DEFAULT_MISTRAL_URL, indexPreset } from "@openeugenia/ai/constants";
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
   * Indexing of sources: a model that describes each source as a knowledge tree. Its key and
   * server (without a key of its own, the Mistral key of the semantic search), and its model for
   * the `custom` preset.
   */
  indexing?: ProviderConfig;
  /** Preset of the indexing model (Mistral Small without reasoning by default), or `custom`. */
  indexingPreset?: string;
  /** Index each new or changed source automatically (default: yes). */
  autoIndex?: boolean;
  /**
   * Add the knowledge proposed by each new index to the wiki without review, filed by Eugenia
   * (default: yes).
   */
  autoExtract?: boolean;
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

export const CUSTOM_INDEX_PRESET = "custom";

/**
 * Provider of the indexing of sources: the model of the chosen preset (or of `preset`, to index
 * with another one), with the key of the indexing settings, otherwise the Mistral key of the
 * semantic search.
 */
export function indexingConfig(settings: Settings, preset?: string): ProviderConfig | undefined {
  const { indexing, embeddings } = settings.ai;
  const baseUrl = indexing?.baseUrl || DEFAULT_MISTRAL_URL;
  const mistralKey =
    embeddings?.apiKey && (embeddings.baseUrl ?? DEFAULT_MISTRAL_URL) === DEFAULT_MISTRAL_URL
      ? embeddings.apiKey
      : undefined;
  const apiKey = indexing?.apiKey || (baseUrl === DEFAULT_MISTRAL_URL ? mistralKey : undefined);
  const chosen = preset ?? settings.ai.indexingPreset ?? DEFAULT_INDEX_PRESET;
  let model: string | undefined;
  let reasoningEffort = indexing?.reasoningEffort;
  if (chosen === CUSTOM_INDEX_PRESET) {
    model = indexing?.model;
  } else {
    const found = indexPreset(chosen) ?? indexPreset(DEFAULT_INDEX_PRESET)!;
    model = found.model;
    reasoningEffort = found.reasoningEffort;
  }
  // Without a key, only another server (a local one, for example) makes sense.
  if (!model || (!apiKey && baseUrl === DEFAULT_MISTRAL_URL)) return undefined;
  return {
    kind: "openai",
    baseUrl,
    model,
    ...(apiKey ? { apiKey } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(baseUrl === DEFAULT_MISTRAL_URL ? { label: "Mistral" } : {}),
  };
}

export function hasIndexing(settings: Settings): boolean {
  return indexingConfig(settings) !== undefined;
}
