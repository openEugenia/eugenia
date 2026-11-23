/** Entry point of the `eugenia` CLI. */
import { parseArgs, type ParseArgsConfig } from "node:util";
import type { SummaryScope } from "@openeugenia/core";
import type { ProviderKind } from "@openeugenia/ai";
import { embedCommand } from "./commands/embed.ts";
import { indexCommand } from "./commands/index-sources.ts";
import { initCommand } from "./commands/init.ts";
import { publishCommand } from "./commands/publish.ts";
import { summarizeCommand } from "./commands/summarize.ts";
import { validateCommand } from "./commands/validate.ts";
import { CliError, consoleLogger, red, type Logger } from "./output.ts";

declare const __EUGENIA_VERSION__: string | undefined;
const VERSION = typeof __EUGENIA_VERSION__ === "string" ? __EUGENIA_VERSION__ : "dev";

const HELP = `eugenia ${VERSION} — a personal knowledge wiki, on git

Usage: eugenia <command> [folder] [options]

Commands:
  init [folder]         Creates a wiki: configuration, root and default categories.
      --title <title>          Title of the wiki (default: "My wiki")
      --root <folder>          Root folder of the pages (default: wiki)
      --no-categories          Does not create the default categories
      --github                 Also creates the private and public repositories, the deploy
                               key and the publication secret (requires gh and ssh-keygen)
      --private-repo <o/n>     Private repository (default with --github: <account>/eugenia-wiki)
      --public-repo <o/n>      Public repository (default: <private repository>-public)
      --action <ref>           Publication action (default: openEugenia/eugenia@v1)
      --force                  Overwrites existing files
      --dry-run                Shows what would be done

  validate [folder]     Checks the format (frontmatter, identifiers, visibility, links…).
      --json                   Result in JSON format
      --no-links               Does not check internal links

  publish [folder]      Publishes the public nodes to the public repository (a single commit).
      --target <o/n>           Target public repository
      --out <folder>           Also writes the public tree to this empty folder
      --branch <name>          Target branch (default: main)
      --private-repo <o/n>     Private repository to declare in the public configuration
      --token-env <VAR>        Variable holding a write token (default:
                               EUGENIA_PUBLISH_TOKEN; otherwise SSH / deploy key)
      --remote <url>           Explicit git URL of the target repository
      --dry-run                Builds and checks without pushing

  summarize [folder]    Generates the stale or missing sub-wiki descriptions.
      --stale                  Stale or missing descriptions (default)
      --force                  Also regenerates fresh descriptions (except locked ones)
      --node <id|folder>       Limits to one branch
      --scope <private|public|both>   Scope (default: both)
      --provider <anthropic|openai|ollama>   Provider (default: anthropic, or the variables
                               EUGENIA_AI_PROVIDER, ANTHROPIC_API_KEY, OPENAI_API_KEY)
      --model <model>          Model (Anthropic default: claude-opus-5-5)
      --base-url <url>         Server URL (OpenAI-compatible, Ollama)
      --local-only-private     Never sends private content to a remote provider
      --dry-run                Shows the descriptions without writing them

  index [folder]        Generates the missing or stale source indexes: a large model reads
                        each source and describes its whole content as a knowledge tree
                        (_tree.json), then read at low cost to answer questions.
      --force                  Also regenerates current indexes
      --node <id|folder>       One source, or the sources filed in a category
      --model <model>          Model (default: mistral-large-latest, or EUGENIA_INDEX_MODEL)
      --base-url <url>         OpenAI-compatible server (default: Mistral, or
                               EUGENIA_INDEX_BASE_URL); key MISTRAL_API_KEY or
                               EUGENIA_INDEX_API_KEY
      --local-only-private     Never sends private content to a remote provider
      --dry-run                Shows the sources concerned without calling the model

  embed [folder]        Computes the missing or stale embeddings (search by meaning) of the
                        pages, discussions and sections of the source indexes; never published.
      --force                  Also recomputes current embeddings
      --node <id|folder>       Limits to one branch (with its sources and discussions)
      --model <model>          Model (default: mistral-embed, or EUGENIA_EMBED_MODEL)
      --base-url <url>         OpenAI-compatible server (default: Mistral, or
                               EUGENIA_EMBED_BASE_URL); key MISTRAL_API_KEY or
                               EUGENIA_EMBED_API_KEY
      --local-only-private     Never sends private content to a remote provider
      --dry-run                Shows the pages concerned without calling the model

  help                  Shows this help.
  version               Shows the version.
`;

type Options = NonNullable<ParseArgsConfig["options"]>;

function parse(
  args: string[],
  options: Options,
): { values: Record<string, string | boolean | undefined>; dir: string } {
  try {
    const { values, positionals } = parseArgs({
      args,
      options,
      allowPositionals: true,
      allowNegative: true,
    });
    if (positionals.length > 1) throw new CliError(`Unexpected argument: ${positionals[1]}`);
    return {
      values: values as Record<string, string | boolean | undefined>,
      dir: positionals[0] ?? ".",
    };
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(error instanceof Error ? error.message : String(error), 2);
  }
}

const str = (v: string | boolean | undefined): string | undefined =>
  typeof v === "string" ? v : undefined;

export async function main(argv: string[], log: Logger = consoleLogger): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      log.info(HELP);
      return command === undefined ? 1 : 0;
    case "version":
    case "--version":
    case "-v":
      log.info(VERSION);
      return 0;
    case "init": {
      const { values, dir } = parse(rest, {
        title: { type: "string" },
        root: { type: "string" },
        categories: { type: "boolean", default: true },
        github: { type: "boolean", default: false },
        "private-repo": { type: "string" },
        "public-repo": { type: "string" },
        action: { type: "string" },
        branch: { type: "string", default: "main" },
        force: { type: "boolean", default: false },
        "dry-run": { type: "boolean", default: false },
      });
      const privateRepo = str(values["private-repo"]);
      const publicRepo = str(values["public-repo"]);
      const title = str(values.title);
      const root = str(values.root);
      const action = str(values.action);
      return initCommand(
        {
          dir,
          ...(title ? { title } : {}),
          ...(root !== undefined ? { root } : {}),
          categories: values.categories !== false,
          ...(privateRepo ? { privateRepo } : {}),
          ...(publicRepo ? { publicRepo } : {}),
          ...(action ? { actionRef: action } : {}),
          github: values.github === true,
          force: values.force === true,
          dryRun: values["dry-run"] === true,
          branch: str(values.branch) ?? "main",
        },
        log,
      );
    }
    case "validate": {
      const { values, dir } = parse(rest, {
        json: { type: "boolean", default: false },
        links: { type: "boolean", default: true },
      });
      return validateCommand(
        { dir, json: values.json === true, links: values.links !== false },
        log,
      );
    }
    case "publish": {
      const { values, dir } = parse(rest, {
        target: { type: "string" },
        out: { type: "string" },
        branch: { type: "string", default: "main" },
        "private-repo": { type: "string" },
        "token-env": { type: "string", default: "EUGENIA_PUBLISH_TOKEN" },
        remote: { type: "string" },
        message: { type: "string" },
        "dry-run": { type: "boolean", default: false },
      });
      const target = str(values.target);
      const out = str(values.out);
      const remote = str(values.remote);
      const privateRepo = str(values["private-repo"]);
      const message = str(values.message);
      return publishCommand(
        {
          dir,
          ...(target ? { target } : {}),
          ...(out ? { out } : {}),
          ...(remote ? { remote } : {}),
          ...(privateRepo ? { privateRepo } : {}),
          ...(message ? { message } : {}),
          branch: str(values.branch) ?? "main",
          tokenEnv: str(values["token-env"]) ?? "EUGENIA_PUBLISH_TOKEN",
          dryRun: values["dry-run"] === true,
        },
        log,
      );
    }
    case "summarize": {
      const { values, dir } = parse(rest, {
        stale: { type: "boolean", default: true },
        force: { type: "boolean", default: false },
        node: { type: "string" },
        scope: { type: "string", default: "both" },
        provider: { type: "string" },
        model: { type: "string" },
        "base-url": { type: "string" },
        "local-only-private": { type: "boolean", default: false },
        "dry-run": { type: "boolean", default: false },
      });
      const scope = str(values.scope) ?? "both";
      if (!["private", "public", "both"].includes(scope))
        throw new CliError("--scope: private, public or both.", 2);
      const provider = str(values.provider);
      if (provider && !["anthropic", "openai", "ollama"].includes(provider)) {
        throw new CliError("--provider: anthropic, openai or ollama.", 2);
      }
      const node = str(values.node);
      const model = str(values.model);
      const baseUrl = str(values["base-url"]);
      return summarizeCommand(
        {
          dir,
          scope: scope as SummaryScope | "both",
          force: values.force === true,
          dryRun: values["dry-run"] === true,
          localOnlyPrivate: values["local-only-private"] === true,
          ...(node ? { node } : {}),
          ...(provider ? { provider: provider as ProviderKind } : {}),
          ...(model ? { model } : {}),
          ...(baseUrl ? { baseUrl } : {}),
        },
        log,
      );
    }
    case "index": {
      const { values, dir } = parse(rest, {
        force: { type: "boolean", default: false },
        node: { type: "string" },
        model: { type: "string" },
        "base-url": { type: "string" },
        "local-only-private": { type: "boolean", default: false },
        "dry-run": { type: "boolean", default: false },
      });
      const node = str(values.node);
      const model = str(values.model);
      const baseUrl = str(values["base-url"]);
      return indexCommand(
        {
          dir,
          force: values.force === true,
          dryRun: values["dry-run"] === true,
          localOnlyPrivate: values["local-only-private"] === true,
          ...(node ? { node } : {}),
          ...(model ? { model } : {}),
          ...(baseUrl ? { baseUrl } : {}),
        },
        log,
      );
    }
    case "embed": {
      const { values, dir } = parse(rest, {
        force: { type: "boolean", default: false },
        node: { type: "string" },
        model: { type: "string" },
        "base-url": { type: "string" },
        "local-only-private": { type: "boolean", default: false },
        "dry-run": { type: "boolean", default: false },
      });
      const node = str(values.node);
      const model = str(values.model);
      const baseUrl = str(values["base-url"]);
      return embedCommand(
        {
          dir,
          force: values.force === true,
          dryRun: values["dry-run"] === true,
          localOnlyPrivate: values["local-only-private"] === true,
          ...(node ? { node } : {}),
          ...(model ? { model } : {}),
          ...(baseUrl ? { baseUrl } : {}),
        },
        log,
      );
    }
    default:
      throw new CliError(`Unknown command: ${command}. See "eugenia help".`, 2);
  }
}

const isEntry =
  typeof process !== "undefined" &&
  process.argv[1] !== undefined &&
  /eugenia(\.mjs)?$|main\.ts$/.test(process.argv[1]);
if (isEntry) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      if (error instanceof CliError) {
        console.error(red(error.message));
        process.exitCode = error.exitCode;
      } else {
        console.error(error);
        process.exitCode = 1;
      }
    },
  );
}
