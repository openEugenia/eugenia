/** Paramètres personnels, conservés dans le navigateur seulement (§5.9, §7, §11.1). */
import type { ProviderConfig } from "@openeugenia/ai";
import { getSettingsRecord, putSettingsRecord } from "./db.ts";

export type Theme = "auto" | "light" | "dark";

export interface AISettings {
  /** Fournisseur principal (Claude, compatible OpenAI…). */
  main?: ProviderConfig;
  /** Fournisseur local (Ollama…). */
  local?: ProviderConfig;
  /** Embeddings pour la recherche sémantique (Mistral par défaut, ou compatible OpenAI). */
  embeddings?: ProviderConfig;
  /** Réserver les nœuds privés à l'IA locale ; `null` : question pas encore posée. */
  localOnlyForPrivate: boolean | null;
  /** L'avertissement « contenu privé vers un fournisseur distant » a été accepté. */
  remoteWarningAcknowledged: boolean;
}

export interface Settings {
  /** Jeton GitHub fine-grained (lecture/écriture limitées au dépôt privé). */
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
