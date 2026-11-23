/**
 * Tests against real AI APIs (`pnpm test:live`), outside `pnpm test`: slow, subject to the
 * providers' quotas. Keys are read from the `.env` file at the repository root, if it exists.
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
    // A request refused by the quota (429) is replayed up to four times, 20 s apart.
    testTimeout: 150_000,
  },
});
