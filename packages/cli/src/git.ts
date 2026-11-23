/** Publication through git: a single commit, history of the public repository rewritten (§6.4). */
import type { Logger } from "./output.ts";
import { run } from "./process.ts";

export function githubRemote(target: string, token?: string): string {
  return token
    ? `https://x-access-token:${token}@github.com/${target}.git`
    : `git@github.com:${target}.git`;
}

export interface PushOptions {
  dir: string;
  remote: string;
  branch: string;
  message: string;
  log: Logger;
  dryRun?: boolean;
  secret?: string;
}

/** Initializes a fresh repository in `dir`, commits everything and force-pushes the branch. */
export async function pushSnapshot(options: PushOptions): Promise<void> {
  const { dir, log } = options;
  const common = {
    cwd: dir,
    log,
    dryRun: options.dryRun ?? false,
    ...(options.secret ? { secret: options.secret } : {}),
  };
  const identity =
    process.env.GITHUB_ACTIONS === "true"
      ? [
          "-c",
          "user.name=github-actions[bot]",
          "-c",
          "user.email=41898282+github-actions[bot]@users.noreply.github.com",
        ]
      : ["-c", "user.name=Eugenia", "-c", "user.email=eugenia@users.noreply.github.com"];
  await run("git", ["init", "-q", "-b", options.branch], common);
  await run("git", ["add", "-A"], common);
  await run("git", [...identity, "commit", "-q", "--no-gpg-sign", "-m", options.message], common);
  await run(
    "git",
    ["push", "--force", "-q", options.remote, `HEAD:refs/heads/${options.branch}`],
    common,
  );
}
