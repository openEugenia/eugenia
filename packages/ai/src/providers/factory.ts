/** Création d'un fournisseur à partir de sa configuration, et règle « IA locale pour le privé ». */
import { AIError } from "../errors.ts";
import type { AIProvider, ProviderConfig } from "../types.ts";
import { AnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from "./anthropic.ts";
import {
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OLLAMA_URL,
  DEFAULT_OPENAI_URL,
  OpenAICompatibleProvider,
} from "./openai.ts";

export function createProvider(
  config: ProviderConfig,
  options: { fetch?: typeof fetch } = {},
): AIProvider {
  switch (config.kind) {
    case "anthropic":
      return new AnthropicProvider({
        ...(config.apiKey ? { apiKey: config.apiKey } : {}),
        model: config.model || DEFAULT_ANTHROPIC_MODEL,
        ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
        ...(config.label ? { label: config.label } : {}),
        ...(options.fetch ? { fetch: options.fetch } : {}),
      });
    case "ollama":
      return new OpenAICompatibleProvider({
        kind: "ollama",
        baseUrl: config.baseUrl || DEFAULT_OLLAMA_URL,
        model: config.model || DEFAULT_OLLAMA_MODEL,
        local: true,
        ...(config.apiKey ? { apiKey: config.apiKey } : {}),
        ...(config.label ? { label: config.label } : {}),
        ...(options.fetch ? { fetch: options.fetch } : {}),
      });
    case "openai": {
      const baseUrl = config.baseUrl || DEFAULT_OPENAI_URL;
      const label = config.label || (isMistralUrl(baseUrl) ? "Mistral" : undefined);
      return new OpenAICompatibleProvider({
        kind: "openai",
        baseUrl,
        model: config.model ?? "",
        ...(config.apiKey ? { apiKey: config.apiKey } : {}),
        ...(label ? { label } : {}),
        ...(options.fetch ? { fetch: options.fetch } : {}),
      });
    }
    default:
      throw new AIError("config", "Fournisseur d'IA inconnu.");
  }
}

function isMistralUrl(url: string): boolean {
  try {
    return new URL(url).hostname === "api.mistral.ai";
  } catch {
    return false;
  }
}

export interface ProviderSelection {
  /** Fournisseur principal (souvent distant). */
  main?: AIProvider | undefined;
  /** Fournisseur local (Ollama…). */
  local?: AIProvider | undefined;
  /** L'utilisateur réserve les nœuds privés à une IA locale (§11.1). */
  localOnlyForPrivate: boolean;
}

export interface SelectedProvider {
  provider: AIProvider;
  /** Du contenu privé part vers un fournisseur distant : prévenir l'utilisateur la première fois. */
  sendsPrivateToRemote: boolean;
}

/**
 * Choisit le fournisseur d'une tâche. Si la tâche implique un nœud privé et que
 * l'utilisateur a réservé le privé à l'IA locale, seul le fournisseur local est
 * permis : à défaut, l'action est bloquée avec une explication.
 */
export function selectProvider(
  selection: ProviderSelection,
  involvesPrivate: boolean,
): SelectedProvider {
  if (involvesPrivate && selection.localOnlyForPrivate) {
    const local = selection.local ?? (selection.main?.info.local ? selection.main : undefined);
    if (!local) {
      throw new AIError(
        "privacy",
        "Ce traitement porte sur des connaissances privées, que vous avez choisi de réserver à une IA locale. Configurez un fournisseur local (par exemple Ollama) dans les paramètres.",
      );
    }
    return { provider: local, sendsPrivateToRemote: false };
  }
  const provider = selection.main ?? selection.local;
  if (!provider) {
    throw new AIError(
      "config",
      "Aucun fournisseur d'IA n'est configuré : ajoutez-en un dans les paramètres.",
    );
  }
  return { provider, sendsPrivateToRemote: involvesPrivate && !provider.info.local };
}
