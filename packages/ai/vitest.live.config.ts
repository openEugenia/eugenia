/**
 * Tests contre de vraies API d'IA (`pnpm test:live`), hors de `pnpm test` : lents, soumis aux
 * quotas des fournisseurs. Les clés sont lues dans le `.env` de la racine du dépôt, s'il existe.
 */
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { defineConfig } from "vitest/config";

function rootDotEnv(): Record<string, string> {
  try {
    return parseEnv(readFileSync(new URL("../../.env", import.meta.url), "utf8")) as Record<
      string,
      string
    >;
  } catch {
    return {};
  }
}

export default defineConfig({
  test: {
    name: "ai-live",
    include: ["test/live/**/*.test.ts"],
    env: rootDotEnv(),
    // Une requête refusée par le quota (429) est rejouée jusqu'à quatre fois, à 20 s d'écart.
    testTimeout: 150_000,
  },
});
