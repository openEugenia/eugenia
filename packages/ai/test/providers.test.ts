import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AIError, createProvider, DEFAULT_ANTHROPIC_MODEL } from "../src/index.ts";
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
    if (!next) throw new Error("Pas de réponse prévue");
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

describe("fournisseur Anthropic", () => {
  it("utilise Claude Opus 5.5 par défaut, l'effort et le repli côté serveur", async () => {
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

  it("transforme un refus en erreur explicite", async () => {
    const { fetch } = mockFetch([message("", "refusal")]);
    const provider = createProvider({ kind: "anthropic", apiKey: "sk" }, { fetch });
    await expect(
      provider.complete({ system: "S", messages: [{ role: "user", content: "x" }] }),
    ).rejects.toMatchObject({
      kind: "refusal",
    });
  });

  it("signale une clé refusée", async () => {
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

  it("valide une sortie structurée", async () => {
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

  it("diffuse la réponse au fil de l'eau", async () => {
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

  it("n'envoie le repli et l'effort qu'aux modèles qui les acceptent", async () => {
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

describe("fournisseurs compatibles OpenAI et Ollama", () => {
  it("appelle /chat/completions avec le prompt système", async () => {
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

  it("lit un flux SSE", async () => {
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

  it("se rabat sur le mode JSON simple si le schéma n'est pas pris en charge", async () => {
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

  it("explique comment autoriser l'application quand Ollama est injoignable", async () => {
    const fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof globalThis.fetch;
    const provider = createProvider({ kind: "ollama", model: "m" }, { fetch });
    await expect(
      provider.complete({ system: "S", messages: [{ role: "user", content: "x" }] }),
    ).rejects.toThrow(/OLLAMA_ORIGINS/);
  });
});
