/**
 * Fournisseur Anthropic (Claude), appelé directement depuis le navigateur ou la CLI
 * avec la clé de l'utilisateur, via le SDK officiel.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type {
  BetaMessage,
  MessageCreateParamsNonStreaming,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { DEFAULT_ANTHROPIC_MODEL } from "../constants.ts";
import { AIError } from "../errors.ts";
import type { AIProvider, Effort, GenerateRequest, JsonRequest, ProviderInfo } from "../types.ts";

export { DEFAULT_ANTHROPIC_MODEL };

type SDK = typeof import("@anthropic-ai/sdk");

/** Le SDK n'est chargé qu'au premier appel (allège l'application web). */
let sdkPromise: Promise<SDK> | null = null;
function loadSdk(): Promise<SDK> {
  sdkPromise ??= import("@anthropic-ai/sdk");
  return sdkPromise;
}

/** Repli côté serveur sur un autre modèle en cas de refus (option recommandée). */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** Modèles qui acceptent `fallbacks: "default"`. */
export function supportsServerFallback(model: string): boolean {
  return /^claude-(fable|mythos|opus)-5(?:-|$)/.test(model) || model === "claude-sonnet-5-5";
}

/** Modèles qui acceptent `output_config.effort`. */
export function supportsEffort(model: string): boolean {
  return (
    /^claude-(fable|mythos|opus|sonnet|haiku)-5(?:-|$)/.test(model) ||
    /^claude-opus-4-[678](?:-|$)/.test(model) ||
    /^claude-sonnet-4-6(?:-|$)/.test(model)
  );
}

export interface AnthropicProviderOptions {
  /**
   * Clé API. Dans le navigateur, elle est obligatoire ; en ligne de commande, le SDK
   * peut aussi trouver seul les identifiants (ANTHROPIC_API_KEY, profil `ant auth login`).
   */
  apiKey?: string;
  model?: string;
  baseURL?: string;
  label?: string;
  fetch?: typeof fetch;
}

export class AnthropicProvider implements AIProvider {
  readonly info: ProviderInfo;
  private clientPromise: Promise<Anthropic> | null = null;

  constructor(private readonly options: AnthropicProviderOptions) {
    this.info = {
      kind: "anthropic",
      label: options.label ?? "Claude (Anthropic)",
      model: options.model || DEFAULT_ANTHROPIC_MODEL,
      local: false,
    };
  }

  private client(): Promise<Anthropic> {
    this.clientPromise ??= loadSdk().then(
      (sdk) =>
        new sdk.default({
          ...(this.options.apiKey ? { apiKey: this.options.apiKey } : {}),
          // La clé appartient à l'utilisateur et ne quitte son navigateur que vers l'API.
          dangerouslyAllowBrowser: true,
          maxRetries: 2,
          ...(this.options.baseURL ? { baseURL: this.options.baseURL } : {}),
          ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
        }),
    );
    return this.clientPromise;
  }

  private params(
    request: GenerateRequest,
    effort: Effort | undefined,
    maxTokens: number,
  ): MessageCreateParamsNonStreaming {
    const model = this.info.model;
    const params: MessageCreateParamsNonStreaming = {
      model,
      max_tokens: request.maxTokens ?? maxTokens,
      system: request.system,
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
    };
    if (effort && supportsEffort(model)) params.output_config = { effort };
    if (supportsServerFallback(model)) {
      params.betas = [FALLBACK_BETA];
      params.fallbacks = "default";
    }
    if (request.cache) params.cache_control = { type: "ephemeral" };
    return params;
  }

  async complete(request: GenerateRequest): Promise<string> {
    try {
      const client = await this.client();
      const message = await client.beta.messages.create(
        this.params(request, request.effort, 16000),
        request.signal ? { signal: request.signal } : undefined,
      );
      return textOf(checkStop(message));
    } catch (error) {
      throw mapError(error, await loadSdk().catch(() => null));
    }
  }

  async *stream(request: GenerateRequest): AsyncGenerator<string> {
    try {
      const client = await this.client();
      const stream = client.beta.messages.stream(
        this.params(request, request.effort, 64000),
        request.signal ? { signal: request.signal } : undefined,
      );
      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield event.delta.text;
        }
      }
      checkStop(await stream.finalMessage());
    } catch (error) {
      throw mapError(error, await loadSdk().catch(() => null));
    }
  }

  async json<T>(request: JsonRequest<T>): Promise<T> {
    try {
      const params = this.params(request, request.effort, 16000);
      const client = await this.client();
      const { betaZodOutputFormat } = await import("@anthropic-ai/sdk/helpers/beta/zod");
      const message = await client.beta.messages.parse(
        {
          ...params,
          output_config: { ...params.output_config, format: betaZodOutputFormat(request.schema) },
        },
        request.signal ? { signal: request.signal } : undefined,
      );
      checkStop(message);
      if (message.parsed_output === null || message.parsed_output === undefined) {
        throw new AIError("invalid_output", "La réponse d'Eugenia n'a pas le format attendu.");
      }
      return message.parsed_output as T;
    } catch (error) {
      throw mapError(error, await loadSdk().catch(() => null));
    }
  }

  async countTokens(request: GenerateRequest): Promise<number> {
    try {
      const client = await this.client();
      const result = await client.beta.messages.countTokens({
        model: this.info.model,
        system: request.system,
        messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      });
      return result.input_tokens;
    } catch (error) {
      throw mapError(error, await loadSdk().catch(() => null));
    }
  }
}

function textOf(message: BetaMessage): string {
  return message.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("")
    .trim();
}

/** Vérifie la raison d'arrêt avant de lire le contenu. */
function checkStop<M extends BetaMessage>(message: M): M {
  if (message.stop_reason === "refusal") {
    const details = message.stop_details;
    throw new AIError(
      "refusal",
      `Le modèle a refusé de traiter cette demande${details?.explanation ? ` : ${details.explanation}` : "."}`,
    );
  }
  return message;
}

/** Erreurs typées du SDK → erreurs Eugenia, du cas le plus précis au plus général. */
export function mapError(error: unknown, sdk: SDK | null): AIError {
  if (error instanceof AIError) return error;
  if (!sdk)
    return new AIError("network", "Impossible de charger le client Anthropic.", { cause: error });
  const {
    APIConnectionError,
    APIError,
    APIUserAbortError,
    AuthenticationError,
    BadRequestError,
    InternalServerError,
    NotFoundError,
    PermissionDeniedError,
    RateLimitError,
  } = sdk;
  if (error instanceof APIUserAbortError) {
    return new AIError("aborted", "Demande annulée.", { cause: error });
  }
  if (error instanceof AuthenticationError || error instanceof PermissionDeniedError) {
    return new AIError("auth", "Clé API Anthropic refusée : vérifiez-la dans les paramètres.", {
      cause: error,
      status: error.status,
    });
  }
  if (error instanceof RateLimitError) {
    return new AIError(
      "rate_limit",
      "Limite de requêtes Anthropic atteinte : réessayez dans un instant.",
      {
        cause: error,
        status: error.status,
      },
    );
  }
  if (error instanceof NotFoundError) {
    return new AIError(
      "config",
      "Modèle Claude inconnu : vérifiez le nom du modèle dans les paramètres.",
      {
        cause: error,
        status: error.status,
      },
    );
  }
  if (error instanceof BadRequestError) {
    return new AIError("other", `Requête refusée par l'API Anthropic : ${error.message}`, {
      cause: error,
      status: error.status,
    });
  }
  if (error instanceof InternalServerError) {
    return new AIError(
      "overloaded",
      "L'API Anthropic est surchargée ou indisponible : réessayez plus tard.",
      {
        cause: error,
        status: error.status,
      },
    );
  }
  if (error instanceof APIConnectionError) {
    return new AIError(
      "network",
      "Impossible de joindre l'API Anthropic : vérifiez votre connexion.",
      {
        cause: error,
      },
    );
  }
  if (error instanceof APIError) {
    return new AIError("other", `Erreur de l'API Anthropic : ${error.message}`, {
      cause: error,
      ...(error.status !== undefined ? { status: error.status } : {}),
    });
  }
  if (error instanceof Error && error.name === "AbortError") {
    return new AIError("aborted", "Demande annulée.", { cause: error });
  }
  return new AIError("other", error instanceof Error ? error.message : String(error), {
    cause: error,
  });
}
