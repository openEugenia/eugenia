/**
 * Accès à Eugenia depuis l'application : choix du fournisseur selon les paramètres et
 * la règle « IA locale pour le privé » (§11.1), avertissement avant le premier envoi de
 * contenu privé à un fournisseur distant.
 */
import type { AIProvider, TaskContext } from "@openeugenia/ai";
import { useSettings } from "../store/settings.ts";
import { confirmDialog } from "../store/ui.ts";
import { useWiki } from "../store/wiki.ts";
import { hasAI } from "./settings.ts";

/** Pose (une fois) la question de l'IA locale pour les nœuds privés. */
export async function ensurePrivacyChoice(): Promise<void> {
  const { settings, update } = useSettings.getState();
  if (settings.ai.localOnlyForPrivate !== null) return;
  const localOnly = await confirmDialog({
    title: "Connaissances privées et IA",
    body: "Souhaitez-vous réserver le traitement de vos connaissances privées à une IA locale (par exemple Ollama, sur votre ordinateur) ? Si oui, aucune donnée privée ne sera envoyée à un fournisseur distant ; les actions sur des nœuds privés seront bloquées tant qu'aucune IA locale n'est configurée. Vous pourrez changer d'avis dans les paramètres.",
    confirmLabel: "Oui, IA locale pour le privé",
    cancelLabel: "Non, utiliser mon fournisseur",
  });
  await update((s) => ({ ...s, ai: { ...s.ai, localOnlyForPrivate: localOnly } }));
}

/** Avertit (une fois) avant le premier envoi de contenu privé à un fournisseur distant. */
async function acknowledgeRemote(provider: AIProvider): Promise<void> {
  if (useSettings.getState().settings.ai.remoteWarningAcknowledged) return;
  const { AIError } = await import("@openeugenia/ai");
  const accepted = await confirmDialog({
    title: "Envoi de contenu privé",
    body: `Cette action envoie des connaissances privées à ${provider.info.label} (${provider.info.model}). Elles quittent alors votre appareil pour être traitées par ce fournisseur. Cet avertissement ne s'affiche qu'une fois ; vous pouvez réserver le privé à une IA locale dans les paramètres.`,
    confirmLabel: "J'ai compris, envoyer",
  });
  if (!accepted) throw new AIError("aborted", "Envoi annulé.");
  await useSettings
    .getState()
    .update((s) => ({ ...s, ai: { ...s.ai, remoteWarningAcknowledged: true } }));
}

export interface EmbeddingAccess {
  provider: AIProvider;
  /** Les pages privées peuvent être envoyées à ce fournisseur. */
  allowsPrivate: boolean;
}

/**
 * Fournisseur d'embeddings (recherche sémantique). Si le privé est réservé à une IA locale et
 * que ce fournisseur est distant, seules les pages publiques lui sont envoyées. Avec
 * `sendsPrivate`, l'avertissement d'envoi de contenu privé est affiché la première fois.
 */
export async function embeddingAccess(sendsPrivate = false): Promise<EmbeddingAccess> {
  const { AIError, createProvider } = await import("@openeugenia/ai");
  const config = useSettings.getState().settings.ai.embeddings;
  if (!config?.model) {
    throw new AIError(
      "config",
      "La recherche sémantique n'est pas configurée : ajoutez une clé Mistral dans les paramètres.",
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
 * Contexte d'une tâche d'Eugenia. `involvesPrivate` indique si des nœuds privés
 * seront envoyés au modèle.
 */
export async function taskContext(
  involvesPrivate: boolean,
  signal?: AbortSignal,
): Promise<TaskContext> {
  // Le module d'IA (SDK compris) n'est chargé qu'au premier usage d'Eugenia.
  const { AIError, createProvider, selectProvider } = await import("@openeugenia/ai");
  const settingsState = useSettings.getState();
  if (!hasAI(settingsState.settings)) {
    throw new AIError(
      "config",
      "Aucun fournisseur d'IA n'est configuré : ajoutez-en un dans les paramètres.",
    );
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
    variables: { wiki_title: derived?.config.title ?? "mon wiki" },
    ...(signal ? { signal } : {}),
  };
}
