/** Chargement d'un wiki complet à partir d'une liste de fichiers et d'un lecteur. */
import { CONFIG_PATH, parseConfig, type WikiConfig } from "./config.ts";
import {
  discussionMeta,
  parseDiscussion,
  quizEvents,
  type DiscussionMeta,
  type QuizEvent,
} from "./discussion.ts";
import { pageMeta } from "./pages.ts";
import { basename, dirname, isReservedName, segmentsUnder } from "./paths.ts";
import { parseSummary, type SummaryDocument } from "./summaries.ts";
import {
  buildTree,
  isDiscussionPath,
  spaceOf,
  spaceRootPath,
  type PageMeta,
  type WikiTree,
} from "./tree.ts";
import type { RepoFile, TextReader } from "./types.ts";

export interface WikiSource {
  files: Iterable<RepoFile>;
  readText: TextReader;
}

export interface LoadedWiki {
  config: WikiConfig;
  configProblems: string[];
  files: Map<string, RepoFile>;
  metas: Map<string, PageMeta>;
  tree: WikiTree;
  /** Descriptions lues, indexées par chemin. */
  summaries: Map<string, SummaryDocument>;
  /** Métadonnées des discussions, indexées par chemin. */
  discussions: Map<string, DiscussionMeta>;
  /** Évaluations de tous les quiz du dépôt. */
  quizEvents: QuizEvent[];
}

export interface LoadOptions {
  summaries?: boolean;
  /** Lire les discussions (nécessaire à la maîtrise, qui rejoue les quiz). */
  discussions?: boolean;
}

/** Chemins des `index.md` de pages (wiki et bibliothèque, hors dossiers réservés). */
export function pageIndexPaths(config: WikiConfig, paths: Iterable<string>): string[] {
  const out: string[] = [];
  for (const path of paths) {
    if (basename(path) !== "index.md") continue;
    const dir = dirname(path);
    const space = spaceOf(config, dir);
    if (!space) continue;
    const segments = segmentsUnder(spaceRootPath(config, space), dir);
    if (segments && !segments.some(isReservedName)) out.push(path);
  }
  return out;
}

/** Fichiers à lire pour charger un wiki (pages, descriptions, discussions). */
export function filesToLoad(
  config: WikiConfig,
  paths: Iterable<string>,
  options: LoadOptions = {},
): string[] {
  const all = [...paths];
  const out = pageIndexPaths(config, all);
  for (const path of all) {
    if (options.discussions !== false && isDiscussionPath(config, path)) {
      out.push(path);
      continue;
    }
    const name = basename(path);
    if (
      options.summaries !== false &&
      (name === "_summary.md" || name === "_summary.public.md") &&
      spaceOf(config, path) === "wiki"
    ) {
      out.push(path);
    }
  }
  return out;
}

export async function loadWiki(source: WikiSource, options: LoadOptions = {}): Promise<LoadedWiki> {
  const files = new Map<string, RepoFile>();
  for (const file of source.files) files.set(file.path, file);
  const { config, problems: configProblems } = parseConfig(
    files.has(CONFIG_PATH) ? await source.readText(CONFIG_PATH) : undefined,
  );

  const metas = new Map<string, PageMeta>();
  await Promise.all(
    pageIndexPaths(config, files.keys()).map(async (path) => {
      metas.set(path, pageMeta(await source.readText(path)));
    }),
  );
  const tree = buildTree({ config, files: files.values(), metas });

  const summaries = new Map<string, SummaryDocument>();
  const discussions = new Map<string, DiscussionMeta>();
  const events: QuizEvent[] = [];
  const reads: Promise<void>[] = [];
  if (options.summaries !== false) {
    for (const node of tree.nodes.values()) {
      for (const file of [node.summaries.private, node.summaries.public]) {
        if (!file) continue;
        reads.push(
          source.readText(file.path).then((text) => {
            summaries.set(file.path, parseSummary(text));
          }),
        );
      }
    }
  }
  if (options.discussions !== false) {
    for (const file of tree.discussions) {
      reads.push(
        source.readText(file.path).then((text) => {
          discussions.set(file.path, discussionMeta(text));
          events.push(...quizEvents(parseDiscussion(text), file.path));
        }),
      );
    }
  }
  await Promise.all(reads);
  return { config, configProblems, files, metas, tree, summaries, discussions, quizEvents: events };
}
