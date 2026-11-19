import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "ai",
    include: ["test/**/*.test.ts"],
    // Tests contre de vraies API : `pnpm test:live` (voir vitest.live.config.ts).
    exclude: [...configDefaults.exclude, "test/live/**"],
  },
});
