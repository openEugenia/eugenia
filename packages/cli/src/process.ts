/** Exécution de commandes externes (git, gh, ssh-keygen). */
import { spawn } from "node:child_process";
import { CliError, dim, type Logger } from "./output.ts";

export interface RunOptions {
  cwd?: string;
  input?: string;
  env?: NodeJS.ProcessEnv;
  /** Affiche la commande sans l'exécuter. */
  dryRun?: boolean;
  log?: Logger;
  /** Texte à masquer dans les journaux (jeton). */
  secret?: string;
  /** Ne lève pas d'erreur si le code de sortie est non nul. */
  allowFailure?: boolean;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function mask(text: string, secret?: string): string {
  return secret ? text.split(secret).join("***") : text;
}

export async function run(
  command: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<RunResult> {
  const printable = mask([command, ...args].join(" "), options.secret);
  options.log?.info(dim(`$ ${printable}`));
  if (options.dryRun) return { code: 0, stdout: "", stderr: "" };
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT")
        reject(new CliError(`Commande introuvable : ${command}. Installez-la puis réessayez.`));
      else reject(error);
    });
    child.on("close", (code) => {
      const result = { code: code ?? 1, stdout, stderr };
      if (result.code !== 0 && !options.allowFailure) {
        reject(
          new CliError(
            `Échec de « ${printable} » :\n${mask(stderr || stdout, options.secret).trim()}`,
          ),
        );
      } else {
        resolve(result);
      }
    });
    child.stdin.end(options.input ?? "");
  });
}
