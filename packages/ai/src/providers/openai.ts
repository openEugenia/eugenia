/**
 * Providers compatible with the OpenAI API (`/chat/completions`): any other remote provider,
 * and Ollama or a local server (§11.1).
 */
import { z } from "zod";
import { AIError } from "../errors.ts";
import { extractJson } from "../json.ts";
import { readSSE } from "../sse.ts";
import type {
  AIProvider,
  GenerateRequest,
  JsonRequest,
  ProviderInfo,
  ProviderKind,
  ReasoningEffort,
} from "../types.ts";
import { DEFAULT_OLLAMA_MODEL, DEFAULT_OLLAMA_URL, DEFAULT_OPENAI_URL } from "../constants.ts";

export { DEFAULT_OLLAMA_MODEL, DEFAULT_OLLAMA_URL, DEFAULT_OPENAI_URL } from "../constants.ts";

export interface OpenAICompatibleOptions {
  kind: Exclude<ProviderKind, "anthropic">;
  baseUrl: string;
  model: string;
  apiKey?: string;
  label?: string;
  /** Forces the local flag (otherwise deduced from the URL). */
  local?: boolean;
  /** Reasoning of the model (`reasoning_effort`), for the models that support it. */
  reasoningEffort?: ReasoningEffort;
  fetch?: typeof fetch;
}

export function isLocalUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "[::1]" ||
      host.endsWith(".local") ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    );
  } catch {
    return false;
  }
}

interface ChatChoice {
  message?: { content?: unknown };
  delta?: { content?: unknown };
  finish_reason?: string | null;
}

/**
 * Text of a message: a string, or, for reasoning models (Mistral Large 4, Magistral…), a list
 * of chunks whose `text` parts form the answer (the `thinking` parts are left out).
 */
export function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((chunk: unknown) => {
      if (typeof chunk === "string") return chunk;
      if (!chunk || typeof chunk !== "object") return "";
      const c = chunk as { type?: unknown; text?: unknown };
      return c.type === "text" && typeof c.text === "string" ? c.text : "";
    })
    .join("");
}

function truncated(label: string): AIError {
  return new AIError(
    "invalid_output",
    `${label}: the answer was cut off (maximum length reached).`,
    { cause: "length" },
  );
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly info: ProviderInfo;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly reasoningEffort: ReasoningEffort | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAICompatibleOptions) {
    if (!options.model) throw new AIError("config", "Missing model name.");
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey || undefined;
    this.reasoningEffort = options.reasoningEffort;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.info = {
      kind: options.kind,
      label: options.label ?? (options.kind === "ollama" ? "Ollama (local)" : "Compatible OpenAI"),
      model: options.model,
      local: options.local ?? (options.kind === "ollama" || isLocalUrl(this.baseUrl)),
    };
  }

  private messages(request: GenerateRequest): { role: string; content: string }[] {
    return [{ role: "system", content: request.system }, ...request.messages];
  }

  private async post(
    body: Record<string, unknown>,
    signal?: AbortSignal,
    endpoint = "/chat/completions",
  ): Promise<Response> {
    if (endpoint === "/chat/completions" && this.reasoningEffort) {
      body = { ...body, reasoning_effort: this.reasoningEffort };
    }
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${endpoint}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new AIError("aborted", "Request cancelled.", { cause: error });
      }
      const hint =
        this.info.kind === "ollama"
          ? " Check that Ollama is running and allows the app's origin (OLLAMA_ORIGINS variable)."
          : "";
      throw new AIError("network", `Cannot reach ${this.info.label} (${this.baseUrl}).${hint}`, {
        cause: error,
      });
    }
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw httpError(response.status, text, this.info.label);
    }
    return response;
  }

  async complete(request: GenerateRequest): Promise<string> {
    const response = await this.post(
      {
        model: this.info.model,
        messages: this.messages(request),
        max_tokens: request.maxTokens ?? 16000,
        stream: false,
      },
      request.signal,
    );
    const data = (await response.json()) as { choices?: ChatChoice[] };
    return messageText(data.choices?.[0]?.message?.content).trim();
  }

  async *stream(request: GenerateRequest): AsyncGenerator<string> {
    const response = await this.post(
      {
        model: this.info.model,
        messages: this.messages(request),
        max_tokens: request.maxTokens ?? 16000,
        stream: true,
      },
      request.signal,
    );
    if (!response.body) throw new AIError("network", "Empty response from the provider.");
    for await (const event of readSSE(response.body)) {
      if (event.data === "[DONE]") break;
      let chunk: { choices?: ChatChoice[] };
      try {
        chunk = JSON.parse(event.data) as { choices?: ChatChoice[] };
      } catch {
        continue;
      }
      const text = messageText(chunk.choices?.[0]?.delta?.content);
      if (text) yield text;
    }
  }

  async json<T>(request: JsonRequest<T>): Promise<T> {
    const schema = z.toJSONSchema(request.schema, { target: "draft-7" });
    const formats: (Record<string, unknown> | undefined)[] = [
      { type: "json_schema", json_schema: { name: request.name, schema, strict: true } },
      { type: "json_object" },
      undefined,
    ];
    const system = `${request.system}\n\nAnswer only with a JSON object matching this schema:\n${JSON.stringify(schema)}`;
    let lastError: unknown;
    for (const format of formats) {
      let text: string;
      try {
        const response = await this.post(
          {
            model: this.info.model,
            messages: this.messages({ ...request, system }),
            max_tokens: request.maxTokens ?? 16000,
            stream: request.stream === true,
            ...(format ? { response_format: format } : {}),
          },
          request.signal,
        );
        let finish: string | null | undefined;
        if (request.stream) {
          if (!response.body) throw new AIError("network", "Empty response from the provider.");
          text = "";
          for await (const event of readSSE(response.body)) {
            if (event.data === "[DONE]") break;
            let chunk: { choices?: ChatChoice[] };
            try {
              chunk = JSON.parse(event.data) as { choices?: ChatChoice[] };
            } catch {
              continue;
            }
            const choice = chunk.choices?.[0];
            text += messageText(choice?.delta?.content);
            finish = choice?.finish_reason ?? finish;
          }
        } else {
          const data = (await response.json()) as { choices?: ChatChoice[] };
          finish = data.choices?.[0]?.finish_reason;
          text = messageText(data.choices?.[0]?.message?.content);
        }
        // A truncated answer would be just as truncated in another format: give up now.
        if (finish === "length") throw truncated(this.info.label);
      } catch (error) {
        // Output format not supported: try the next one.
        if (error instanceof AIError && error.status === 400) {
          lastError = error;
          continue;
        }
        throw error;
      }
      try {
        const parsed = request.schema.safeParse(extractJson(text));
        if (parsed.success) return parsed.data;
        lastError = parsed.error;
      } catch (error) {
        lastError = error;
      }
    }
    throw new AIError("invalid_output", "The model's answer does not have the expected format.", {
      cause: lastError,
    });
  }

  /** Embedding vectors (`/embeddings`), in the order of the texts. */
  async embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    if (texts.length === 0) return [];
    const response = await this.post(
      { model: this.info.model, input: texts },
      signal,
      "/embeddings",
    );
    const data = (await response.json()) as { data?: { index?: number; embedding?: unknown }[] };
    const rows = [...(data.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (rows.length !== texts.length || rows.some((r) => !Array.isArray(r.embedding))) {
      throw new AIError(
        "invalid_output",
        `${this.info.label} did not return one embedding per text: check that "${this.info.model}" is an embedding model.`,
      );
    }
    return rows.map((r) => r.embedding as number[]);
  }

  async countTokens(request: GenerateRequest): Promise<number> {
    // Estimate: about 4 characters per token.
    const chars =
      request.system.length + request.messages.reduce((n, m) => n + m.content.length, 0);
    return Math.ceil(chars / 4);
  }
}

function httpError(status: number, body: string, label: string): AIError {
  let detail = body;
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string };
    detail = typeof parsed.error === "string" ? parsed.error : (parsed.error?.message ?? body);
  } catch {
    // non-JSON body
  }
  detail = detail.slice(0, 300);
  if (status === 401 || status === 403) {
    return new AIError("auth", `${label} refuses the API key: check it in the settings.`, {
      status,
    });
  }
  if (status === 404) {
    return new AIError("config", `${label}: model or URL not found (${detail}).`, {
      status,
    });
  }
  if (status === 429) {
    return new AIError("rate_limit", `${label}: rate limit reached, try again later.`, { status });
  }
  if (status >= 500) {
    return new AIError("overloaded", `${label} is unavailable (${status}).`, { status });
  }
  return new AIError("other", `${label} refused the request (${status}): ${detail}`, { status });
}
