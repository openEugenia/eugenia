// Builds the CLI into a single executable file (dependencies included), usable by the GitHub
// Action without any extra installation.
import { build } from "esbuild";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/eugenia.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: false,
  legalComments: "none",
  define: { __EUGENIA_VERSION__: JSON.stringify(pkg.version) },
  banner: {
    js: [
      "#!/usr/bin/env node",
      "import { createRequire as __createRequire } from 'node:module';",
      "const require = __createRequire(import.meta.url);",
    ].join("\n"),
  },
  logLevel: "info",
});
