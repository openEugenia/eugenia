/** `eugenia init` : crée un nouveau wiki, et éventuellement ses dépôts GitHub. */
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
      `Un wiki existe déjà dans ${dir} (${CONFIG_PATH}). Utilisez --force pour l'écraser.`,
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
    title: options.title ?? "Mon wiki",
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
      log.warn(`  ${dim("ignoré")} ${path} (existe déjà)`);
      continue;
    }
    if (!options.dryRun) {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content);
    }
    log.info(`  ${green("créé")} ${path}`);
    written++;
  }
  log.info(bold(`Wiki initialisé dans ${dir} (${written} fichier(s)).`));

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
      `Ouvrez votre wiki : ${cyan(`https://openeugenia.github.io/eugenia/?repo=${privateRepo}`)}`,
    );
  } else {
    log.info(
      [
        "",
        "Étapes suivantes :",
        "  1. Créez un dépôt GitHub **privé** et poussez-y ce dossier.",
        "  2. Ouvrez https://openeugenia.github.io/eugenia/?repo=<compte>/<dépôt> et saisissez un jeton",
        "     fine-grained (lecture/écriture sur ce seul dépôt) dans les paramètres.",
        "  3. Pour publier la partie publique : relancez avec --github (crée les dépôts, la clé de",
        "     déploiement et le secret avec la CLI gh), ou suivez docs/publication.md.",
      ].join("\n"),
    );
  }
  return 0;
}
