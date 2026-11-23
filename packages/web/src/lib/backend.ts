/**
 * Repository access according to the mode (§7, §10):
 * - owner: private repository through the GitHub API (read and write);
 * - anonymous: public repository through `index.json`, then the Markdown files (read only).
 */
import {
  CONFIG_PATH,
  INDEX_JSON_PATH,
  discussionsFromIndex,
  isWikiIndex,
  metasFromIndex,
  parseConfig,
  type RepoFile,
} from "@openeugenia/core";
import type { Snapshot } from "./db.ts";
import { GitHubClient, GitHubError, mapLimit, RawClient, type TreeEntryInput } from "./github.ts";
import type { Conflict, PendingState, QueuedCommit } from "./pending.ts";
import { parseRepo, repoKey, repoLabel, type RepoRef } from "./repo.ts";

export type Mode = "owner" | "anonymous";

export interface ResolvedSource {
  mode: Mode;
  /** Repository read. */
  source: RepoRef;
  /** Associated public repository (owner mode opened from the public repository). */
  publicRepo?: RepoRef;
  branch: string;
  isPrivate: boolean;
  canWrite: boolean;
  /** Why writing is not possible. */
  readOnlyReason?: string;
}

export class SourceError extends Error {
  override name = "SourceError";
}

/**
 * Detects the access mode (§7): a private repository accessible with the token is opened as
 * owner; a public repository is read anonymously, unless its configuration declares a
 * `private_repo` accessible with the token, in which case the app switches to it.
 */
export async function resolveSource(
  requested: RepoRef,
  token: string | undefined,
  fetchImpl?: typeof fetch,
): Promise<ResolvedSource> {
  const raw = new RawClient(fetchImpl);
  if (token) {
    const gh = new GitHubClient(token, fetchImpl);
    let info;
    try {
      info = await gh.getRepo(requested);
    } catch (error) {
      if (error instanceof GitHubError && error.code === "not_found") {
        // Maybe a public repository: try reading it anonymously.
        return {
          mode: "anonymous",
          source: requested,
          branch: "HEAD",
          isPrivate: false,
          canWrite: false,
        };
      }
      throw error;
    }
    if (info.private) {
      return {
        mode: "owner",
        source: requested,
        branch: info.defaultBranch,
        isPrivate: true,
        canWrite: info.canPush,
        ...(info.canPush
          ? {}
          : { readOnlyReason: "Your token does not allow writing to this repository." }),
      };
    }
    // Public repository: generated repository (index.json) or public source repository.
    let config: string | null = null;
    try {
      config = await raw.getText(requested, CONFIG_PATH);
    } catch {
      config = null;
    }
    const privateRepo = parseRepo(parseConfig(config).config.private_repo);
    if (privateRepo && repoKey(privateRepo) !== repoKey(requested)) {
      try {
        const privateInfo = await gh.getRepo(privateRepo);
        if (privateInfo.private) {
          return {
            mode: "owner",
            source: privateRepo,
            publicRepo: requested,
            branch: privateInfo.defaultBranch,
            isPrivate: true,
            canWrite: privateInfo.canPush,
            ...(privateInfo.canPush
              ? {}
              : { readOnlyReason: "Your token does not allow writing to this repository." }),
          };
        }
      } catch {
        // no access to the private repository: anonymous reading
      }
    }
    const hasIndex = await raw.getResponse(requested, INDEX_JSON_PATH).then(
      () => true,
      () => false,
    );
    if (!hasIndex && config !== null && info.canPush) {
      return {
        mode: "owner",
        source: requested,
        branch: info.defaultBranch,
        isPrivate: false,
        canWrite: false,
        readOnlyReason:
          "This repository is public: the app refuses to write to it. The source repository of a wiki must be private.",
      };
    }
  }
  return {
    mode: "anonymous",
    source: requested,
    branch: "HEAD",
    isPrivate: false,
    canWrite: false,
  };
}

/** Reading and writing of a repository for a given mode. */
export interface Backend {
  readonly mode: Mode;
  readonly source: RepoRef;
  fetchSnapshot(previous?: Snapshot): Promise<Snapshot>;
  /** Text contents, by SHA. */
  readBlobs(files: readonly RepoFile[]): Promise<Map<string, string>>;
  /** Binary content (images, PDF). */
  readBinary(file: RepoFile): Promise<Blob>;
  /** Direct URL of a file (anonymous mode). */
  directUrl?(path: string): string;
}

export class OwnerBackend implements Backend {
  readonly mode = "owner" as const;
  readonly gh: GitHubClient;

  constructor(
    readonly resolved: ResolvedSource,
    token: string,
    fetchImpl?: typeof fetch,
  ) {
    this.gh = new GitHubClient(token, fetchImpl);
  }

  get source(): RepoRef {
    return this.resolved.source;
  }

  async fetchSnapshot(previous?: Snapshot): Promise<Snapshot> {
    const { source, branch } = this.resolved;
    const head = await this.gh.getBranchHead(source, branch);
    const base = {
      repo: repoKey(source),
      mode: "owner" as const,
      branch,
      isPrivate: this.resolved.isPrivate,
      fetchedAt: new Date().toISOString(),
      ...(this.resolved.publicRepo ? { publicRepo: repoLabel(this.resolved.publicRepo) } : {}),
    };
    if (!head) return { ...base, files: [] };
    if (previous?.headSha === head && previous.mode === "owner")
      return { ...previous, ...base, headSha: head };
    const treeSha = await this.gh.getCommitTree(source, head);
    const files = await this.gh.getTree(source, treeSha);
    return { ...base, headSha: head, treeSha, files };
  }

  async readBlobs(files: readonly RepoFile[]): Promise<Map<string, string>> {
    return this.gh.getBlobsText(
      this.source,
      files.map((f) => f.sha),
    );
  }

  async readBinary(file: RepoFile): Promise<Blob> {
    const base64 = await this.gh.getBlobBase64(this.source, file.sha);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mimeType(file.path) });
  }
}

export class AnonymousBackend implements Backend {
  readonly mode = "anonymous" as const;
  private readonly raw: RawClient;

  constructor(
    readonly source: RepoRef,
    fetchImpl?: typeof fetch,
  ) {
    this.raw = new RawClient(fetchImpl);
  }

  async fetchSnapshot(): Promise<Snapshot> {
    let text: string;
    try {
      text = await this.raw.getText(this.source, INDEX_JSON_PATH);
    } catch (error) {
      if (error instanceof GitHubError && error.code === "not_found") {
        throw new SourceError(
          `No public wiki in ${repoLabel(this.source)} (no ${INDEX_JSON_PATH} file). If this is your private repository, add a GitHub token in the settings.`,
        );
      }
      throw error;
    }
    let index: unknown;
    try {
      index = JSON.parse(text);
    } catch {
      throw new SourceError(`${INDEX_JSON_PATH} is unreadable in ${repoLabel(this.source)}.`);
    }
    if (!isWikiIndex(index)) throw new SourceError(`${INDEX_JSON_PATH} is not an Eugenia index.`);
    return {
      repo: repoKey(this.source),
      mode: "anonymous",
      branch: "HEAD",
      files: index.files,
      metas: Object.fromEntries(metasFromIndex(index)),
      discussions: Object.fromEntries(discussionsFromIndex(index)),
      fetchedAt: new Date().toISOString(),
    };
  }

  async readBlobs(files: readonly RepoFile[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    await mapLimit(files, 8, async (file) => {
      out.set(file.sha, await this.raw.getText(this.source, file.path));
    });
    return out;
  }

  async readBinary(file: RepoFile): Promise<Blob> {
    return (await this.raw.getResponse(this.source, file.path)).blob();
  }

  directUrl(path: string): string {
    return this.raw.url(this.source, path);
  }
}

export function mimeType(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return (
    {
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      webp: "image/webp",
      svg: "image/svg+xml",
      avif: "image/avif",
      pdf: "application/pdf",
      mp3: "audio/mpeg",
      mp4: "video/mp4",
      md: "text/markdown",
      txt: "text/plain",
    }[ext] ?? "application/octet-stream"
  );
}

// ---------------------------------------------------------------------------
// Writing: a multi-file commit through the Git Data API (§10.2)
// ---------------------------------------------------------------------------

export type PushOutcome =
  | { status: "committed"; snapshot: Snapshot; committed: Map<string, string> }
  | { status: "conflicts"; conflicts: Conflict[]; snapshot: Snapshot };

/**
 * Pushes a queued commit. If a file changed locally has changed remotely, nothing is written
 * and the conflicts are returned (no silent resolution, §10.3).
 */
export async function pushCommit(
  backend: OwnerBackend,
  snapshot: Snapshot,
  state: PendingState,
  commit: QueuedCommit,
): Promise<PushOutcome> {
  const { gh, source } = backend;
  const branch = backend.resolved.branch;
  for (let attempt = 0; attempt < 3; attempt++) {
    // 1. Remote state.
    const remote = await backend.fetchSnapshot(snapshot);
    const remoteFiles = new Map(remote.files.map((f) => [f.path, f]));

    // 2. Conflicts: file changed on both sides.
    const conflicts: Conflict[] = [];
    const effective = commit.paths.filter((path) => {
      const change = state.changes[path];
      if (!change) return false;
      const remoteSha = remoteFiles.get(path)?.sha ?? null;
      if (remoteSha === change.baseSha) return true;
      if (change.kind === "delete" ? remoteSha === null : remoteSha === change.sha) return false; // already up to date
      const conflict: Conflict = {
        path,
        local: change.kind === "delete" ? null : (change.content ?? null),
        remoteSha,
        remote: null,
      };
      if (change.base64 !== undefined) conflict.binary = true;
      conflicts.push(conflict);
      return true;
    });
    if (conflicts.length > 0) {
      await mapLimit(conflicts, 4, async (conflict) => {
        const change = state.changes[conflict.path]!;
        if (change.kind === "copy" && change.fromSha)
          conflict.local = await gh.getBlobText(source, change.fromSha);
        if (conflict.remoteSha && !conflict.binary)
          conflict.remote = await gh.getBlobText(source, conflict.remoteSha);
      });
      return { status: "conflicts", conflicts, snapshot: remote };
    }
    if (effective.length === 0)
      return { status: "committed", snapshot: remote, committed: new Map() };

    // 3. Empty repository: first file through the Contents API.
    let head = remote.headSha ?? null;
    const paths = [...effective];
    const committed = new Map<string, string>();
    if (!head) {
      const firstIndex = paths.findIndex(
        (p) => state.changes[p]?.kind === "write" && state.changes[p]?.content !== undefined,
      );
      if (firstIndex < 0)
        throw new GitHubError(
          "Cannot initialize an empty repository without a text file.",
          "other",
        );
      const first = state.changes[paths[firstIndex]!]!;
      head = await gh.createFile(source, first.path, first.content!, commit.message, branch);
      committed.set(first.sha!, first.content!);
      paths.splice(firstIndex, 1);
      if (paths.length === 0) {
        return { status: "committed", snapshot: await backend.fetchSnapshot(), committed };
      }
    }
    const baseTree =
      head === remote.headSha ? (remote.treeSha ?? null) : await gh.getCommitTree(source, head);

    // 4. Tree, commit, branch update.
    const entries: TreeEntryInput[] = [];
    for (const path of paths) {
      const change = state.changes[path]!;
      if (change.kind === "delete") {
        if (remoteFiles.has(path)) entries.push({ path, mode: "100644", type: "blob", sha: null });
      } else if (change.kind === "copy") {
        entries.push({ path, mode: "100644", type: "blob", sha: change.fromSha! });
      } else if (change.base64 !== undefined) {
        entries.push({
          path,
          mode: "100644",
          type: "blob",
          sha: await gh.createBlob(source, change.base64),
        });
      } else {
        entries.push({ path, mode: "100644", type: "blob", content: change.content ?? "" });
        committed.set(change.sha!, change.content ?? "");
      }
    }
    const tree = await gh.createTree(source, baseTree, entries);
    const commitSha = await gh.createCommit(source, commit.message, tree, [head]);
    try {
      await gh.updateRef(source, branch, commitSha);
    } catch (error) {
      // The branch moved in the meantime: start again with the new remote state.
      if (error instanceof GitHubError && error.code === "unprocessable") {
        snapshot = remote;
        continue;
      }
      throw error;
    }
    const files = new Map(remoteFiles);
    for (const path of commit.paths) {
      const change = state.changes[path];
      if (!change) continue;
      if (change.kind === "delete") files.delete(path);
      else files.set(path, { path, sha: change.sha! });
    }
    return {
      status: "committed",
      committed,
      snapshot: {
        ...remote,
        headSha: commitSha,
        treeSha: tree,
        files: [...files.values()],
        fetchedAt: new Date().toISOString(),
      },
    };
  }
  throw new GitHubError("The remote branch changes too often: try again.", "other");
}
