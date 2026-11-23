/**
 * Publication: builds the tree of the public repository from the private repository (§6).
 * Only public nodes (wiki and library) and public discussions are published. A private
 * source is published as its bibliographic record only (title, kind, authors, date, URL),
 * so that public knowledge can still cite it. Links and references to anything else that is
 * not published disappear; the personal files of sources and quizzes are never published.
 */
import { CONFIG_PATH, INDEX_JSON_PATH, serializePublicConfig } from "./config.ts";
import {
  discussionMeta,
  parseDiscussion,
  serializeDiscussion,
  type DiscussionDocument,
} from "./discussion.ts";
import { unlinkTargets } from "./links.ts";
import { firstParagraph, truncate } from "./markdown.ts";
import type { WikiView } from "./operations.ts";
import {
  DESCRIPTION_LENGTH,
  parsePage,
  serializePage,
  shortDescription,
  type PageDocument,
  type PageFields,
} from "./pages.ts";
import { joinPath, normalizePath } from "./paths.ts";
import { gitBlobSha } from "./sha.ts";
import { needsSummary, parseSummary, serializeSummary, type SummaryDocument } from "./summaries.ts";
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
  /** Private repository to declare in the public configuration (`owner/name`). */
  privateRepo?: string;
  /** Target public repository, for the generated README. */
  publicRepo?: string;
  /** URL of the application. */
  appUrl?: string;
  now?: Date;
}

export interface PublicationStats {
  pages: number;
  knowledge: number;
  flashcards: number;
  sources: number;
  /** Private sources published as their bibliographic record only. */
  records: number;
  attachments: number;
  summaries: number;
  discussions: number;
  /** Indexes of public sources (`_index/`). */
  indexes: number;
}

export interface Publication {
  files: PublishedFile[];
  index: WikiIndex;
  problems: Problem[];
  /** False if an error blocks the publication. */
  ok: boolean;
  stats: PublicationStats;
}

export const DEFAULT_APP_URL = "https://openeugenia.github.io/eugenia/";

function publicReadme(title: string, publicRepo: string | undefined, appUrl: string): string {
  const link = publicRepo ? `${appUrl}?repo=${publicRepo}` : appUrl;
  return [
    `# ${title}`,
    "",
    "This repository holds the **public** part of an [Eugenia](https://github.com/openEugenia/eugenia) personal knowledge wiki.",
    "",
    `Browse it here: <${link}>`,
    "",
    "It is generated automatically on every publication: do not edit it by hand, your changes would be overwritten.",
    "",
  ].join("\n");
}

/**
 * Bibliographic record of a private source: the only fields of a private source that are
 * published. Its content, personal file, tags and any other key stay private.
 */
export function sourceRecord(doc: PageDocument, publicCategory?: boolean): PageDocument {
  const f = doc.fields;
  const fields: PageFields = { id: f.id, type: "source", title: f.title, visibility: "private" };
  if (f.kind) fields.kind = f.kind;
  // The category of a private source is only published if the category itself is.
  if (f.category && publicCategory) fields.category = f.category;
  if (f.authors?.length) fields.authors = f.authors;
  if (f.published) fields.published = f.published;
  if (f.url) fields.url = f.url;
  return { fields, extra: {}, body: "" };
}

/** True if a node is a private library source, published as its bibliographic record. */
export function isSourceRecord(tree: WikiTree, node: WikiNode): boolean {
  return node.type === "source" && !node.virtual && !node.isPublic && node.id !== tree.libraryId;
}

export async function buildPublication(
  source: WikiView,
  options: PublishOptions = {},
): Promise<Publication> {
  const { tree, config } = source;
  const problems: Problem[] = [];
  const stats: PublicationStats = {
    pages: 0,
    knowledge: 0,
    flashcards: 0,
    sources: 0,
    records: 0,
    attachments: 0,
    summaries: 0,
    discussions: 0,
    indexes: 0,
  };

  // Rule 3 and tree consistency.
  for (const problem of tree.problems) {
    if (problem.code === "public-under-private" || problem.code === "duplicate-id") {
      problems.push({ ...problem, level: "error" });
    } else if (problem.code === "invalid-frontmatter") {
      const node = problem.path ? nodeForPath(tree, problem.path) : undefined;
      if (node?.isPublic) {
        problems.push({
          ...problem,
          level: "error",
          message: `${problem.message} Uncertain visibility: publication refused.`,
        });
      }
    }
  }

  // The library root is a container: its page is only published if it is public.
  const publicNodes = [...tree.nodes.values()].filter(
    (n) => n.isPublic && (n.id !== tree.libraryId || n.visibility === "public"),
  );
  const published = new Set<string>();
  const personal = new Map<string, Set<string>>();
  const pageDocs = new Map<string, PageDocument>();
  const records = new Map<string, PageDocument>();
  const publicSummaries = new Map<string, SummaryDocument>();
  const publicDiscussions = new Map<string, DiscussionDocument>();

  // 1. What will be published (needed to filter links).
  for (const node of publicNodes) {
    const personalFiles = new Set<string>();
    if (!node.virtual) {
      const doc = parsePage(await source.readText(node.indexPath));
      pageDocs.set(node.id, doc);
      if (doc.fields.file) personalFiles.add(normalizePath(joinPath(node.path, doc.fields.file)));
      published.add(node.indexPath);
    }
    personal.set(node.id, personalFiles);
    for (const attachment of node.attachments) {
      if (!personalFiles.has(attachment.path)) published.add(attachment.path);
    }
    // The index of a public source only describes its (public) content: it is published, so
    // that questions about the public part can use it. Its embeddings never are.
    if (node.type === "source") {
      for (const page of node.sourceIndex?.pages ?? []) published.add(page.path);
    }
    if (node.summaries.public) {
      const summary = parseSummary(await source.readText(node.summaries.public.path));
      const summaryProblems = publicSummaryProblems(tree, node, summary);
      problems.push(...summaryProblems);
      if (summaryProblems.length === 0) {
        publicSummaries.set(node.id, summary);
        published.add(joinPath(node.path, SUMMARY_FILE));
      }
    } else if (needsSummary(tree, node, "public")) {
      problems.push({
        level: "warning",
        code: "missing-public-summary",
        message: `"${node.title}" has no public description (_summary.public.md).`,
        nodeId: node.id,
        path: node.path,
      });
    }
  }
  // Private sources: their bibliographic record only, without content or attached files.
  for (const node of tree.nodes.values()) {
    if (!isSourceRecord(tree, node)) continue;
    const doc = parsePage(await source.readText(node.indexPath));
    if (doc.error || !doc.fields.id) {
      problems.push({
        level: "warning",
        code: "unreadable-source-record",
        message: `The private source "${node.title}" cannot be read: its bibliographic record is not published.`,
        nodeId: node.id,
        path: node.indexPath,
      });
      continue;
    }
    const category = doc.fields.category ? tree.nodes.get(doc.fields.category) : undefined;
    records.set(node.id, sourceRecord(doc, category?.isPublic === true));
    published.add(node.indexPath);
  }
  // Discussions: private by default, quizzes are never published.
  for (const file of tree.discussions) {
    const doc = parseDiscussion(await source.readText(file.path));
    if (doc.fields.visibility === "public" && doc.fields.kind !== "quiz") {
      publicDiscussions.set(file.path, doc);
      published.add(file.path);
    }
  }
  const publicDiscussionIds = new Set([...publicDiscussions.values()].map((d) => d.fields.id));

  const isPublished = (target: string): boolean =>
    published.has(target) || published.has(joinPath(target, "index.md"));
  const keepPublicLinks = (content: string, path: string): string =>
    unlinkTargets(content, path, (target) => !isPublished(target));
  /** A published page: public, or a private source published as its record. */
  const isPublishedId = (id: string | undefined): boolean =>
    id !== undefined && (tree.nodes.get(id)?.isPublic === true || records.has(id));

  // 2. Transformed contents.
  const files: PublishedFile[] = [];
  const indexEntries = new Map<
    string,
    {
      id: string;
      description?: string;
      refs?: string[];
      sourced?: boolean;
      extracted_from?: string;
      category?: string;
    }
  >();
  for (const node of publicNodes) {
    const doc = pageDocs.get(node.id);
    if (doc) {
      // Personal file of a source: never published, not even its name.
      delete doc.fields.file;
      if (doc.fields.sources) {
        // A reference to an unpublished source disappears; free references stay.
        doc.fields.sources = doc.fields.sources.filter((s) =>
          s.ref ? isPublishedId(s.ref) : Boolean(s.description || s.url),
        );
        if (doc.fields.sources.length === 0) delete doc.fields.sources;
      }
      if (doc.fields.category && tree.nodes.get(doc.fields.category)?.isPublic !== true) {
        delete doc.fields.category;
      }
      const from = doc.fields.extracted_from;
      if (from && !isPublishedId(from) && !publicDiscussionIds.has(from)) {
        delete doc.fields.extracted_from;
      }
      doc.body = keepPublicLinks(doc.body, node.indexPath);
      files.push({ path: node.indexPath, content: serializePage(doc) });
      stats.pages++;
      if (node.type === "knowledge") stats.knowledge++;
      if (node.type === "flashcard") stats.flashcards++;
      if (node.type === "source") stats.sources++;
      const entry: {
        id: string;
        description?: string;
        refs?: string[];
        sourced?: boolean;
        extracted_from?: string;
        category?: string;
      } = { id: node.id };
      if (doc.fields.category) entry.category = doc.fields.category;
      const description = shortDescription(doc);
      if (description) entry.description = description;
      const refs = (doc.fields.sources ?? []).map((s) => s.ref).filter(Boolean) as string[];
      if (refs.length > 0) entry.refs = [...new Set(refs)];
      if (doc.fields.sources?.length) entry.sourced = true;
      if (doc.fields.extracted_from) entry.extracted_from = doc.fields.extracted_from;
      indexEntries.set(node.id, entry);
    }
    const personalFiles = personal.get(node.id) ?? new Set<string>();
    for (const attachment of node.attachments) {
      if (personalFiles.has(attachment.path)) continue;
      files.push({ path: attachment.path, copyFrom: attachment.path, sha: attachment.sha });
      stats.attachments++;
    }
    if (node.type === "source" && node.sourceIndex?.root && doc) {
      for (const page of node.sourceIndex.pages) {
        files.push({ path: page.path, copyFrom: page.path, sha: page.sha });
      }
      stats.indexes++;
    }
    const summary = publicSummaries.get(node.id);
    if (summary) {
      const path = joinPath(node.path, SUMMARY_FILE);
      summary.body = keepPublicLinks(summary.body, path);
      files.push({ path, content: serializeSummary(summary) });
      stats.summaries++;
      const description = truncate(firstParagraph(summary.body), DESCRIPTION_LENGTH);
      const entry = indexEntries.get(node.id);
      if (description && entry) entry.description = description;
    }
  }
  for (const [id, record] of records) {
    const node = tree.nodes.get(id)!;
    files.push({ path: node.indexPath, content: serializePage(record) });
    indexEntries.set(
      id,
      record.fields.category ? { id, category: record.fields.category } : { id },
    );
    stats.records++;
  }
  const indexDiscussions: { path: string; meta: ReturnType<typeof discussionMeta> }[] = [];
  for (const [path, doc] of publicDiscussions) {
    if (doc.fields.about && !isPublishedId(doc.fields.about)) delete doc.fields.about;
    if (doc.fields.scope_node && !isPublishedId(doc.fields.scope_node)) {
      delete doc.fields.scope_node;
    }
    for (const message of doc.messages) message.content = keepPublicLinks(message.content, path);
    const content = serializeDiscussion(doc);
    files.push({ path, content });
    indexDiscussions.push({ path, meta: discussionMeta(content) });
    stats.discussions++;
  }

  // 3. Public configuration, README, index.
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
  const index = buildIndex({
    config,
    tree,
    files: listed,
    nodes: indexEntries.values(),
    discussions: indexDiscussions,
    ...(options.now ? { now: options.now } : {}),
  });
  files.push({ path: INDEX_JSON_PATH, content: JSON.stringify(index, null, 2) + "\n" });

  return { files, index, problems, ok: !problems.some((p) => p.level === "error"), stats };
}

/**
 * A public description must only depend on public nodes (§6.3). A private source is a
 * leak (blocking error); an unknown source (deleted node) sets the description aside without
 * blocking the publication. Without any problem, the description can be published.
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
        message: `The public description of "${node.title}" does not have the "public" scope.`,
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
        message: `The public description of "${node.title}" was generated from the private node "${sourceNode.title}": it will not be published until it is regenerated.`,
        nodeId: node.id,
        path,
      });
    } else if (!sourceNode) {
      problems.push({
        level: "warning",
        code: "summary-unknown-source",
        message: `The public description of "${node.title}" cites a node that no longer exists: it is left out of the publication, regenerate it.`,
        nodeId: node.id,
        path,
      });
    }
  }
  return problems;
}
