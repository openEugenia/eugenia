/** `eugenia publish`: builds the public part and pushes it to the public repository (§6.4). */
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { buildPublication } from "@openeugenia/core";
import { loadDiskWiki } from "../fs-source.ts";
import { githubRemote, pushSnapshot } from "../git.ts";
import { bold, CliError, green, red, reportProblems, type Logger } from "../output.ts";

export interface PublishOptions {
  dir: string;
  /** Target public repository (`owner/name`). */
  target?: string;
  /** Explicit git URL of the target repository (replaces the one deduced from `target`). */
  remote?: string;
  /** Output folder (otherwise a temporary folder). */
  out?: string;
  branch: string;
  privateRepo?: string;
  /** Environment variable holding a write token (otherwise SSH / deploy key). */
  tokenEnv: string;
  dryRun: boolean;
  message?: string;
}

export async function publishCommand(options: PublishOptions, log: Logger): Promise<number> {
  if (options.target && !/^[\w.-]+\/[\w.-]+$/.test(options.target)) {
    throw new CliError("--target must have the form owner/name.");
  }
  if (!options.target && !options.remote && !options.out) {
    throw new CliError("Give --target owner/name (or --out <folder> to only build).");
  }
  const wiki = await loadDiskWiki(resolve(options.dir));
  const publication = await buildPublication(wiki.view, {
    ...(options.privateRepo ? { privateRepo: options.privateRepo } : {}),
    ...(options.target ? { publicRepo: options.target } : {}),
  });
  reportProblems(log, publication.problems);
  if (!publication.ok) {
    log.error(red("Publication refused: fix the errors above (no file was published)."));
    return 1;
  }
  const s = publication.stats;
  log.info(
    `${s.pages} public page(s): ${s.knowledge} knowledge item(s), ${s.flashcards} flashcard(s), ${s.sources} source(s); ${s.records} private source(s) as bibliographic records only; ${s.summaries} description(s), ${s.attachments} attached file(s), ${s.discussions} discussion(s).`,
  );

  const outDir = options.out
    ? resolve(options.out)
    : await mkdtemp(join(tmpdir(), "eugenia-publish-"));
  try {
    const existing = await readdir(outDir).catch(() => [] as string[]);
    if (options.out && existing.length > 0) {
      throw new CliError(`The output folder ${outDir} is not empty.`);
    }
    for (const file of publication.files) {
      const target = join(outDir, file.path);
      await mkdir(dirname(target), { recursive: true });
      if ("content" in file) await writeFile(target, file.content);
      else await copyFile(join(wiki.dir, file.copyFrom), target);
    }
    log.info(`Public tree built in ${outDir}.`);

    if (options.target || options.remote) {
      const token = process.env[options.tokenEnv] || undefined;
      const remote = options.remote ?? githubRemote(options.target!, token);
      const date = new Date().toISOString().slice(0, 10);
      await pushSnapshot({
        dir: outDir,
        remote,
        branch: options.branch,
        message: options.message ?? `Wiki publication — ${date}`,
        log,
        dryRun: options.dryRun,
        ...(token ? { secret: token } : {}),
      });
      log.info(
        bold(
          green(
            options.dryRun
              ? "Dry run complete: nothing was pushed."
              : `Published to ${options.target ?? remote}.`,
          ),
        ),
      );
    }
  } finally {
    if (!options.out) await rm(outDir, { recursive: true, force: true });
  }
  return 0;
}
