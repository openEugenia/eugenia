import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AIError,
  createProvider,
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_MISTRAL_URL,
  embedTexts,
} from "../src/index.ts";
import { sse } from "./fake.ts";

interface Captured {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}

function mockFetch(responses: Response[]): { fetch: typeof fetch; calls: Captured[] } {
  const calls: Captured[] = [];
  const queue = [...responses];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const text = await request.text();
    calls.push({
      url: request.url,
      headers: request.headers,
      body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
    });
    const next = queue.shift();
    if (!next) throw new Error("No scripted response");
    return next;
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

function message(text: string, stop = "end_turn"): Response {
  return Response.json({
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: DEFAULT_ANTHROPIC_MODEL,
    content: [{ type: "text", text }],
    stop_reason: stop,
    stop_sequence: null,
    stop_details:
      stop === "refusal" ? { type: "refusal", category: null, explanation: "non" } : null,
    usage: { input_tokens: 10, output_tokens: 5 },
  });
}

describe("Anthropic provider", () => {
  it("uses Claude Opus 5.5 by default, the effort and the server-side fallback", async () => {
    const { fetch, calls } = mockFetch([message("Bonjour")]);
    const provider = createProvider({ kind: "anthropic", apiKey: "sk-test" }, { fetch });
    const text = await provider.complete({
      system: "S",
      messages: [{ role: "user", content: "Salut" }],
      effort: "low",
    });
    expect(text).toBe("Bonjour");
    const call = calls[0]!;
    expect(call.url).toContain("/v1/messages");
    expect(call.headers.get("authorization")).toBe("Bearer sk-test");
    expect(call.headers.get("anthropic-dangerous-direct-browser-access")).toBe("true");
    expect(call.headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    expect(call.body).toMatchObject({
      model: "claude-opus-5-5",
      system: "S",
      fallbacks: "default",
      output_config: { effort: "low" },
      messages: [{ role: "user", content: "Salut" }],
    });
    expect(call.body).not.toHaveProperty("temperature");
    expect(provider.info.local).toBe(false);
  });

  it("turns a refusal into an explicit error", async () => {
    const { fetch } = mockFetch([message("", "refusal")]);
    const provider = createProvider({ kind: "anthropic", apiKey: "sk" }, { fetch });
    await expect(
      provider.complete({ system: "S", messages: [{ role: "user", content: "x" }] }),
    ).rejects.toMatchObject({
      kind: "refusal",
    });
  });

  it("reports a refused key", async () => {
    const { fetch } = mockFetch([
      Response.json(
        { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } },
        { status: 401 },
      ),
    ]);
    const provider = createProvider({ kind: "anthropic", apiKey: "bad" }, { fetch });
    const error = await provider
      .complete({ system: "S", messages: [{ role: "user", content: "x" }] })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AIError);
    expect((error as AIError).kind).toBe("auth");
  });

  it("validates a structured output", async () => {
    const { fetch, calls } = mockFetch([message('{"score": 0.3, "feedback": "Presque"}')]);
    const provider = createProvider({ kind: "anthropic", apiKey: "sk" }, { fetch });
    const result = await provider.json({
      system: "S",
      messages: [{ role: "user", content: "x" }],
      schema: z.object({ score: z.number(), feedback: z.string() }),
      name: "evaluation",
    });
    expect(result).toEqual({ score: 0.3, feedback: "Presque" });
    const format = (calls[0]!.body.output_config as { format: { type: string; schema: unknown } })
      .format;
    expect(format.type).toBe("json_schema");
  });

  it("streams the answer", async () => {
    const body = sse([
      {
        event: "message_start",
        data: {
          type: "message_start",
          message: {
            id: "m",
            type: "message",
            role: "assistant",
            model: "claude-opus-5-5",
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 0 },
          },
        },
      },
      {
        event: "content_block_start",
        data: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      },
      {
        event: "content_block_delta",
        data: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Bon" } },
      },
      {
        event: "content_block_delta",
        data: {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "jour" },
        },
      },
      { event: "content_block_stop", data: { type: "content_block_stop", index: 0 } },
      {
        event: "message_delta",
        data: {
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: { output_tokens: 2 },
        },
      },
      { event: "message_stop", data: { type: "message_stop" } },
    ]);
    const { fetch } = mockFetch([
      new Response(body, { headers: { "content-type": "text/event-stream" } }),
    ]);
    const provider = createProvider({ kind: "anthropic", apiKey: "sk" }, { fetch });
    let text = "";
    for await (const part of provider.stream({
      system: "S",
      messages: [{ role: "user", content: "x" }],
    }))
      text += part;
    expect(text).toBe("Bonjour");
  });

  it("only sends the fallback and the effort to models that accept them", async () => {
    const { fetch, calls } = mockFetch([message("ok")]);
    const provider = createProvider(
      { kind: "anthropic", apiKey: "sk", model: "claude-haiku-4-5" },
      { fetch },
    );
    await provider.complete({
      system: "S",
      messages: [{ role: "user", content: "x" }],
      effort: "low",
    });
    expect(calls[0]!.body).not.toHaveProperty("fallbacks");
    expect(calls[0]!.body).not.toHaveProperty("output_config");
  });
});

describe("OpenAI-compatible providers and Ollama", () => {
  it("calls /chat/completions with the system prompt", async () => {
    const { fetch, calls } = mockFetch([
      Response.json({ choices: [{ message: { content: " Salut " } }] }),
    ]);
    const provider = createProvider({ kind: "ollama", model: "llama3.1" }, { fetch });
    expect(provider.info.local).toBe(true);
    expect(
      await provider.complete({ system: "S", messages: [{ role: "user", content: "x" }] }),
    ).toBe("Salut");
    expect(calls[0]!.url).toBe("http://localhost:11434/v1/chat/completions");
    expect(calls[0]!.body.messages).toEqual([
      { role: "system", content: "S" },
      { role: "user", content: "x" },
    ]);
    expect(calls[0]!.headers.get("authorization")).toBeNull();
  });

  it("reads an SSE stream", async () => {
    const body = sse([
      { data: { choices: [{ delta: { content: "Bon" } }] } },
      { data: { choices: [{ delta: { content: "jour" } }] } },
      { data: "[DONE]" },
    ]);
    const { fetch } = mockFetch([new Response(body)]);
    const provider = createProvider(
      { kind: "openai", model: "m", apiKey: "k", baseUrl: "https://ia.example/v1/" },
      { fetch },
    );
    let text = "";
    for await (const part of provider.stream({
      system: "S",
      messages: [{ role: "user", content: "x" }],
    }))
      text += part;
    expect(text).toBe("Bonjour");
    expect(provider.info.local).toBe(false);
  });

  it("falls back on plain JSON mode if the schema is not supported", async () => {
    const { fetch, calls } = mockFetch([
      new Response("response_format json_schema non pris en charge", { status: 400 }),
      Response.json({ choices: [{ message: { content: 'Voici : {"ok": true}' } }] }),
    ]);
    const provider = createProvider({ kind: "ollama", model: "m" }, { fetch });
    const result = await provider.json({
      system: "S",
      messages: [{ role: "user", content: "x" }],
      schema: z.object({ ok: z.boolean() }),
      name: "t",
    });
    expect(result).toEqual({ ok: true });
    expect((calls[1]!.body.response_format as { type: string }).type).toBe("json_object");
  });

  it("explains how to allow the app when Ollama cannot be reached", async () => {
    const fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof globalThis.fetch;
    const provider = createProvider({ kind: "ollama", model: "m" }, { fetch });
    await expect(
      provider.complete({ system: "S", messages: [{ role: "user", content: "x" }] }),
    ).rejects.toThrow(/OLLAMA_ORIGINS/);
  });
});

describe("embeddings", () => {
  const vectors = (n: number, offset = 0): { index: number; embedding: number[] }[] =>
    Array.from({ length: n }, (_, i) => ({ index: i, embedding: [offset + i, 1] }));

  it("calls Mistral's /embeddings and puts the vectors back in the order of the texts", async () => {
    const { fetch, calls } = mockFetch([Response.json({ data: [vectors(2)[1], vectors(2)[0]] })]);
    const provider = createProvider(
      { kind: "openai", model: DEFAULT_EMBEDDING_MODEL, apiKey: "k", baseUrl: DEFAULT_MISTRAL_URL },
      { fetch },
    );
    expect(provider.info.label).toBe("Mistral");
    expect(await provider.embed!(["a", "b"])).toEqual([
      [0, 1],
      [1, 1],
    ]);
    expect(calls[0]!.url).toBe("https://api.mistral.ai/v1/embeddings");
    expect(calls[0]!.body).toEqual({ model: "mistral-embed", input: ["a", "b"] });
    expect(calls[0]!.headers.get("authorization")).toBe("Bearer k");
  });

  it("splits into batches by number of texts and by size", async () => {
    const { fetch, calls } = mockFetch([
      Response.json({ data: vectors(2) }),
      Response.json({ data: vectors(1, 2) }),
      Response.json({ data: vectors(1, 3) }),
    ]);
    const provider = createProvider({ kind: "ollama", model: "nomic-embed-text" }, { fetch });
    const progress: number[] = [];
    const result = await embedTexts(provider, ["a", "b", "c", "x".repeat(50)], {
      batchSize: 2,
      maxChars: 40,
      onProgress: (done) => progress.push(done),
    });
    expect(calls.map((c) => c.body.input)).toEqual([["a", "b"], ["c"], ["x".repeat(50)]]);
    expect(result.map((v) => v[0])).toEqual([0, 1, 2, 3]);
    expect(progress).toEqual([2, 3, 4]);
  });

  it("refuses a provider without embeddings and an incomplete answer", async () => {
    const anthropic = createProvider({ kind: "anthropic", apiKey: "sk" });
    await expect(embedTexts(anthropic, ["a"])).rejects.toMatchObject({ kind: "config" });
    const { fetch } = mockFetch([Response.json({ data: vectors(1) })]);
    const provider = createProvider(
      { kind: "openai", model: "m", baseUrl: "https://x/v1" },
      { fetch },
    );
    await expect(provider.embed!(["a", "b"])).rejects.toMatchObject({ kind: "invalid_output" });
  });
});
