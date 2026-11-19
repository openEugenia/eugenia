/** Types partagés du modèle de données (spécification §5). */

/** Types de nœuds stockés dans le dépôt. */
export type NodeType = PageType | "summary" | "discussion";

/**
 * Types de pages : nœuds représentés par un dossier contenant un `index.md`.
 * - wiki : `category` (sous-wiki) → `knowledge` (connaissance atomique) → `flashcard` ;
 * - bibliothèque : `source`.
 */
export type PageType = "category" | "knowledge" | "flashcard" | "source";

export const PAGE_TYPES: readonly PageType[] = ["category", "knowledge", "flashcard", "source"];

/** Espaces du dépôt qui contiennent des pages (§5.1). */
export type Space = "wiki" | "library";

/** Nature d'une source de la bibliothèque. */
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

/** Sortes de discussions (§5.6) : discussion libre, question sur l'arbre, quiz, note rapide. */
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

/** Portée d'une description de sous-wiki (§5.5, §6.3). */
export type SummaryScope = "private" | "public";

/**
 * Référence d'une connaissance à une source (§5.7) : de préférence une source de la
 * bibliothèque (`ref`), sinon une simple description ou adresse.
 */
export interface SourceRef {
  /** Identifiant d'une source de la bibliothèque. */
  ref?: string;
  /** Localisation dans la source : page, chapitre, minutage… */
  locator?: string;
  description?: string;
  url?: string;
}

/** Fichier du dépôt : chemin POSIX relatif à la racine et SHA du blob git. */
export interface RepoFile {
  path: string;
  sha: string;
  size?: number;
}

/** Modification d'un fichier, produite par les opérations d'édition. */
export type FileChange =
  | { op: "write"; path: string; content: string }
  | { op: "write-binary"; path: string; base64: string }
  /** Copie d'un blob existant (déplacement sans renvoyer le contenu). */
  | { op: "copy"; path: string; from: string; sha: string }
  | { op: "delete"; path: string };

export type ProblemLevel = "error" | "warning";

/** Problème détecté lors de la construction de l'arbre ou de la validation. */
export interface Problem {
  level: ProblemLevel;
  code: string;
  message: string;
  path?: string;
  nodeId?: string;
}

/** Lecture des fichiers texte d'un dépôt. */
export type TextReader = (path: string) => Promise<string>;
