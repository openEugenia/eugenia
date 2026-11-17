/** `eugenia publish` : construit la partie publique et la pousse dans le dépôt public (§6.4). */
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { buildPublication } from "@openeugenia/core";
import { loadDiskWiki } from "../fs-source.ts";
import { githubRemote, pushSnapshot } from "../git.ts";
import { bold, CliError, green, red, reportProblems, type Logger } from "../output.ts";

export interface PublishOptions {
  dir: string;
  /** Dépôt public cible (`owner/name`). */
  target?: string;
  /** Adresse git explicite du dépôt cible (remplace celle déduite de `target`). */
  remote?: string;
  /** Dossier de sortie (sinon un dossier temporaire). */
  out?: string;
  branch: string;
  privateRepo?: string;
  /** Variable d'environnement contenant un jeton d'écriture (sinon SSH / clé de déploiement). */
  tokenEnv: string;
  dryRun: boolean;
  message?: string;
}

export async function publishCommand(options: PublishOptions, log: Logger): Promise<number> {
  if (options.target && !/^[\w.-]+\/[\w.-]+$/.test(options.target)) {
    throw new CliError("--target doit être de la forme owner/name.");
  }
  if (!options.target && !options.remote && !options.out) {
    throw new CliError(
      "Indiquez --target owner/name (ou --out <dossier> pour seulement construire).",
    );
  }
  const wiki = await loadDiskWiki(resolve(options.dir));
  const publication = await buildPublication(wiki.view, {
    ...(options.privateRepo ? { privateRepo: options.privateRepo } : {}),
    ...(options.target ? { publicRepo: options.target } : {}),
  });
  reportProblems(log, publication.problems);
  if (!publication.ok) {
    log.error(
      red("Publication refusée : corrigez les erreurs ci-dessus (aucun fichier n'a été publié)."),
    );
    return 1;
  }
  const s = publication.stats;
  log.info(
    `${s.pages} page(s) publique(s) dont ${s.flashcards} flashcard(s), ${s.summaries} description(s), ${s.attachments} fichier(s) joint(s), ${s.discussions} discussion(s).`,
  );

  const outDir = options.out
    ? resolve(options.out)
    : await mkdtemp(join(tmpdir(), "eugenia-publish-"));
  try {
    const existing = await readdir(outDir).catch(() => [] as string[]);
    if (options.out && existing.length > 0) {
      throw new CliError(`Le dossier de sortie ${outDir} n'est pas vide.`);
    }
    for (const file of publication.files) {
      const target = join(outDir, file.path);
      await mkdir(dirname(target), { recursive: true });
      if ("content" in file) await writeFile(target, file.content);
      else await copyFile(join(wiki.dir, file.copyFrom), target);
    }
    log.info(`Arborescence publique construite dans ${outDir}.`);

    if (options.target || options.remote) {
      const token = process.env[options.tokenEnv] || undefined;
      const remote = options.remote ?? githubRemote(options.target!, token);
      const date = new Date().toISOString().slice(0, 10);
      await pushSnapshot({
        dir: outDir,
        remote,
        branch: options.branch,
        message: options.message ?? `Publication du wiki — ${date}`,
        log,
        dryRun: options.dryRun,
        ...(token ? { secret: token } : {}),
      });
      log.info(
        bold(
          green(
            options.dryRun
              ? "Simulation terminée : rien n'a été poussé."
              : `Publié dans ${options.target ?? remote}.`,
          ),
        ),
      );
    }
  } finally {
    if (!options.out) await rm(outDir, { recursive: true, force: true });
  }
  return 0;
}
