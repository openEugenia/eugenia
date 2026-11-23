/**
 * `eugenia embed`: computes the missing or stale page embeddings, for the app's semantic search
 * (`_embedding.json` next to each `index.md`, never published).
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
  /** Identifier or folder of the node whose branch is processed (root by default). */
  node?: string;
  /** Also recomputes current embeddings. */
  force: boolean;
  dryRun: boolean;
  model?: string;
  baseUrl?: string;
  /** Refuses to send private content to a remote provider. */
  localOnlyPrivate: boolean;
  /** Injected provider (tests). */
  providerInstance?: AIProvider;
}

/** Mistral by default; any OpenAI-compatible server (including Ollama) with --base-url. */
export function embeddingProviderFromEnvironment(
  options: Pick<EmbedOptions, "model" | "baseUrl">,
): ProviderConfig {
  const env = process.env;
  const baseUrl = options.baseUrl ?? env.EUGENIA_EMBED_BASE_URL ?? DEFAULT_MISTRAL_URL;
  const apiKey = env.EUGENIA_EMBED_API_KEY ?? env.MISTRAL_API_KEY;
  if (!apiKey && !isLocalUrl(baseUrl)) {
    throw new CliError(
      "Missing API key: set MISTRAL_API_KEY (or EUGENIA_EMBED_API_KEY for another provider).",
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
  // Without --node: the whole wiki and the whole library.
  const roots = options.node
    ? [findBranch(wiki, options.node)]
    : [wiki.tree.rootId, wiki.tree.libraryId].map((id) => wiki.tree.nodes.get(id)!);
  const entries = await embeddingEntries(
    wiki.view,
    model,
    roots.flatMap((root) => [root, ...descendants(wiki.tree, root.id)]),
  );
  let plan = entries.filter((e) => options.force || e.status !== "current");
  const privateCount = plan.filter((e) => !e.node.isPublic).length;
  if (!local && privateCount > 0) {
    if (options.localOnlyPrivate) {
      plan = plan.filter((e) => e.node.isPublic);
      log.warn(
        yellow(`${privateCount} private page(s) skipped: remote provider (--local-only-private).`),
      );
    } else {
      log.warn(
        yellow(
          `The content of ${privateCount} private page(s) is going to be sent to ${label} (${model}).`,
        ),
      );
    }
  }
  const current = entries.filter((e) => e.status === "current").length;
  log.info(
    bold(`${plan.length} embedding(s) to compute with ${label} (${model}), ${current} current.`),
  );
  if (plan.length === 0) return 0;
  if (options.dryRun) {
    for (const e of plan)
      log.info(`  ${e.status === "missing" ? "new" : "redo"} ${embeddingPath(e.node)}`);
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
    log.info(`  ${green("written")} ${path}`);
  }
  log.info(bold(`${plan.length} embedding(s) written.`));
  log.info(dim("Commit them: the app's semantic search uses them."));
  return 0;
}
