/** Extracts a JSON object from a text answer (providers without structured output). */

export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidates = [fenced?.[1], trimmed];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return JSON.parse(candidate);
    } catch {
      // try the first balanced object
    }
    const start = candidate.search(/[[{]/);
    if (start < 0) continue;
    const slice = balanced(candidate, start);
    if (slice) {
      try {
        return JSON.parse(slice);
      } catch {
        // next
      }
    }
  }
  throw new SyntaxError("No valid JSON in the answer.");
}

function balanced(text: string, start: number): string | null {
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
