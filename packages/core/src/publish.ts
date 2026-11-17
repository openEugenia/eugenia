/**
 * Publication : construction de l'arborescence du dépôt public à partir du dépôt privé
 * (§6). Seuls les nœuds publics sont publiés ; les liens vers ce qui n'est pas publié
 * deviennent du texte ; les fichiers personnels et les quiz ne sont jamais publiés.
 */
import { CONFIG_PATH, INDEX_JSON_PATH, serializePublicConfig } from "./config.ts";
import { parseDiscussion, serializeDiscussion, type DiscussionDocument } from "./discussion.ts";
import { unlinkTargets } from "./links.ts";
import { firstParagraph, truncate } from "./markdown.ts";
import type { WikiView } from "./operations.ts";
import {
  DESCRIPTION_LENGTH,
  parsePage,
  serializePage,
  shortDescription,
  type PageDocument,
} from "./pages.ts";
import { joinPath, normalizePath } from "./paths.ts";
import { gitBlobSha } from "./sha.ts";
import { parseSummary, serializeSummary, type SummaryDocument } from "./summaries.ts";
import {
  nodeForPath,
  PUBLIC_SUMMARY_FILE,
  SUMMARY_FILE,
  type WikiNode,
  type WikiTree,
} from "./tree.ts";
import type { Problem, RepoFile } from "./types.ts";
import { buildIndex, type WikiIndex } from "./wiki-index.ts";

export type PublishedFile =
  { path: string; content: string } | { path: string; copyFrom: string; sha: string };

export interface PublishOptions {
  /** Dépôt privé à déclarer dans la configuration publique (`owner/name`). */
  privateRepo?: string;
  /** Dépôt public cible, pour le README généré. */
  publicRepo?: string;
  /** Adresse de l'application. */
  appUrl?: string;
  now?: Date;
}

export interface PublicationStats {
  pages: number;
  flashcards: number;
  attachments: number;
  summaries: number;
  discussions: number;
}

export interface Publication {
  files: PublishedFile[];
  index: WikiIndex;
  problems: Problem[];
  /** Faux si une erreur bloque la publication. */
  ok: boolean;
  stats: PublicationStats;
}

export const DEFAULT_APP_URL = "https://openeugenia.github.io/eugenia/";

function publicReadme(title: string, publicRepo: string | undefined, appUrl: string): string {
  const link = publicRepo ? `${appUrl}?repo=${publicRepo}` : appUrl;
  return [
    `# ${title}`,
    "",
    "Ce dépôt contient la partie **publique** d'un wiki personnel de connaissances [Eugenia](https://github.com/openEugenia/eugenia).",
    "",
    `Pour le parcourir : <${link}>`,
    "",
    "Il est généré automatiquement à chaque publication : ne le modifiez pas à la main, vos changements seraient écrasés.",
    "",
  ].join("\n");
}

export async function buildPublication(
  source: WikiView,
  options: PublishOptions = {},
): Promise<Publication> {
  const { tree, config } = source;
  const problems: Problem[] = [];
  const stats: PublicationStats = {
    pages: 0,
    flashcards: 0,
    attachments: 0,
    summaries: 0,
    discussions: 0,
  };

  // Règle 3 et cohérence de l'arbre.
  for (const problem of tree.problems) {
    if (problem.code === "public-under-private" || problem.code === "duplicate-id") {
      problems.push({ ...problem, level: "error" });
    } else if (problem.code === "invalid-frontmatter") {
      const node = problem.path ? nodeForPath(tree, problem.path) : undefined;
      if (node?.isPublic) {
        problems.push({
          ...problem,
          level: "error",
          message: `${problem.message} Visibilité incertaine : publication refusée.`,
        });
      }
    }
  }

  const publicNodes = [...tree.nodes.values()].filter((n) => n.isPublic);
  const published = new Set<string>();
  const personal = new Map<string, Set<string>>();
  const pageDocs = new Map<string, PageDocument>();
  const publicSummaries = new Map<string, SummaryDocument>();
  const publicDiscussions = new Map<string, DiscussionDocument>();

  // 1. Ce qui sera publié (nécessaire pour filtrer les liens).
  for (const node of publicNodes) {
    const personalFiles = new Set<string>();
    if (!node.virtual) {
      const doc = parsePage(await source.readText(node.indexPath));
      pageDocs.set(node.id, doc);
      for (const s of doc.fields.sources ?? []) {
        if (s.file) personalFiles.add(normalizePath(joinPath(node.path, s.file)));
      }
      published.add(node.indexPath);
    }
    personal.set(node.id, personalFiles);
    for (const attachment of node.attachments) {
      if (!personalFiles.has(attachment.path)) published.add(attachment.path);
    }
    if (node.summaries.public) {
      const summary = parseSummary(await source.readText(node.summaries.public.path));
      const summaryProblems = publicSummaryProblems(tree, node, summary);
      problems.push(...summaryProblems);
      if (summaryProblems.length === 0) {
        publicSummaries.set(node.id, summary);
        published.add(joinPath(node.path, SUMMARY_FILE));
      }
    } else if (node.childIds.some((id) => tree.nodes.get(id)?.isPublic)) {
      problems.push({
        level: "warning",
        code: "missing-public-summary",
        message: `« ${node.title} » n'a pas de description publique (_summary.public.md).`,
        nodeId: node.id,
        path: node.path,
      });
    }
    for (const file of node.discussions) {
      const doc = parseDiscussion(await source.readText(file.path));
      if ((doc.fields.visibility ?? node.visibility) === "public" && doc.fields.kind !== "quiz") {
        publicDiscussions.set(file.path, doc);
        published.add(file.path);
      }
    }
  }

  const isPublished = (target: string): boolean =>
    published.has(target) || published.has(joinPath(target, "index.md"));
  const keepPublicLinks = (content: string, path: string): string =>
    unlinkTargets(content, path, (target) => !isPublished(target));
  const isPublicId = (id: string | undefined): boolean =>
    id !== undefined && tree.nodes.get(id)?.isPublic === true;

  // 2. Contenus transformés.
  const files: PublishedFile[] = [];
  const descriptions = new Map<string, string | undefined>();
  for (const node of publicNodes) {
    const doc = pageDocs.get(node.id);
    if (doc) {
      if (doc.fields.sources) {
        doc.fields.sources = doc.fields.sources
          .map((s) => {
            const copy = { ...s };
            delete copy.file;
            return copy;
          })
          .filter((s) => s.description || s.url);
      }
      if (doc.fields.extracted_from && !isPublicId(doc.fields.extracted_from)) {
        delete doc.fields.extracted_from;
      }
      doc.body = keepPublicLinks(doc.body, node.indexPath);
      files.push({ path: node.indexPath, content: serializePage(doc) });
      stats.pages++;
      if (node.type === "flashcard") stats.flashcards++;
      descriptions.set(node.id, shortDescription(doc));
    }
    const personalFiles = personal.get(node.id) ?? new Set<string>();
    for (const attachment of node.attachments) {
      if (personalFiles.has(attachment.path)) continue;
      files.push({ path: attachment.path, copyFrom: attachment.path, sha: attachment.sha });
      stats.attachments++;
    }
    const summary = publicSummaries.get(node.id);
    if (summary) {
      const path = joinPath(node.path, SUMMARY_FILE);
      summary.body = keepPublicLinks(summary.body, path);
      files.push({ path, content: serializeSummary(summary) });
      stats.summaries++;
      const description = truncate(firstParagraph(summary.body), DESCRIPTION_LENGTH);
      if (description) descriptions.set(node.id, description);
    }
  }
  for (const [path, doc] of publicDiscussions) {
    if (doc.fields.about && !isPublicId(doc.fields.about)) delete doc.fields.about;
    for (const message of doc.messages) message.content = keepPublicLinks(message.content, path);
    files.push({ path, content: serializeDiscussion(doc) });
    stats.discussions++;
  }

  // 3. Configuration publique, README, index.
  const publicConfigOptions = options.privateRepo ?? config.private_repo;
  files.push({ path: CONFIG_PATH, content: serializePublicConfig(config, publicConfigOptions) });
  if (config.root !== "" && !files.some((f) => f.path === "README.md")) {
    files.push({
      path: "README.md",
      content: publicReadme(config.title, options.publicRepo, options.appUrl ?? DEFAULT_APP_URL),
    });
  }

  const listed: RepoFile[] = [];
  for (const file of files) {
    if ("content" in file) {
      const size = new TextEncoder().encode(file.content).byteLength;
      listed.push({ path: file.path, sha: await gitBlobSha(file.content), size });
    } else {
      const size = source.files.get(file.copyFrom)?.size;
      listed.push(
        size === undefined
          ? { path: file.path, sha: file.sha }
          : { path: file.path, sha: file.sha, size },
      );
    }
  }
  const indexNodes = publicNodes
    .filter((n) => !n.virtual)
    .map((n) => {
      const description = descriptions.get(n.id);
      return description ? { id: n.id, description } : { id: n.id };
    });
  const index = buildIndex({
    config,
    tree,
    files: listed,
    nodes: indexNodes,
    ...(options.now ? { now: options.now } : {}),
  });
  files.push({ path: INDEX_JSON_PATH, content: JSON.stringify(index, null, 2) + "\n" });

  return { files, index, problems, ok: !problems.some((p) => p.level === "error"), stats };
}

/**
 * Une description publique ne doit dépendre que de nœuds publics (§6.3). Une source
 * privée est une fuite (erreur bloquante) ; une source inconnue (nœud supprimé) fait
 * écarter la description, sans bloquer la publication. Sans problème, la description
 * peut être publiée.
 */
export function publicSummaryProblems(
  tree: WikiTree,
  node: WikiNode,
  summary: SummaryDocument,
): Problem[] {
  const path = node.summaries.public?.path ?? joinPath(node.path, PUBLIC_SUMMARY_FILE);
  if (summary.error) {
    return [
      { level: "error", code: "invalid-summary", message: summary.error, path, nodeId: node.id },
    ];
  }
  if (summary.fields.scope !== "public") {
    return [
      {
        level: "error",
        code: "summary-scope",
        message: `La description publique de « ${node.title} » n'a pas la portée « public ».`,
        nodeId: node.id,
        path,
      },
    ];
  }
  const problems: Problem[] = [];
  for (const id of Object.keys(summary.fields.sources)) {
    const sourceNode = tree.nodes.get(id);
    if (sourceNode && !sourceNode.isPublic) {
      problems.push({
        level: "error",
        code: "summary-leak",
        message: `La description publique de « ${node.title} » a été générée à partir du nœud privé « ${sourceNode.title} » : elle ne sera pas publiée tant qu'elle n'est pas régénérée.`,
        nodeId: node.id,
        path,
      });
    } else if (!sourceNode) {
      problems.push({
        level: "warning",
        code: "summary-unknown-source",
        message: `La description publique de « ${node.title} » cite un nœud qui n'existe plus : elle est écartée de la publication, régénérez-la.`,
        nodeId: node.id,
        path,
      });
    }
  }
  return problems;
}
