/** Embeddings des pages et des requêtes, pour la recherche sémantique (§14). */
import { AIError } from "../errors.ts";
import type { AIProvider } from "../types.ts";

export interface EmbedOptions {
  signal?: AbortSignal;
  /** Textes par requête, au plus (défaut : 32). */
  batchSize?: number;
  /** Caractères par requête, au plus (défaut : 40 000, environ 10 000 jetons). */
  maxChars?: number;
  /** Appelé après chaque lot, avec le nombre de textes déjà traités. */
  onProgress?: (done: number, total: number) => void;
}

export function canEmbed(provider: AIProvider): boolean {
  return typeof provider.embed === "function";
}

/** Embeddings de textes, par lots, dans l'ordre des textes. */
export async function embedTexts(
  provider: AIProvider,
  texts: readonly string[],
  options: EmbedOptions = {},
): Promise<number[][]> {
  const embed = provider.embed?.bind(provider);
  if (!embed) {
    throw new AIError(
      "config",
      `${provider.info.label} ne calcule pas d'embeddings : choisissez Mistral (mistral-embed) ou un autre fournisseur compatible OpenAI pour la recherche sémantique.`,
    );
  }
  const batchSize = options.batchSize ?? 32;
  const maxChars = options.maxChars ?? 40_000;
  const out: number[][] = [];
  let batch: string[] = [];
  let chars = 0;
  const flush = async (): Promise<void> => {
    if (batch.length === 0) return;
    out.push(...(await embed(batch, options.signal)));
    options.onProgress?.(out.length, texts.length);
    batch = [];
    chars = 0;
  };
  for (const text of texts) {
    // Une entrée vide est refusée par certaines API.
    const input = text.trim() || "(vide)";
    if (batch.length > 0 && (batch.length >= batchSize || chars + input.length > maxChars)) {
      await flush();
    }
    batch.push(input);
    chars += input.length;
  }
  await flush();
  return out;
}

/** Embedding d'une requête de recherche. */
export async function embedQuery(
  provider: AIProvider,
  query: string,
  signal?: AbortSignal,
): Promise<number[]> {
  const [vector] = await embedTexts(provider, [query], signal ? { signal } : {});
  return vector!;
}
