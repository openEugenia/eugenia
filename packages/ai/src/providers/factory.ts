/** Creates a provider from its configuration, and the "local AI for private content" rule. */
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
        ...(config.reasoningEffort ? { reasoningEffort: config.reasoningEffort } : {}),
        ...(options.fetch ? { fetch: options.fetch } : {}),
      });
    }
    default:
      throw new AIError("config", "Unknown AI provider.");
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
  /** Main provider (often remote). */
  main?: AIProvider | undefined;
  /** Local provider (Ollama…). */
  local?: AIProvider | undefined;
  /** The user keeps private nodes for a local AI (§11.1). */
  localOnlyForPrivate: boolean;
}

export interface SelectedProvider {
  provider: AIProvider;
  /** Private content goes to a remote provider: warn the user the first time. */
  sendsPrivateToRemote: boolean;
}

/**
 * Picks the provider of a task. If the task involves a private node and the user keeps
 * private content for a local AI, only the local provider is allowed: otherwise, the action
 * is blocked with an explanation.
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
        "This task involves private knowledge, which you chose to keep for a local AI. Set up a local provider (for example Ollama) in the settings.",
      );
    }
    return { provider: local, sendsPrivateToRemote: false };
  }
  const provider = selection.main ?? selection.local;
  if (!provider) {
    throw new AIError("config", "No AI provider is configured: add one in the settings.");
  }
  return { provider, sendsPrivateToRemote: involvesPrivate && !provider.info.local };
}
