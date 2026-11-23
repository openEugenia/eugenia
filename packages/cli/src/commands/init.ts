/** `eugenia init`: creates a new wiki, and optionally its GitHub repositories. */
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { CONFIG_PATH, DEFAULT_CATEGORIES, scaffoldWiki } from "@openeugenia/core";
import { resolveRepos, setupGithub } from "../github-setup.ts";
import { bold, CliError, cyan, dim, green, type Logger } from "../output.ts";

export interface InitOptions {
  dir: string;
  title?: string;
  root?: string;
  categories: boolean;
  privateRepo?: string;
  publicRepo?: string;
  github: boolean;
  force: boolean;
  dryRun: boolean;
  actionRef?: string;
  branch: string;
}

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

export async function initCommand(options: InitOptions, log: Logger): Promise<number> {
  const dir = resolve(options.dir);
  if ((await exists(join(dir, CONFIG_PATH))) && !options.force) {
    throw new CliError(
      `A wiki already exists in ${dir} (${CONFIG_PATH}). Use --force to overwrite it.`,
    );
  }
  let privateRepo = options.privateRepo;
  let publicRepo = options.publicRepo;
  if (options.github) {
    const repos = await resolveRepos({
      ...(privateRepo ? { privateRepo } : {}),
      ...(publicRepo ? { publicRepo } : {}),
      log,
    });
    privateRepo = repos.privateRepo;
    publicRepo = repos.publicRepo;
  }

  const files = scaffoldWiki({
    title: options.title ?? "My wiki",
    ...(options.root !== undefined ? { root: options.root } : {}),
    categories: options.categories ? DEFAULT_CATEGORIES : [],
    ...(privateRepo ? { privateRepo } : {}),
    ...(publicRepo ? { publicRepo } : {}),
    ...(options.actionRef ? { actionRef: options.actionRef } : {}),
    branch: options.branch,
  });
  let written = 0;
  for (const [path, content] of files) {
    const target = join(dir, path);
    if ((await exists(target)) && !options.force) {
      log.warn(`  ${dim("skipped")} ${path} (already exists)`);
      continue;
    }
    if (!options.dryRun) {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    }
    log.info(`  ${green("created")} ${path}`);
    written++;
  }
  log.info(bold(`Wiki initialized in ${dir} (${written} file(s)).`));

  if (options.github && privateRepo && publicRepo) {
    await setupGithub({
      dir,
      privateRepo,
      publicRepo,
      branch: options.branch,
      log,
      dryRun: options.dryRun,
    });
    log.info(
      `Open your wiki: ${cyan(`https://openeugenia.github.io/eugenia/?repo=${privateRepo}`)}`,
    );
  } else {
    log.info(
      [
        "",
        "Next steps:",
        "  1. Create a **private** GitHub repository and push this folder to it.",
        "  2. Open https://openeugenia.github.io/eugenia/?repo=<account>/<repository> and enter a",
        "     fine-grained token (read/write on this repository only) in the settings.",
        "  3. To publish the public part: run again with --github (creates the repositories, the",
        "     deploy key and the secret with the gh CLI), or follow docs/publication.md.",
      ].join("\n"),
    );
  }
  return 0;
}
