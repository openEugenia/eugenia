/** Errors of AI calls, with a message meant for the user. */

export type AIErrorKind =
  | "auth"
  | "rate_limit"
  | "overloaded"
  | "network"
  | "refusal"
  | "invalid_output"
  | "privacy"
  | "config"
  | "aborted"
  | "other";

export class AIError extends Error {
  override name = "AIError";
  readonly kind: AIErrorKind;
  readonly status: number | undefined;

  constructor(
    kind: AIErrorKind,
    message: string,
    options: { cause?: unknown; status?: number } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.kind = kind;
    this.status = options.status;
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof AIError && error.kind === "aborted") ||
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}
