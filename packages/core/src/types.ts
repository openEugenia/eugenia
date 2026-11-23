/** Shared types of the data model (specification §5). */

/** Node types stored in the repository. */
export type NodeType = PageType | "summary" | "discussion";

/**
 * Page types: nodes stored as a folder containing an `index.md`.
 * - wiki: `category` (sub-wiki) → `knowledge` (atomic knowledge) → `flashcard`;
 * - library: `source`.
 */
export type PageType = "category" | "knowledge" | "flashcard" | "source";

export const PAGE_TYPES: readonly PageType[] = ["category", "knowledge", "flashcard", "source"];

/** Repository spaces that contain pages (§5.1). */
export type Space = "wiki" | "library";

/** Kind of a library source. */
export type SourceKind = "book" | "article" | "web" | "video" | "audio" | "document" | "other";

export const SOURCE_KINDS: readonly SourceKind[] = [
  "book",
  "article",
  "web",
  "video",
  "audio",
  "document",
  "other",
];

export function parseSourceKind(value: unknown): SourceKind | undefined {
  return typeof value === "string" && (SOURCE_KINDS as readonly string[]).includes(value)
    ? (value as SourceKind)
    : undefined;
}

/** Discussion kinds (§5.6): free discussion, question about the tree, quiz, quick note. */
export type DiscussionKind = "discussion" | "question" | "quiz" | "note";

export const DISCUSSION_KINDS: readonly DiscussionKind[] = [
  "discussion",
  "question",
  "quiz",
  "note",
];

export function parseDiscussionKind(value: unknown): DiscussionKind {
  return typeof value === "string" && (DISCUSSION_KINDS as readonly string[]).includes(value)
    ? (value as DiscussionKind)
    : "discussion";
}

export type Visibility = "public" | "private";

/** Scope of a sub-wiki description (§5.5, §6.3). */
export type SummaryScope = "private" | "public";

/**
 * Reference from a knowledge item to a source (§5.7): preferably a library source (`ref`),
 * otherwise a plain description or URL.
 */
export interface SourceRef {
  /** Identifier of a library source. */
  ref?: string;
  /** Location in the source: page, chapter, timestamp… */
  locator?: string;
  description?: string;
  url?: string;
}

/** Repository file: POSIX path relative to the root and git blob SHA. */
export interface RepoFile {
  path: string;
  sha: string;
  size?: number;
}

/** File change produced by editing operations. */
export type FileChange =
  | { op: "write"; path: string; content: string }
  | { op: "write-binary"; path: string; base64: string }
  /** Copy of an existing blob (a move without re-sending the content). */
  | { op: "copy"; path: string; from: string; sha: string }
  | { op: "delete"; path: string };

export type ProblemLevel = "error" | "warning";

/** Problem found while building the tree or validating. */
export interface Problem {
  level: ProblemLevel;
  code: string;
  message: string;
  path?: string;
  nodeId?: string;
}

/** Reads the text files of a repository. */
export type TextReader = (path: string) => Promise<string>;
