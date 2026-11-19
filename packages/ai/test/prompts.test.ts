import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_PROMPTS, extractJson, PROMPT_NAMES, renderPrompt } from "../src/index.ts";

describe("prompts", () => {
  it("embarque les fichiers prompts/*.md à jour", () => {
    for (const name of PROMPT_NAMES) {
      const file = readFileSync(join(import.meta.dirname, "..", "prompts", `${name}.md`), "utf8");
      expect(
        DEFAULT_PROMPTS[name],
        `prompts/${name}.md a changé : lancez pnpm --filter @openeugenia/ai prompts`,
      ).toBe(file);
    }
    expect(PROMPT_NAMES.sort()).toEqual([
      "ask",
      "categories",
      "discuss",
      "evaluate",
      "extract",
      "flashcards",
      "note",
      "summarize",
    ]);
  });

  it("remplace les variables", () => {
    const text = renderPrompt("discuss", {}, { wiki_title: "Mon wiki", today: "2026-11-17" });
    expect(text).toContain("« Mon wiki »");
    expect(text).toContain("Nous sommes le 2026-11-17");
    expect(text).not.toContain("{{");
  });

  it("utilise une surcharge du wiki, sans son frontmatter", () => {
    const text = renderPrompt(
      "evaluate",
      { evaluate: "---\nversion: 2\n---\nSois sévère avec {{wiki_title}}." },
      { wiki_title: "W" },
    );
    expect(text).toBe("Sois sévère avec W.");
  });
});

describe("extraction de JSON", () => {
  it("lit un JSON brut, entouré de texte ou dans un bloc de code", () => {
    expect(extractJson('{"a": 1}')).toEqual({ a: 1 });
    expect(extractJson('Voici : {"a": {"b": "}"}} fin')).toEqual({ a: { b: "}" } });
    expect(extractJson('```json\n{"a": [1, 2]}\n```')).toEqual({ a: [1, 2] });
    expect(() => extractJson("rien")).toThrow();
  });
});
