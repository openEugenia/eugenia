/**
 * Modifications locales en attente (§9.3, §10.3) : regroupées puis commitées en un seul
 * commit, ou placées dans une file quand le réseau manque. Fonctions pures, testées.
 */
import { base64ToBytes, gitBlobSha, ulid, type FileChange, type RepoFile } from "@openeugenia/core";

export interface PendingChange {
  path: string;
  kind: "write" | "delete" | "copy";
  /** Contenu texte (écriture). */
  content?: string;
  /** Contenu binaire en base64 (fichier joint). */
  base64?: string;
  /** SHA du blob copié (déplacement sans renvoyer le contenu). */
  fromSha?: string;
  /** SHA du blob résultant. */
  sha?: string;
  /** SHA distant au moment de la première modification (`null` : fichier nouveau). */
  baseSha: string | null;
  updatedAt: string;
}

export interface ChangeLogEntry {
  id: string;
  description: string;
  paths: string[];
  at: string;
}

export interface QueuedCommit {
  id: string;
  message: string;
  paths: string[];
  createdAt: string;
}

export interface Conflict {
  path: string;
  /** Contenu local (`null` : suppression locale). */
  local: string | null;
  /** Fichier binaire : seules les résolutions « local » ou « distant » sont possibles. */
  binary?: boolean;
  /** SHA et contenu distants (`null` : supprimé à distance). */
  remoteSha: string | null;
  remote: string | null;
}

export interface PendingState {
  changes: Record<string, PendingChange>;
  log: ChangeLogEntry[];
  queue: QueuedCommit[];
  conflicts: Conflict[];
  lastSyncAt?: string;
  lastError?: string;
}

export function emptyPending(): PendingState {
  return { changes: {}, log: [], queue: [], conflicts: [] };
}

/**
 * Ajoute des modifications aux changements en attente. Le SHA distant de référence est
 * celui du premier changement d'un fichier ; une modification qui revient au contenu
 * d'origine disparaît.
 */
export async function stageChanges(
  state: PendingState,
  changes: readonly FileChange[],
  remote: ReadonlyMap<string, RepoFile>,
  description: string,
  now: Date = new Date(),
): Promise<PendingState> {
  const next: PendingState = {
    ...state,
    changes: { ...state.changes },
    log: [...state.log],
  };
  const at = now.toISOString();
  for (const change of changes) {
    const existing = next.changes[change.path];
    const baseSha = existing ? existing.baseSha : (remote.get(change.path)?.sha ?? null);
    switch (change.op) {
      case "write": {
        const sha = await gitBlobSha(change.content);
        if (sha === baseSha) delete next.changes[change.path];
        else
          next.changes[change.path] = {
            path: change.path,
            kind: "write",
            content: change.content,
            sha,
            baseSha,
            updatedAt: at,
          };
        break;
      }
      case "write-binary": {
        const sha = await gitBlobSha(base64ToBytes(change.base64));
        if (sha === baseSha) delete next.changes[change.path];
        else
          next.changes[change.path] = {
            path: change.path,
            kind: "write",
            base64: change.base64,
            sha,
            baseSha,
            updatedAt: at,
          };
        break;
      }
      case "copy": {
        const source = next.changes[change.from];
        if (change.sha === baseSha) {
          delete next.changes[change.path];
        } else if (source?.kind === "write") {
          // La source n'existe pas encore à distance : on recopie son contenu.
          const copy: PendingChange = {
            path: change.path,
            kind: "write",
            sha: change.sha,
            baseSha,
            updatedAt: at,
          };
          if (source.content !== undefined) copy.content = source.content;
          if (source.base64 !== undefined) copy.base64 = source.base64;
          next.changes[change.path] = copy;
        } else {
          next.changes[change.path] = {
            path: change.path,
            kind: "copy",
            fromSha: change.sha,
            sha: change.sha,
            baseSha,
            updatedAt: at,
          };
        }
        break;
      }
      case "delete": {
        if (baseSha === null) delete next.changes[change.path];
        else
          next.changes[change.path] = { path: change.path, kind: "delete", baseSha, updatedAt: at };
        break;
      }
    }
  }
  if (changes.length > 0) {
    next.log.push({ id: ulid(now.getTime()), description, paths: changes.map((c) => c.path), at });
  }
  return prune(next);
}

/** Retire du journal et de la file les chemins qui n'ont plus de modification. */
function prune(state: PendingState): PendingState {
  const has = (p: string): boolean => p in state.changes;
  return {
    ...state,
    log: state.log
      .map((entry) => ({ ...entry, paths: entry.paths.filter(has) }))
      .filter((entry) => entry.paths.length > 0),
    queue: state.queue
      .map((commit) => ({ ...commit, paths: commit.paths.filter(has) }))
      .filter((commit) => commit.paths.length > 0),
  };
}

/** Vue de travail : fichiers distants modifiés par les changements en attente. */
export function workingFiles(
  remote: Iterable<RepoFile>,
  state: PendingState,
): Map<string, RepoFile> {
  const files = new Map<string, RepoFile>();
  for (const file of remote) files.set(file.path, file);
  for (const change of Object.values(state.changes)) {
    if (change.kind === "delete") files.delete(change.path);
    else files.set(change.path, { path: change.path, sha: change.sha! });
  }
  return files;
}

/** Chemins modifiés qui ne font encore partie d'aucun commit en file. */
export function uncommittedPaths(state: PendingState): string[] {
  const queued = new Set(state.queue.flatMap((c) => c.paths));
  return Object.keys(state.changes).filter((p) => !queued.has(p));
}

/** Met en file un commit portant sur `paths` (par défaut : tout ce qui n'est pas en file). */
export function queueCommit(
  state: PendingState,
  message: string,
  paths?: readonly string[],
  now = new Date(),
): PendingState {
  const queued = new Set(state.queue.flatMap((c) => c.paths));
  const selected = (paths ?? uncommittedPaths(state)).filter(
    (p) => p in state.changes && !queued.has(p),
  );
  if (selected.length === 0) return state;
  return {
    ...state,
    queue: [
      ...state.queue,
      { id: ulid(now.getTime()), message, paths: selected, createdAt: now.toISOString() },
    ],
  };
}

/** Annule des modifications locales (toutes si `paths` est absent). */
export function discardChanges(state: PendingState, paths?: readonly string[]): PendingState {
  if (!paths)
    return { ...emptyPending(), ...(state.lastSyncAt ? { lastSyncAt: state.lastSyncAt } : {}) };
  const changes = { ...state.changes };
  for (const path of paths) delete changes[path];
  return prune({
    ...state,
    changes,
    conflicts: state.conflicts.filter((c) => !paths.includes(c.path)),
  });
}

/** Message de commit généré à partir du journal des modifications. */
export function generatedMessage(state: PendingState, paths?: readonly string[]): string {
  const wanted = paths ? new Set(paths) : null;
  const descriptions: string[] = [];
  for (const entry of state.log) {
    if (wanted && !entry.paths.some((p) => wanted.has(p))) continue;
    if (!descriptions.includes(entry.description)) descriptions.push(entry.description);
  }
  if (descriptions.length === 0) return "Eugenia : mise à jour du wiki";
  if (descriptions.length === 1) return descriptions[0]!;
  return `${descriptions[0]} (+${descriptions.length - 1})\n\n${descriptions.map((d) => `- ${d}`).join("\n")}`;
}
