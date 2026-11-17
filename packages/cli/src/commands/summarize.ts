/** `eugenia summarize` : génère en lot les descriptions périmées ou manquantes (§11.2). */
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  gitBlobSha,
  needsSummary,
  newSummaryDocument,
  regenerationOrder,
  serializeSummary,
  summaryPath,
  summarySources,
  summaryInvolvesPrivate,
  summaryStates,
  ulid,
  type SummaryScope,
  type WikiNode,
} from "@openeugenia/core";
import {
  AIError,
  createProvider,
  loadPromptOverrides,
  summarizeNode,
  summaryInputFor,
  type AIProvider,
  type ProviderConfig,
  type ProviderKind,
} from "@openeugenia/ai";
import { loadDiskWiki, type DiskWiki } from "../fs-source.ts";
import { bold, CliError, dim, green, yellow, type Logger } from "../output.ts";

export interface SummarizeOptions {
  dir: string;
  scope: SummaryScope | "both";
  /** Identifiant ou dossier du nœud dont on traite la branche (racine par défaut). */
  node?: string;
  /** Régénère aussi les descriptions à jour (sauf verrouillées). */
  force: boolean;
  dryRun: boolean;
  provider?: ProviderKind;
  model?: string;
  baseUrl?: string;
  /** Refuse d'envoyer du contenu privé à un fournisseur distant. */
  localOnlyPrivate: boolean;
  /** Fournisseur injecté (tests). */
  providerInstance?: AIProvider;
}

export function providerFromEnvironment(
  options: Pick<SummarizeOptions, "provider" | "model" | "baseUrl">,
): ProviderConfig {
  const env = process.env;
  const kind =
    options.provider ??
    (env.EUGENIA_AI_PROVIDER as ProviderKind | undefined) ??
    (env.OPENAI_API_KEY && !env.ANTHROPIC_API_KEY ? "openai" : "anthropic");
  const model = options.model ?? env.EUGENIA_AI_MODEL;
  switch (kind) {
    case "anthropic":
      // Sans clé explicite, le SDK cherche ANTHROPIC_API_KEY ou un profil `ant auth login`.
      return {
        kind,
        ...(env.ANTHROPIC_API_KEY ? { apiKey: env.ANTHROPIC_API_KEY } : {}),
        ...(model ? { model } : {}),
      };
    case "openai":
      if (!model)
        throw new CliError(
          "Indiquez le modèle (--model ou EUGENIA_AI_MODEL) pour un fournisseur compatible OpenAI.",
        );
      return {
        kind,
        model,
        ...(env.OPENAI_API_KEY ? { apiKey: env.OPENAI_API_KEY } : {}),
        ...((options.baseUrl ?? env.OPENAI_BASE_URL)
          ? { baseUrl: options.baseUrl ?? env.OPENAI_BASE_URL! }
          : {}),
      };
    case "ollama":
      return {
        kind,
        ...((model ?? env.OLLAMA_MODEL) ? { model: model ?? env.OLLAMA_MODEL! } : {}),
        ...((options.baseUrl ?? env.OLLAMA_BASE_URL)
          ? { baseUrl: options.baseUrl ?? env.OLLAMA_BASE_URL! }
          : {}),
      };
    default:
      throw new CliError(`Fournisseur inconnu : ${String(kind)} (anthropic, openai ou ollama).`);
  }
}

function findBranch(wiki: DiskWiki, node: string | undefined): WikiNode {
  if (!node) return wiki.tree.nodes.get(wiki.tree.rootId)!;
  const found =
    wiki.tree.nodes.get(node) ??
    wiki.tree.byPath.get(node.replace(/\/+$/, "")) ??
    [...wiki.tree.nodes.values()].find((n) => n.title.toLowerCase() === node.toLowerCase());
  if (!found) throw new CliError(`Nœud introuvable : ${node}`);
  return found;
}

/** Nœuds d'une branche ayant besoin d'une description, des plus profonds vers la racine. */
function allNeeding(wiki: DiskWiki, branch: WikiNode, scope: SummaryScope): WikiNode[] {
  const out: WikiNode[] = [];
  const visit = (node: WikiNode): void => {
    for (const id of node.childIds) visit(wiki.tree.nodes.get(id)!);
    if (needsSummary(wiki.tree, node, scope)) out.push(node);
  };
  visit(branch);
  return out;
}

export async function summarizeCommand(options: SummarizeOptions, log: Logger): Promise<number> {
  const wiki = await loadDiskWiki(resolve(options.dir));
  const provider = options.providerInstance ?? createProvider(providerFromEnvironment(options));
  const prompts = await loadPromptOverrides(wiki.files.keys(), wiki.readText);
  const context = { provider, prompts, variables: { wiki_title: wiki.config.title } };
  const branch = findBranch(wiki, options.node);
  const scopes: SummaryScope[] = options.scope === "both" ? ["private", "public"] : [options.scope];
  let generated = 0;
  let skipped = 0;
  let warned = false;

  for (const scope of scopes) {
    const states = summaryStates(wiki.tree, scope, wiki.summaries);
    const plan = options.force
      ? allNeeding(wiki, branch, scope).filter((n) => states.get(n.id)?.status !== "locked")
      : regenerationOrder(wiki.tree, states, branch.id);
    if (plan.length === 0) {
      log.info(dim(`Portée ${scope} : aucune description à générer.`));
      continue;
    }
    log.info(bold(`Portée ${scope} : ${plan.length} description(s) à générer.`));
    for (const node of plan) {
      const isPrivate = summaryInvolvesPrivate(wiki.tree, node, scope);
      if (isPrivate && !provider.info.local) {
        if (options.localOnlyPrivate) {
          log.warn(
            yellow(
              `  ignoré « ${node.title} » : contenu privé et fournisseur distant (--local-only-private).`,
            ),
          );
          skipped++;
          continue;
        }
        if (!warned) {
          log.warn(
            yellow(
              `Du contenu privé va être envoyé à ${provider.info.label} (${provider.info.model}).`,
            ),
          );
          warned = true;
        }
      }
      let text: string;
      try {
        text = await summarizeNode(
          context,
          await summaryInputFor(wiki.view, node.id, scope, wiki.summaries),
        );
      } catch (error) {
        if (error instanceof AIError) throw new CliError(`« ${node.title} » : ${error.message}`);
        throw error;
      }
      const path = summaryPath(node, scope);
      const existing = wiki.summaries.get(path);
      const doc = newSummaryDocument({
        id: existing?.fields.id || ulid(),
        scope,
        body: text,
        sources: summarySources(wiki.tree, node, scope),
        model: provider.info.model,
      });
      const content = serializeSummary(doc);
      if (options.dryRun) {
        log.info(`\n${bold(node.title)} ${dim(path)}\n${text}\n`);
      } else {
        await writeFile(join(wiki.dir, path), content);
        // L'empreinte du parent dépend de cette nouvelle description : on met l'arbre à jour.
        const file = { path, sha: await gitBlobSha(content) };
        if (scope === "public") node.summaries.public = file;
        else node.summaries.private = file;
        wiki.files.set(path, file);
        wiki.summaries.set(path, doc);
        log.info(`  ${green("écrit")} ${path}`);
      }
      generated++;
    }
  }
  log.info(
    bold(
      `${generated} description(s) ${options.dryRun ? "générée(s) (simulation)" : "écrite(s)"}${skipped ? `, ${skipped} ignorée(s)` : ""}.`,
    ),
  );
  if (!options.dryRun && generated > 0)
    log.info(dim("Relisez-les (git diff) avant de les commiter."));
  return 0;
}
