/**
 * `eugenia index`: generates the missing or stale source indexes (§8.6). A large model (Mistral
 * Large by default) reads each source and describes it as a knowledge tree, written to
 * `_tree.json` next to its `index.md`.
 */
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  countKnowledgeNodes,
  librarySources,
  newSourceTreeDocument,
  serializeSourceTree,
  sourcesInBranch,
  sourceTreePath,
  sourceTreeState,
  type WikiNode,
} from "@openeugenia/core";
import {
  AIError,
  createProvider,
  DEFAULT_INDEX_MODEL,
  DEFAULT_MISTRAL_URL,
  indexSource,
  isLocalUrl,
  loadPromptOverrides,
  type AIProvider,
  type ProviderConfig,
} from "@openeugenia/ai";
import { loadDiskWiki, type DiskWiki } from "../fs-source.ts";
import { bold, CliError, dim, green, yellow, type Logger } from "../output.ts";
import { findBranch } from "./summarize.ts";

export interface IndexOptions {
  dir: string;
  /** Source, or category whose filed sources are indexed (all the library by default). */
  node?: string;
  /** Also regenerates current indexes. */
  force: boolean;
  dryRun: boolean;
  model?: string;
  baseUrl?: string;
  /** Refuses to send private content to a remote provider. */
  localOnlyPrivate: boolean;
  /** Injected provider (tests). */
  providerInstance?: AIProvider;
}

/** Mistral Large by default; any OpenAI-compatible server with --base-url. */
export function indexProviderFromEnvironment(
  options: Pick<IndexOptions, "model" | "baseUrl">,
): ProviderConfig {
  const env = process.env;
  const baseUrl = options.baseUrl ?? env.EUGENIA_INDEX_BASE_URL ?? DEFAULT_MISTRAL_URL;
  const apiKey = env.EUGENIA_INDEX_API_KEY ?? env.MISTRAL_API_KEY;
  if (!apiKey && !isLocalUrl(baseUrl)) {
    throw new CliError(
      "Missing API key: set MISTRAL_API_KEY (or EUGENIA_INDEX_API_KEY for another provider).",
    );
  }
  return {
    kind: "openai",
    baseUrl,
    model: options.model ?? env.EUGENIA_INDEX_MODEL ?? DEFAULT_INDEX_MODEL,
    label: baseUrl === DEFAULT_MISTRAL_URL ? "Mistral" : "Indexing model",
    ...(apiKey ? { apiKey } : {}),
  };
}

/** Sources of the branch: one source, or the sources filed in a category and below. */
function sourcesOf(wiki: DiskWiki, node: string | undefined): WikiNode[] {
  if (!node) return librarySources(wiki.tree).filter((s) => !s.virtual);
  const found = findBranch(wiki, node);
  if (found.type === "source") return [found];
  if (found.id === wiki.tree.libraryId) return librarySources(wiki.tree);
  return sourcesInBranch(wiki.tree, found.id);
}

export async function indexCommand(options: IndexOptions, log: Logger): Promise<number> {
  const wiki = await loadDiskWiki(resolve(options.dir));
  const provider =
    options.providerInstance ?? createProvider(indexProviderFromEnvironment(options));
  const { label, model, local } = provider.info;
  const prompts = await loadPromptOverrides(wiki.files.keys(), wiki.readText);
  const context = { provider, prompts, variables: { wiki_title: wiki.config.title } };

  const states = await Promise.all(
    sourcesOf(wiki, options.node).map((s) => sourceTreeState(wiki.view, s)),
  );
  let plan = states.filter((s) => options.force || s.status !== "current");
  const privateCount = plan.filter((s) => !s.node.isPublic).length;
  if (!local && privateCount > 0) {
    if (options.localOnlyPrivate) {
      plan = plan.filter((s) => s.node.isPublic);
      log.warn(
        yellow(
          `${privateCount} private source(s) skipped: remote provider (--local-only-private).`,
        ),
      );
    } else {
      log.warn(
        yellow(
          `The content of ${privateCount} private source(s) is going to be sent to ${label} (${model}).`,
        ),
      );
    }
  }
  const current = states.filter((s) => s.status === "current").length;
  log.info(
    bold(
      `${plan.length} source(s) to index with ${label} (${model}), ${current} index(es) current.`,
    ),
  );
  if (plan.length === 0) return 0;
  if (options.dryRun) {
    for (const s of plan) {
      const what = s.status === "missing" ? "new" : s.status === "current" ? "redo" : s.status;
      log.info(`  ${what} ${sourceTreePath(s.node)} ${dim(`(${s.text.length} characters)`)}`);
    }
    return 0;
  }

  let written = 0;
  for (const state of plan) {
    const { node } = state;
    log.info(`${bold(node.title)} ${dim(`(${state.text.length} characters)`)}`);
    let root;
    try {
      root = await indexSource(
        context,
        { title: node.title, text: state.text },
        {
          onProgress: (p) => {
            if (p.total > 1) {
              log.info(
                dim(p.assembling ? "  gathering the parts…" : `  part ${p.done}/${p.total}`),
              );
            }
          },
        },
      );
    } catch (error) {
      if (error instanceof AIError) throw new CliError(`"${node.title}": ${error.message}`);
      throw error;
    }
    const doc = newSourceTreeDocument({ model, textSha: state.textSha, root });
    const path = sourceTreePath(node);
    await writeFile(join(wiki.dir, path), serializeSourceTree(doc));
    written++;
    log.info(`  ${green("written")} ${path} ${dim(`(${countKnowledgeNodes(doc.root)} nodes)`)}`);
  }
  log.info(bold(`${written} index(es) written.`));
  log.info(
    dim("Review and commit them; `eugenia embed` then computes the embeddings of their sections."),
  );
  return 0;
}
