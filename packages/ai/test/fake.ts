import type { z } from "zod";
import type { AIProvider, GenerateRequest, JsonRequest, ProviderInfo } from "../src/index.ts";

/** Fournisseur scripté pour les tests. */
export class FakeProvider implements AIProvider {
  readonly info: ProviderInfo;
  readonly calls: GenerateRequest[] = [];
  private readonly jsonQueue: unknown[];
  private readonly textQueue: string[];

  constructor(script: { json?: unknown[]; text?: string[] } = {}, local = true) {
    this.jsonQueue = [...(script.json ?? [])];
    this.textQueue = [...(script.text ?? [])];
    this.info = { kind: local ? "ollama" : "openai", label: "Faux", model: "faux", local };
  }

  async complete(request: GenerateRequest): Promise<string> {
    this.calls.push(request);
    return this.textQueue.shift() ?? "";
  }

  async *stream(request: GenerateRequest): AsyncGenerator<string> {
    this.calls.push(request);
    const text = this.textQueue.shift() ?? "";
    for (const part of text.match(/.{1,5}/gs) ?? []) yield part;
  }

  async json<T>(request: JsonRequest<T>): Promise<T> {
    this.calls.push(request);
    return (request.schema as z.ZodType<T>).parse(this.jsonQueue.shift());
  }

  async countTokens(): Promise<number> {
    return 0;
  }
}

export function sse(events: { event?: string; data: unknown }[]): string {
  return events
    .map(
      (e) =>
        `${e.event ? `event: ${e.event}\n` : ""}data: ${typeof e.data === "string" ? e.data : JSON.stringify(e.data)}\n\n`,
    )
    .join("");
}
