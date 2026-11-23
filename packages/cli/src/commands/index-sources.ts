/**
 * `eugenia index`: generates the missing or stale source indexes (§8.6). A Mistral model (a
 * preset, from Ministral to Mistral Large, with or without reasoning) reads each source and
 * describes it as a knowledge tree, with the knowledge worth extracting, written like the wiki
 * in the `_index/` folder of the source (one `index.md` per node).
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  countIndexNodes,
  extractionChanges,
  indexKnowledge,
  newCandidates,
  librarySources,
  readSourceIndex,
  sourceIndexChanges,
  sourceIndexDir,
  sourceIndexState,
  sourcesInBranch,
  type FileChange,
  type RepoFile,
  type WikiNode,
} from "@openeugenia/core";
import {
  AIError,
  createProvider,
  DEFAULT_INDEX_PRESET,
  DEFAULT_MISTRAL_URL,
  indexExtractionPlan,
  indexPreset,
  indexSource,
  INDEX_MODEL_PRESETS,
  isLocalUrl,
  loadPromptOverrides,
  type AIProvider,
  type ProviderConfig,
  type ReasoningEffort,
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
  /** Also adds the knowledge proposed by the indexes to the wiki, filed by the model. */
  extract?: boolean;
  /** Preset (model and reasoning), `small` by default. */
  preset?: string;
  model?: string;
  reasoning?: ReasoningEffort;
  baseUrl?: string;
  /** Refuses to send private content to a remote provider. */
  localOnlyPrivate: boolean;
  /** Injected provider (tests). */
  providerInstance?: AIProvider;
}

/** A preset of Mistral models by default; any OpenAI-compatible server with --base-url. */
export function indexProviderFromEnvironment(
  options: Pick<IndexOptions, "model" | "baseUrl" | "preset" | "reasoning">,
): ProviderConfig {
  const env = process.env;
  const presetId = options.preset ?? env.EUGENIA_INDEX_PRESET ?? DEFAULT_INDEX_PRESET;
  const preset = indexPreset(presetId);
  if (!preset) {
    throw new CliError(
      `Unknown preset: ${presetId} (${INDEX_MODEL_PRESETS.map((p) => p.id).join(", ")}).`,
      2,
    );
  }
  const model = options.model ?? env.EUGENIA_INDEX_MODEL ?? preset.model;
  // The reasoning of a preset only applies to its own model.
  const reasoning =
    options.reasoning ?? (model === preset.model ? preset.reasoningEffort : undefined);
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
    model,
    label: baseUrl === DEFAULT_MISTRAL_URL ? "Mistral" : "Indexing model",
    ...(apiKey ? { apiKey } : {}),
    ...(reasoning ? { reasoningEffort: reasoning } : {}),
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
    sourcesOf(wiki, options.node).map((s) => sourceIndexState(wiki.view, s)),
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
      log.info(`  ${what} ${sourceIndexDir(s.node)}/ ${dim(`(${s.text.length} characters)`)}`);
    }
    return 0;
  }

  let files = new Map<string, RepoFile>(wiki.files);
  const readText = (path: string): Promise<string> => readFile(join(wiki.dir, path), "utf8");
  const apply = async (changes: readonly FileChange[]): Promise<void> => {
    for (const change of changes) {
      const target = join(wiki.dir, change.path);
      if (change.op === "write") {
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, change.content);
        files.set(change.path, { path: change.path, sha: "" });
      } else if (change.op === "delete") {
        await rm(target, { force: true });
        files.delete(change.path);
      }
    }
  };
  let written = 0;
  let extracted = 0;
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
    const changes = sourceIndexChanges({ config: wiki.config, files }, node, {
      model,
      textSha: state.textSha,
      root,
    });
    await apply(changes);
    // The index as the app will read it.
    const doc = await readSourceIndex({ files, readText }, node);
    written++;
    log.info(
      `  ${green("written")} ${sourceIndexDir(node)}/ ${dim(
        `(${countIndexNodes(doc!.root)} nodes, ${indexKnowledge(doc!.root).length} knowledge item(s) to extract)`,
      )}`,
    );
    if (options.extract) {
      // The knowledge proposed by the index, filed by the model: the wiki is read again first.
      const current = await loadDiskWiki(wiki.dir);
      files = new Map(current.files);
      const source = current.tree.nodes.get(node.id)!;
      const candidates = newCandidates(
        current.tree,
        node.id,
        indexKnowledge(doc!.root).map((k) => k.candidate),
      );
      if (candidates.length > 0) {
        try {
          // The categories of the wiki are sent to the model: not to a remote one with
          // --local-only-private (everything then goes to the category of the source).
          const filing =
            !local && options.localOnlyPrivate
              ? {
                  sourceId: source.id,
                  knowledge: candidates.map((c) => ({
                    ...c,
                    category: source.filedIn ?? current.tree.rootId,
                  })),
                  categorized: false,
                }
              : await indexExtractionPlan(
                  context,
                  current.view,
                  source,
                  candidates,
                  doc!.root.description,
                );
          const result = await extractionChanges(current.view, filing);
          await apply(result.changes);
          files = new Map((await loadDiskWiki(wiki.dir)).files);
          extracted += result.knowledge.length;
          log.info(
            `  ${green("added")} ${result.knowledge.length} knowledge item(s)${
              result.categories.length
                ? `, in ${result.categories.length} new category(ies): ${result.categories.map((c) => c.title).join(", ")}`
                : ""
            }${filing.categorized ? "" : dim(" (in the category of the source)")}`,
          );
        } catch (error) {
          if (error instanceof AIError) throw new CliError(`"${node.title}": ${error.message}`);
          throw error;
        }
      }
    }
  }
  log.info(
    bold(
      `${written} index(es) written${options.extract ? `, ${extracted} knowledge item(s) added` : ""}.`,
    ),
  );
  log.info(
    dim("Review and commit them; `eugenia embed` then computes the embeddings of their sections."),
  );
  return 0;
}
