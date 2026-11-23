/** Personal settings, kept in the browser only (§5.9, §7, §11.1). */
import type { ProviderConfig } from "@openeugenia/ai";
import { getSettingsRecord, putSettingsRecord } from "./db.ts";

export type Theme = "auto" | "light" | "dark";

export interface AISettings {
  /** Main provider (Claude, OpenAI-compatible…). */
  main?: ProviderConfig;
  /** Local provider (Ollama…). */
  local?: ProviderConfig;
  /** Embeddings for semantic search (Mistral by default, or OpenAI-compatible). */
  embeddings?: ProviderConfig;
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
