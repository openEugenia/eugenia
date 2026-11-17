/** Types partagés du modèle de données (spécification §5). */

/** Types de nœuds stockés dans le dépôt. */
export type NodeType = "note" | "summary" | "discussion" | "flashcard";

/** Types de pages : nœuds représentés par un dossier contenant un `index.md`. */
export type PageType = "note" | "flashcard";

export const PAGE_TYPES: readonly PageType[] = ["note", "flashcard"];

export type Visibility = "public" | "private";

/** Portée d'une description de sous-wiki (§5.5, §6.3). */
export type SummaryScope = "private" | "public";

/** Source d'une connaissance (§5.7). Le fichier personnel n'est jamais publié. */
export interface SourceRef {
  description?: string;
  url?: string;
  /** Fichier personnel joint, relatif au dossier du nœud. */
  file?: string;
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
