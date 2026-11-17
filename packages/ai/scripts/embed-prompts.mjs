#!/usr/bin/env node
// Embarque les prompts (prompts/*.md) dans src/prompts/defaults.generated.ts, pour qu'ils
// soient utilisables dans le navigateur comme dans la CLI sans accès au système de fichiers.
// Usage : node scripts/embed-prompts.mjs [--check]
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const promptsDir = join(here, "..", "prompts");
const target = join(here, "..", "src", "prompts", "defaults.generated.ts");

const names = readdirSync(promptsDir)
  .filter((f) => f.endsWith(".md") && f !== "README.md")
  .map((f) => f.slice(0, -3))
  .sort();

const entries = names.map((name) => {
  const text = readFileSync(join(promptsDir, `${name}.md`), "utf8");
  return `  ${JSON.stringify(name)}: ${JSON.stringify(text)},`;
});

const output = `// Généré par scripts/embed-prompts.mjs à partir de prompts/*.md : ne pas modifier.
export const DEFAULT_PROMPTS = {
${entries.join("\n")}
} as const;

export type PromptName = keyof typeof DEFAULT_PROMPTS;
`;

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(target, "utf8");
  } catch {
    // absent
  }
  if (current !== output) {
    console.error(
      "Les prompts embarqués ne sont pas à jour : lancez `pnpm --filter @openeugenia/ai prompts`.",
    );
    process.exit(1);
  }
  console.log("Prompts embarqués à jour.");
} else {
  writeFileSync(target, output);
  console.log(`${names.length} prompts embarqués dans ${target}.`);
}
