/**
 * `eugenia embed` : calcule les embeddings manquants ou périmés des pages, pour la recherche
 * sémantique de l'application (`_embedding.json` à côté de chaque `index.md`, jamais publié).
 */
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  descendants,
  embeddingEntries,
  embeddingPath,
  newEmbeddingDocument,
  serializeEmbedding,
} from "@openeugenia/core";
import {
  AIError,
  createProvider,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_MISTRAL_URL,
  embedTexts,
  isLocalUrl,
  type AIProvider,
  type ProviderConfig,
} from "@openeugenia/ai";
import { loadDiskWiki } from "../fs-source.ts";
import { bold, CliError, dim, green, yellow, type Logger } from "../output.ts";
import { findBranch } from "./summarize.ts";

export interface EmbedOptions {
  dir: string;
  /** Identifiant ou dossier du nœud dont on traite la branche (racine par défaut). */
  node?: string;
  /** Recalcule aussi les embeddings à jour. */
  force: boolean;
  dryRun: boolean;
  model?: string;
  baseUrl?: string;
  /** Refuse d'envoyer du contenu privé à un fournisseur distant. */
  localOnlyPrivate: boolean;
  /** Fournisseur injecté (tests). */
  providerInstance?: AIProvider;
}

/** Mistral par défaut ; tout serveur compatible OpenAI (dont Ollama) avec --base-url. */
export function embeddingProviderFromEnvironment(
  options: Pick<EmbedOptions, "model" | "baseUrl">,
): ProviderConfig {
  const env = process.env;
  const baseUrl = options.baseUrl ?? env.EUGENIA_EMBED_BASE_URL ?? DEFAULT_MISTRAL_URL;
  const apiKey = env.EUGENIA_EMBED_API_KEY ?? env.MISTRAL_API_KEY;
  if (!apiKey && !isLocalUrl(baseUrl)) {
    throw new CliError(
      "Clé d'API manquante : définissez MISTRAL_API_KEY (ou EUGENIA_EMBED_API_KEY pour un autre fournisseur).",
    );
  }
  return {
    kind: "openai",
    baseUrl,
    model: options.model ?? env.EUGENIA_EMBED_MODEL ?? DEFAULT_EMBEDDING_MODEL,
    ...(apiKey ? { apiKey } : {}),
  };
}

export async function embedCommand(options: EmbedOptions, log: Logger): Promise<number> {
  const wiki = await loadDiskWiki(resolve(options.dir));
  const provider =
    options.providerInstance ?? createProvider(embeddingProviderFromEnvironment(options));
  const { label, model, local } = provider.info;
  const branch = findBranch(wiki, options.node);
  const entries = await embeddingEntries(wiki.view, model, [
    branch,
    ...descendants(wiki.tree, branch.id),
  ]);
  let plan = entries.filter((e) => options.force || e.status !== "current");
  const privateCount = plan.filter((e) => !e.node.isPublic).length;
  if (!local && privateCount > 0) {
    if (options.localOnlyPrivate) {
      plan = plan.filter((e) => e.node.isPublic);
      log.warn(
        yellow(
          `${privateCount} page(s) privée(s) ignorée(s) : fournisseur distant (--local-only-private).`,
        ),
      );
    } else {
      log.warn(
        yellow(
          `Le contenu de ${privateCount} page(s) privée(s) va être envoyé à ${label} (${model}).`,
        ),
      );
    }
  }
  const current = entries.filter((e) => e.status === "current").length;
  log.info(
    bold(`${plan.length} embedding(s) à calculer avec ${label} (${model}), ${current} à jour.`),
  );
  if (plan.length === 0) return 0;
  if (options.dryRun) {
    for (const e of plan)
      log.info(`  ${e.status === "missing" ? "nouveau" : "à refaire"} ${embeddingPath(e.node)}`);
    return 0;
  }

  let vectors: number[][];
  try {
    vectors = await embedTexts(
      provider,
      plan.map((e) => e.text),
      { onProgress: (done, total) => log.info(dim(`  ${done}/${total}`)) },
    );
  } catch (error) {
    if (error instanceof AIError) throw new CliError(error.message);
    throw error;
  }
  for (const [i, entry] of plan.entries()) {
    const path = embeddingPath(entry.node);
    const doc = newEmbeddingDocument({ model, textSha: entry.textSha, vector: vectors[i]! });
    await writeFile(join(wiki.dir, path), serializeEmbedding(doc));
    log.info(`  ${green("écrit")} ${path}`);
  }
  log.info(bold(`${plan.length} embedding(s) écrit(s).`));
  log.info(dim("Commitez-les : la recherche sémantique de l'application les utilise."));
  return 0;
}
