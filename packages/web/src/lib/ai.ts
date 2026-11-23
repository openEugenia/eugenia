/**
 * Access to Eugenia from the app: choice of the provider according to the settings and the
 * "local AI for private content" rule (§11.1), warning before private content is first sent to
 * a remote provider.
 */
import type { AIProvider, TaskContext } from "@openeugenia/ai";
import { useSettings } from "../store/settings.ts";
import { confirmDialog } from "../store/ui.ts";
import { useWiki } from "../store/wiki.ts";
import { hasAI } from "./settings.ts";

/** Asks (once) whether private nodes should be kept for a local AI. */
export async function ensurePrivacyChoice(): Promise<void> {
  const { settings, update } = useSettings.getState();
  if (settings.ai.localOnlyForPrivate !== null) return;
  const localOnly = await confirmDialog({
    title: "Private knowledge and AI",
    body: "Do you want to keep the processing of your private knowledge for a local AI (for example Ollama, on your computer)? If so, no private data will be sent to a remote provider; actions on private nodes will be blocked until a local AI is configured. You can change your mind in the settings.",
    confirmLabel: "Yes, local AI for private content",
    cancelLabel: "No, use my provider",
  });
  await update((s) => ({ ...s, ai: { ...s.ai, localOnlyForPrivate: localOnly } }));
}

/** Warns (once) before private content is first sent to a remote provider. */
async function acknowledgeRemote(provider: AIProvider): Promise<void> {
  if (useSettings.getState().settings.ai.remoteWarningAcknowledged) return;
  const { AIError } = await import("@openeugenia/ai");
  const accepted = await confirmDialog({
    title: "Sending private content",
    body: `This action sends private knowledge to ${provider.info.label} (${provider.info.model}). It then leaves your device to be processed by this provider. This warning is only shown once; you can keep private content for a local AI in the settings.`,
    confirmLabel: "Understood, send",
  });
  if (!accepted) throw new AIError("aborted", "Sending cancelled.");
  await useSettings
    .getState()
    .update((s) => ({ ...s, ai: { ...s.ai, remoteWarningAcknowledged: true } }));
}

export interface EmbeddingAccess {
  provider: AIProvider;
  /** Private pages may be sent to this provider. */
  allowsPrivate: boolean;
}

/**
 * Embedding provider (semantic search). If private content is kept for a local AI and this
 * provider is remote, only public pages are sent to it. With `sendsPrivate`, the warning about
 * sending private content is shown the first time.
 */
export async function embeddingAccess(sendsPrivate = false): Promise<EmbeddingAccess> {
  const { AIError, createProvider } = await import("@openeugenia/ai");
  const config = useSettings.getState().settings.ai.embeddings;
  if (!config?.model) {
    throw new AIError(
      "config",
      "Semantic search is not configured: add a Mistral key in the settings.",
    );
  }
  const provider = createProvider(config);
  if (provider.info.local) return { provider, allowsPrivate: true };
  if (sendsPrivate) await ensurePrivacyChoice();
  const allowsPrivate = useSettings.getState().settings.ai.localOnlyForPrivate !== true;
  if (sendsPrivate && allowsPrivate) await acknowledgeRemote(provider);
  return { provider, allowsPrivate };
}

/**
 * Context of an Eugenia task. `involvesPrivate` tells whether private nodes will be sent to the
 * model.
 */
export async function taskContext(
  involvesPrivate: boolean,
  signal?: AbortSignal,
): Promise<TaskContext> {
  // The AI module (SDK included) is only loaded the first time Eugenia is used.
  const { AIError, createProvider, selectProvider } = await import("@openeugenia/ai");
  const settingsState = useSettings.getState();
  if (!hasAI(settingsState.settings)) {
    throw new AIError("config", "No AI provider is configured: add one in the settings.");
  }
  await ensurePrivacyChoice();
  const { settings } = useSettings.getState();
  const ai = settings.ai;
  const selection = {
    main: ai.main ? createProvider(ai.main) : undefined,
    local: ai.local ? createProvider(ai.local) : undefined,
    localOnlyForPrivate: ai.localOnlyForPrivate === true,
  };
  const { provider, sendsPrivateToRemote } = selectProvider(selection, involvesPrivate);
  if (sendsPrivateToRemote) await acknowledgeRemote(provider);
  const derived = useWiki.getState().derived;
  return {
    provider,
    prompts: derived?.prompts ?? {},
    variables: { wiki_title: derived?.config.title ?? "my wiki" },
    ...(signal ? { signal } : {}),
  };
}
