/** Lecture d'un flux Server-Sent Events (API compatibles OpenAI). */

export interface SSEEvent {
  event?: string;
  data: string;
}

export async function* readSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<SSEEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event: string | undefined;
  let data: string[] = [];
  const dispatch = (): SSEEvent | null => {
    if (data.length === 0) return null;
    const out: SSEEvent = { data: data.join("\n") };
    if (event) out.event = event;
    event = undefined;
    data = [];
    return out;
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.search(/\r?\n/)) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + (buffer[newline] === "\r" ? 2 : 1));
        if (line === "") {
          const out = dispatch();
          if (out) yield out;
        } else if (line.startsWith(":")) {
          continue;
        } else {
          const colon = line.indexOf(":");
          const field = colon < 0 ? line : line.slice(0, colon);
          const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
          if (field === "data") data.push(value);
          else if (field === "event") event = value;
        }
      }
    }
    buffer += decoder.decode();
    if (buffer.startsWith("data:")) data.push(buffer.slice(5).replace(/^ /, ""));
    const out = dispatch();
    if (out) yield out;
  } finally {
    reader.releaseLock();
  }
}
