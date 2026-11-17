/**
 * Mise en place des dépôts GitHub avec la CLI `gh` (§6.4) : dépôt privé, dépôt public,
 * clé de déploiement en écriture sur le dépôt public, secret dans le dépôt privé.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEPLOY_KEY_SECRET } from "@openeugenia/core";
import { CliError, green, type Logger } from "./output.ts";
import { run } from "./process.ts";

export interface GithubRepos {
  privateRepo: string;
  publicRepo: string;
}

/** Nom des dépôts : valeurs données, sinon `<compte>/eugenia-wiki` et `<privé>-public`. */
export async function resolveRepos(options: {
  privateRepo?: string;
  publicRepo?: string;
  log: Logger;
}): Promise<GithubRepos> {
  const status = await run("gh", ["auth", "status"], { allowFailure: true });
  if (status.code !== 0) {
    throw new CliError(
      "La CLI GitHub n'est pas connectée : lancez `gh auth login` puis réessayez.",
    );
  }
  let privateRepo = options.privateRepo;
  if (!privateRepo) {
    const login = (await run("gh", ["api", "user", "--jq", ".login"])).stdout.trim();
    privateRepo = `${login}/eugenia-wiki`;
  }
  return { privateRepo, publicRepo: options.publicRepo ?? `${privateRepo}-public` };
}

async function repoExists(repo: string): Promise<{ exists: boolean; isPrivate?: boolean }> {
  const result = await run(
    "gh",
    ["repo", "view", repo, "--json", "isPrivate", "--jq", ".isPrivate"],
    {
      allowFailure: true,
    },
  );
  if (result.code !== 0) return { exists: false };
  return { exists: true, isPrivate: result.stdout.trim() === "true" };
}

export async function setupGithub(
  options: GithubRepos & { dir: string; branch: string; log: Logger; dryRun: boolean },
): Promise<void> {
  const { dir, log, dryRun, privateRepo, publicRepo, branch } = options;
  const exec = { log, dryRun };

  // 1. Dépôt privé (sans pousser : le secret doit exister avant le premier push).
  const existingPrivate = await repoExists(privateRepo);
  if (existingPrivate.exists && !existingPrivate.isPrivate) {
    throw new CliError(
      `Le dépôt ${privateRepo} est public : le dépôt source d'un wiki doit être privé.`,
    );
  }
  if (!existingPrivate.exists) {
    await run(
      "gh",
      ["repo", "create", privateRepo, "--private", "--description", "Mon wiki Eugenia (privé)"],
      exec,
    );
  }

  // 2. Dépôt public.
  const existingPublic = await repoExists(publicRepo);
  if (existingPublic.exists && existingPublic.isPrivate) {
    log.warn(`Attention : ${publicRepo} est privé ; il doit être public pour être lu par tous.`);
  }
  if (!existingPublic.exists) {
    await run(
      "gh",
      [
        "repo",
        "create",
        publicRepo,
        "--public",
        "--description",
        "Partie publique de mon wiki Eugenia (générée)",
      ],
      exec,
    );
  }

  // 3. Clé de déploiement en écriture sur le dépôt public, clé privée en secret du dépôt privé.
  const keyDir = await mkdtemp(join(tmpdir(), "eugenia-key-"));
  try {
    const key = join(keyDir, "deploy_key");
    await run(
      "ssh-keygen",
      ["-q", "-t", "ed25519", "-N", "", "-C", `eugenia-publish ${privateRepo}`, "-f", key],
      exec,
    );
    await run(
      "gh",
      [
        "repo",
        "deploy-key",
        "add",
        `${key}.pub`,
        "--repo",
        publicRepo,
        "--allow-write",
        "--title",
        `Eugenia — publication depuis ${privateRepo}`,
      ],
      exec,
    );
    const privateKey = dryRun ? "" : await readFile(key, "utf8");
    await run("gh", ["secret", "set", DEPLOY_KEY_SECRET, "--repo", privateRepo], {
      ...exec,
      input: privateKey,
    });
  } finally {
    await rm(keyDir, { recursive: true, force: true });
  }

  // 4. Dépôt local : commit initial et premier push (qui déclenche la publication).
  const inside = await run("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: dir,
    allowFailure: true,
  });
  if (inside.code !== 0) await run("git", ["init", "-q", "-b", branch], { cwd: dir, ...exec });
  await run("git", ["add", "-A"], { cwd: dir, ...exec });
  const staged = await run("git", ["diff", "--cached", "--quiet"], {
    cwd: dir,
    allowFailure: true,
  });
  if (staged.code !== 0 || dryRun) {
    await run("git", ["commit", "-q", "-m", "Initialisation du wiki Eugenia"], {
      cwd: dir,
      ...exec,
    });
  }
  const remote = await run("git", ["remote", "get-url", "origin"], {
    cwd: dir,
    allowFailure: true,
  });
  if (remote.code !== 0) {
    // Même protocole que la CLI gh (HTTPS par défaut, avec son assistant d'identification).
    const protocol = (
      await run("gh", ["config", "get", "git_protocol"], { allowFailure: true })
    ).stdout.trim();
    const url =
      protocol === "ssh"
        ? `git@github.com:${privateRepo}.git`
        : `https://github.com/${privateRepo}.git`;
    await run("git", ["remote", "add", "origin", url], {
      cwd: dir,
      ...exec,
    });
  }
  await run("git", ["push", "-u", "origin", branch], { cwd: dir, ...exec });
  log.info(green(`Dépôts prêts : ${privateRepo} (privé) → ${publicRepo} (public).`));
}
