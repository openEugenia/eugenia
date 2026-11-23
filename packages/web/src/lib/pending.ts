/**
 * Pending local changes (§9.3, §10.3): grouped then committed in a single commit, or queued
 * when the network is missing. Pure, tested functions.
 */
import { base64ToBytes, gitBlobSha, ulid, type FileChange, type RepoFile } from "@openeugenia/core";

export interface PendingChange {
  path: string;
  kind: "write" | "delete" | "copy";
  /** Text content (write). */
  content?: string;
  /** Binary content in base64 (attached file). */
  base64?: string;
  /** SHA of the copied blob (a move without re-sending the content). */
  fromSha?: string;
  /** SHA of the resulting blob. */
  sha?: string;
  /** Remote SHA at the time of the first change (`null`: new file). */
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
  /** Local content (`null`: deleted locally). */
  local: string | null;
  /** Binary file: only the "local" or "remote" resolutions are possible. */
  binary?: boolean;
  /** Remote SHA and content (`null`: deleted remotely). */
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
 * Adds changes to the pending changes. The reference remote SHA is the one of the first change
 * of a file; a change that goes back to the original content disappears.
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
          // The source does not exist remotely yet: copy its content.
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

/** Removes from the log and the queue the paths that no longer have a change. */
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

/** Working view: remote files modified by the pending changes. */
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

/** Changed paths that are not part of any queued commit yet. */
export function uncommittedPaths(state: PendingState): string[] {
  const queued = new Set(state.queue.flatMap((c) => c.paths));
  return Object.keys(state.changes).filter((p) => !queued.has(p));
}

/** Queues a commit on `paths` (by default: everything that is not queued). */
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

/** Discards local changes (all of them if `paths` is absent). */
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

/** Commit message generated from the log of changes. */
export function generatedMessage(state: PendingState, paths?: readonly string[]): string {
  const wanted = paths ? new Set(paths) : null;
  const descriptions: string[] = [];
  for (const entry of state.log) {
    if (wanted && !entry.paths.some((p) => wanted.has(p))) continue;
    if (!descriptions.includes(entry.description)) descriptions.push(entry.description);
  }
  if (descriptions.length === 0) return "Eugenia: wiki update";
  if (descriptions.length === 1) return descriptions[0]!;
  return `${descriptions[0]} (+${descriptions.length - 1})\n\n${descriptions.map((d) => `- ${d}`).join("\n")}`;
}
