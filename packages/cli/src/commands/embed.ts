/**
 * `eugenia embed`: computes the missing or stale embeddings, for the app's search by meaning
 * across the common hierarchy: pages (`_embedding.json` next to each `index.md`), discussions
 * (`<discussions>/_embeddings/`) and the sections of the source indexes
 * (`_tree.embeddings.json`). They are never published.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  buildHierarchy,
  descendants,
  discussionInBranch,
  embeddingChanges,
  isInBranch,
  vectorItems,
  type WikiNode,
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
  // Without --node: the whole wiki, the whole library and the discussions.
  const tree = wiki.tree;
  const hierarchy = buildHierarchy(
    tree,
    [...wiki.discussions].map(([path, meta]) => ({ path, meta })),
  );
  const branch = options.node ? findBranch(wiki, options.node) : undefined;
  const pages: WikiNode[] = branch
    ? [
        branch,
        ...descendants(tree, branch.id),
        // Sources filed in the branch (common hierarchy).
        ...[...tree.nodes.values()].filter(
          (n) => n.type === "source" && n.id !== branch.id && isInBranch(tree, branch.id, n),
        ),
      ]
    : [...tree.nodes.values()];
  const discussions = [...wiki.discussions]
    .filter(([path]) => !branch || discussionInBranch(tree, hierarchy, branch.id, path))
    .map(([path, meta]) => ({ path, meta }));
  const items = await vectorItems(wiki.view, model, { nodes: pages, discussions });
  let plan = items.filter((e) => options.force || e.status !== "current");
  const privateCount = plan.filter((e) => !e.isPublic).length;
  if (!local && privateCount > 0) {
    if (options.localOnlyPrivate) {
      plan = plan.filter((e) => e.isPublic);
      log.warn(
        yellow(
          `${privateCount} private element(s) skipped: remote provider (--local-only-private).`,
        ),
      );
    } else {
      log.warn(
        yellow(
          `The content of ${privateCount} private element(s) is going to be sent to ${label} (${model}).`,
        ),
      );
    }
  }
  const current = items.filter((e) => e.status === "current").length;
  const count = (kind: string): number => plan.filter((e) => e.kind === kind).length;
  log.info(
    bold(
      `${plan.length} embedding(s) to compute with ${label} (${model}): ${count("page")} page(s), ${count("discussion")} discussion(s), ${count("section")} section(s) of source indexes; ${current} current.`,
    ),
  );
  if (plan.length === 0) return 0;
  if (options.dryRun) {
    for (const e of plan) {
      const what = e.kind === "section" ? `${e.file} [${e.sectionKey}]` : e.file;
      log.info(`  ${e.status === "missing" ? "new" : "redo"} ${what}`);
    }
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
  const computed = new Map(plan.map((e, i) => [e.id, vectors[i]!]));
  const changes = embeddingChanges(items, computed, model);
  for (const change of changes) {
    if (change.op !== "write") continue;
    await mkdir(dirname(join(wiki.dir, change.path)), { recursive: true });
    await writeFile(join(wiki.dir, change.path), change.content);
    log.info(`  ${green("written")} ${change.path}`);
  }
  log.info(bold(`${plan.length} embedding(s) written in ${changes.length} file(s).`));
  log.info(dim("Commit them: the app's search by meaning uses them."));
  return 0;
}
