/** Point d'entrée de la CLI `eugenia`. */
import { parseArgs, type ParseArgsConfig } from "node:util";
import type { SummaryScope } from "@openeugenia/core";
import type { ProviderKind } from "@openeugenia/ai";
import { embedCommand } from "./commands/embed.ts";
import { initCommand } from "./commands/init.ts";
import { publishCommand } from "./commands/publish.ts";
import { summarizeCommand } from "./commands/summarize.ts";
import { validateCommand } from "./commands/validate.ts";
import { CliError, consoleLogger, red, type Logger } from "./output.ts";

declare const __EUGENIA_VERSION__: string | undefined;
const VERSION = typeof __EUGENIA_VERSION__ === "string" ? __EUGENIA_VERSION__ : "dev";

const HELP = `eugenia ${VERSION} — wiki personnel de connaissances, sur git

Usage : eugenia <commande> [dossier] [options]

Commandes :
  init [dossier]        Crée un wiki : configuration, racine et catégories par défaut.
      --title <titre>          Titre du wiki (défaut : « Mon wiki »)
      --root <dossier>         Dossier racine des pages (défaut : wiki)
      --no-categories          Ne crée pas les catégories par défaut
      --github                 Crée aussi les dépôts privé et public, la clé de déploiement
                               et le secret de publication (nécessite gh et ssh-keygen)
      --private-repo <o/n>     Dépôt privé (défaut avec --github : <compte>/eugenia-wiki)
      --public-repo <o/n>      Dépôt public (défaut : <dépôt privé>-public)
      --action <ref>           Action de publication (défaut : openEugenia/eugenia@v1)
      --force                  Écrase les fichiers existants
      --dry-run                Affiche ce qui serait fait

  validate [dossier]    Vérifie le format (frontmatter, identifiants, visibilité, liens…).
      --json                   Résultat au format JSON
      --no-links               Ne vérifie pas les liens internes

  publish [dossier]     Publie les nœuds publics dans le dépôt public (un seul commit).
      --target <o/n>           Dépôt public cible
      --out <dossier>          Écrit aussi l'arborescence publique dans ce dossier vide
      --branch <nom>           Branche cible (défaut : main)
      --private-repo <o/n>     Dépôt privé à déclarer dans la configuration publique
      --token-env <VAR>        Variable contenant un jeton d'écriture (défaut :
                               EUGENIA_PUBLISH_TOKEN ; sinon SSH / clé de déploiement)
      --remote <url>           Adresse git explicite du dépôt cible
      --dry-run                Construit et vérifie sans pousser

  summarize [dossier]   Génère les descriptions de sous-wikis périmées ou manquantes.
      --stale                  Descriptions périmées ou manquantes (par défaut)
      --force                  Régénère aussi les descriptions à jour (sauf verrouillées)
      --node <id|dossier>      Limite à une branche
      --scope <private|public|both>   Portée (défaut : both)
      --provider <anthropic|openai|ollama>   Fournisseur (défaut : anthropic, ou variables
                               EUGENIA_AI_PROVIDER, ANTHROPIC_API_KEY, OPENAI_API_KEY)
      --model <modèle>         Modèle (défaut Anthropic : claude-opus-5-5)
      --base-url <url>         Adresse du serveur (OpenAI compatible, Ollama)
      --local-only-private     N'envoie jamais de contenu privé à un fournisseur distant
      --dry-run                Affiche les descriptions sans les écrire

  embed [dossier]       Calcule les embeddings des pages (recherche sémantique) manquants
                        ou périmés : un _embedding.json par page, jamais publié.
      --force                  Recalcule aussi les embeddings à jour
      --node <id|dossier>      Limite à une branche
      --model <modèle>         Modèle (défaut : mistral-embed, ou EUGENIA_EMBED_MODEL)
      --base-url <url>         Serveur compatible OpenAI (défaut : Mistral, ou
                               EUGENIA_EMBED_BASE_URL) ; clé MISTRAL_API_KEY ou
                               EUGENIA_EMBED_API_KEY
      --local-only-private     N'envoie jamais de contenu privé à un fournisseur distant
      --dry-run                Affiche les pages concernées sans appeler le modèle

  help                  Affiche cette aide.
  version               Affiche la version.
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
    if (positionals.length > 1) throw new CliError(`Argument inattendu : ${positionals[1]}`);
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
        throw new CliError("--scope : private, public ou both.", 2);
      const provider = str(values.provider);
      if (provider && !["anthropic", "openai", "ollama"].includes(provider)) {
        throw new CliError("--provider : anthropic, openai ou ollama.", 2);
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
      throw new CliError(`Commande inconnue : ${command}. Voir « eugenia help ».`, 2);
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
