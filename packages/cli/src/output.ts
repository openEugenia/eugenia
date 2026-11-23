/** Console output: sober colors (disabled outside a terminal or with NO_COLOR). */
import type { Problem } from "@openeugenia/core";

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (text: string) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);

export const bold = paint("1");
export const dim = paint("2");
export const red = paint("31");
export const green = paint("32");
export const yellow = paint("33");
export const cyan = paint("36");

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export const consoleLogger: Logger = {
  info: (m) => console.log(m),
  warn: (m) => console.warn(m),
  error: (m) => console.error(m),
};

export function formatProblem(problem: Problem): string {
  const tag = problem.level === "error" ? red("error") : yellow("warning");
  const where = problem.path ? dim(` (${problem.path})`) : "";
  return `  ${tag} ${problem.message}${where}`;
}

export function reportProblems(log: Logger, problems: readonly Problem[]): void {
  const errors = problems.filter((p) => p.level === "error");
  const warnings = problems.filter((p) => p.level === "warning");
  for (const p of [...errors, ...warnings])
    (p.level === "error" ? log.error : log.warn)(formatProblem(p));
  if (problems.length > 0) {
    log.info(`${errors.length} error(s), ${warnings.length} warning(s).`);
  }
}

/** Usage or execution error: message for the user, exit code. */
export class CliError extends Error {
  override name = "CliError";
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
  }
}
