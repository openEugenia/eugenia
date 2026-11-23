import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_PROMPTS, extractJson, PROMPT_NAMES, renderPrompt } from "../src/index.ts";

describe("prompts", () => {
  it("embeds the up-to-date prompts/*.md files", () => {
    for (const name of PROMPT_NAMES) {
      const file = readFileSync(join(import.meta.dirname, "..", "prompts", `${name}.md`), "utf8");
      expect(
        DEFAULT_PROMPTS[name],
        `prompts/${name}.md changed: run pnpm --filter @openeugenia/ai prompts`,
      ).toBe(file);
    }
    expect(PROMPT_NAMES.sort()).toEqual([
      "ask",
      "categories",
      "categorize",
      "discuss",
      "evaluate",
      "extract",
      "flashcards",
      "index-source",
      "note",
      "summarize",
    ]);
  });

  it("replaces variables", () => {
    const text = renderPrompt("discuss", {}, { wiki_title: "My wiki", today: "2026-11-17" });
    expect(text).toContain('("My wiki")');
    expect(text).toContain("Today is 2026-11-17");
    expect(text).not.toContain("{{");
  });

  it("uses a wiki override, without its frontmatter", () => {
    const text = renderPrompt(
      "evaluate",
      { evaluate: "---\nversion: 2\n---\nBe strict with {{wiki_title}}." },
      { wiki_title: "W" },
    );
    expect(text).toBe("Be strict with W.");
  });
});

describe("JSON extraction", () => {
  it("reads raw JSON, surrounded by text or in a code block", () => {
    expect(extractJson('{"a": 1}')).toEqual({ a: 1 });
    expect(extractJson('Here: {"a": {"b": "}"}} end')).toEqual({ a: { b: "}" } });
    expect(extractJson('```json\n{"a": [1, 2]}\n```')).toEqual({ a: [1, 2] });
    expect(() => extractJson("nothing")).toThrow();
  });
});
