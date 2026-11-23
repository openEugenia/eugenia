/**
 * Sets up the GitHub repositories with the `gh` CLI (§6.4): private repository, public
 * repository, deploy key with write access to the public repository, secret in the private one.
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

/** Names of the repositories: given values, otherwise `<account>/eugenia-wiki` and `<private>-public`. */
export async function resolveRepos(options: {
  privateRepo?: string;
  publicRepo?: string;
  log: Logger;
}): Promise<GithubRepos> {
  const status = await run("gh", ["auth", "status"], { allowFailure: true });
  if (status.code !== 0) {
    throw new CliError("The GitHub CLI is not logged in: run `gh auth login` and try again.");
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

  // 1. Private repository (without pushing: the secret must exist before the first push).
  const existingPrivate = await repoExists(privateRepo);
  if (existingPrivate.exists && !existingPrivate.isPrivate) {
    throw new CliError(
      `The repository ${privateRepo} is public: the source repository of a wiki must be private.`,
    );
  }
  if (!existingPrivate.exists) {
    await run(
      "gh",
      ["repo", "create", privateRepo, "--private", "--description", "My Eugenia wiki (private)"],
      exec,
    );
  }

  // 2. Public repository.
  const existingPublic = await repoExists(publicRepo);
  if (existingPublic.exists && existingPublic.isPrivate) {
    log.warn(`Warning: ${publicRepo} is private; it must be public to be readable by everyone.`);
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
        "Public part of my Eugenia wiki (generated)",
      ],
      exec,
    );
  }

  // 3. Deploy key with write access to the public repository, private key as a secret of the
  // private repository.
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
        `Eugenia — publication from ${privateRepo}`,
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

  // 4. Local repository: initial commit and first push (which triggers the publication).
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
    await run("git", ["commit", "-q", "-m", "Initialize the Eugenia wiki"], {
      cwd: dir,
      ...exec,
    });
  }
  const remote = await run("git", ["remote", "get-url", "origin"], {
    cwd: dir,
    allowFailure: true,
  });
  if (remote.code !== 0) {
    // Same protocol as the gh CLI (HTTPS by default, with its credential helper).
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
  log.info(green(`Repositories ready: ${privateRepo} (private) → ${publicRepo} (public).`));
}
