/** Interface commune des fournisseurs d'IA (spécification §11.1). */
import type { z } from "zod";

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface GenerateRequest {
  /** Prompt système (rôle d'Eugenia pour la tâche). */
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
  /** Profondeur de réflexion, pour les modèles qui la prennent en charge. */
  effort?: Effort;
  /** Met en cache le préfixe de la conversation (discussions à plusieurs tours). */
  cache?: boolean;
  signal?: AbortSignal;
}

export interface JsonRequest<T> extends GenerateRequest {
  /** Schéma de la sortie structurée, validé côté client. */
  schema: z.ZodType<T>;
  /** Nom court du format (utilisé par les API compatibles OpenAI). */
  name: string;
}

export type ProviderKind = "anthropic" | "openai" | "ollama";

export interface ProviderInfo {
  kind: ProviderKind;
  label: string;
  model: string;
  /** Le modèle tourne sur l'appareil ou le réseau local de l'utilisateur. */
  local: boolean;
}

export interface AIProvider {
  readonly info: ProviderInfo;
  /** Réponse complète en texte. */
  complete(request: GenerateRequest): Promise<string>;
  /** Réponse diffusée au fil de l'eau (fragments de texte). */
  stream(request: GenerateRequest): AsyncIterable<string>;
  /** Sortie structurée JSON, validée par le schéma. */
  json<T>(request: JsonRequest<T>): Promise<T>;
  /** Nombre de jetons d'entrée (estimation si le fournisseur ne sait pas compter). */
  countTokens(request: GenerateRequest): Promise<number>;
  /** Vecteurs d'embeddings (évolution prévue, §14). */
  embed?(texts: string[]): Promise<number[][]>;
}

/** Configuration d'un fournisseur, telle que saisie dans les paramètres. */
export interface ProviderConfig {
  kind: ProviderKind;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  label?: string;
}
