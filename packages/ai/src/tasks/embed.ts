/** Embeddings of pages and queries, for semantic search (§14). */
import { AIError } from "../errors.ts";
import type { AIProvider } from "../types.ts";

export interface EmbedOptions {
  signal?: AbortSignal;
  /** Maximum number of texts per request (default: 32). */
  batchSize?: number;
  /** Maximum number of characters per request (default: 40,000, about 10,000 tokens). */
  maxChars?: number;
  /** Called after each batch, with the number of texts already processed. */
  onProgress?: (done: number, total: number) => void;
}

export function canEmbed(provider: AIProvider): boolean {
  return typeof provider.embed === "function";
}

/** Embeddings of texts, in batches, in the order of the texts. */
export async function embedTexts(
  provider: AIProvider,
  texts: readonly string[],
  options: EmbedOptions = {},
): Promise<number[][]> {
  const embed = provider.embed?.bind(provider);
  if (!embed) {
    throw new AIError(
      "config",
      `${provider.info.label} does not compute embeddings: choose Mistral (mistral-embed) or another OpenAI-compatible provider for semantic search.`,
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
    // An empty input is refused by some APIs.
    const input = text.trim() || "(empty)";
    if (batch.length > 0 && (batch.length >= batchSize || chars + input.length > maxChars)) {
      await flush();
    }
    batch.push(input);
    chars += input.length;
  }
  await flush();
  return out;
}

/** Embedding of a search query. */
export async function embedQuery(
  provider: AIProvider,
  query: string,
  signal?: AbortSignal,
): Promise<number[]> {
  const [vector] = await embedTexts(provider, [query], signal ? { signal } : {});
  return vector!;
}
