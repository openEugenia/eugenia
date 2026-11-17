/**
 * Fournisseurs compatibles avec l'API OpenAI (`/chat/completions`) : tout autre
 * fournisseur distant, et Ollama ou un serveur local (§11.1).
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
} from "../types.ts";
import { DEFAULT_OLLAMA_MODEL, DEFAULT_OLLAMA_URL, DEFAULT_OPENAI_URL } from "../constants.ts";

export { DEFAULT_OLLAMA_MODEL, DEFAULT_OLLAMA_URL, DEFAULT_OPENAI_URL } from "../constants.ts";

export interface OpenAICompatibleOptions {
  kind: Exclude<ProviderKind, "anthropic">;
  baseUrl: string;
  model: string;
  apiKey?: string;
  label?: string;
  /** Force le caractère local (sinon déduit de l'adresse). */
  local?: boolean;
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
  message?: { content?: string | null };
  delta?: { content?: string | null };
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly info: ProviderInfo;
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAICompatibleOptions) {
    if (!options.model) throw new AIError("config", "Nom du modèle manquant.");
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.apiKey = options.apiKey || undefined;
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

  private async post(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
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
        throw new AIError("aborted", "Demande annulée.", { cause: error });
      }
      const hint =
        this.info.kind === "ollama"
          ? " Vérifiez qu'Ollama est lancé et qu'il autorise l'origine de l'application (variable OLLAMA_ORIGINS)."
          : "";
      throw new AIError(
        "network",
        `Impossible de joindre ${this.info.label} (${this.baseUrl}).${hint}`,
        {
          cause: error,
        },
      );
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
    return (data.choices?.[0]?.message?.content ?? "").trim();
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
    if (!response.body) throw new AIError("network", "Réponse vide du fournisseur.");
    for await (const event of readSSE(response.body)) {
      if (event.data === "[DONE]") break;
      let chunk: { choices?: ChatChoice[] };
      try {
        chunk = JSON.parse(event.data) as { choices?: ChatChoice[] };
      } catch {
        continue;
      }
      const text = chunk.choices?.[0]?.delta?.content;
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
    const system = `${request.system}\n\nRéponds uniquement avec un objet JSON conforme à ce schéma :\n${JSON.stringify(schema)}`;
    let lastError: unknown;
    for (const format of formats) {
      let text: string;
      try {
        const response = await this.post(
          {
            model: this.info.model,
            messages: this.messages({ ...request, system }),
            max_tokens: request.maxTokens ?? 16000,
            stream: false,
            ...(format ? { response_format: format } : {}),
          },
          request.signal,
        );
        const data = (await response.json()) as { choices?: ChatChoice[] };
        text = data.choices?.[0]?.message?.content ?? "";
      } catch (error) {
        // Format de sortie non pris en charge : on essaie le suivant.
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
    throw new AIError("invalid_output", "La réponse du modèle n'a pas le format attendu.", {
      cause: lastError,
    });
  }

  async countTokens(request: GenerateRequest): Promise<number> {
    // Estimation : environ 4 caractères par jeton.
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
    // corps non JSON
  }
  detail = detail.slice(0, 300);
  if (status === 401 || status === 403) {
    return new AIError("auth", `${label} refuse la clé API : vérifiez-la dans les paramètres.`, {
      status,
    });
  }
  if (status === 404) {
    return new AIError("config", `${label} : modèle ou adresse introuvable (${detail}).`, {
      status,
    });
  }
  if (status === 429) {
    return new AIError(
      "rate_limit",
      `${label} : limite de requêtes atteinte, réessayez plus tard.`,
      { status },
    );
  }
  if (status >= 500) {
    return new AIError("overloaded", `${label} est indisponible (${status}).`, { status });
  }
  return new AIError("other", `${label} a refusé la requête (${status}) : ${detail}`, { status });
}
