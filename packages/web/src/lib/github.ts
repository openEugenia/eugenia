/**
 * Access to GitHub: REST and GraphQL APIs (owner, with a token) and raw.githubusercontent.com
 * (anonymous reading, without rate limit) — §7, §10.
 */
import { base64ToBytes, bytesToBase64, utf8, type RepoFile } from "@openeugenia/core";
import { repoLabel, type RepoRef } from "./repo.ts";

export type GitHubErrorCode =
  | "auth"
  | "forbidden"
  | "not_found"
  | "rate_limit"
  | "conflict"
  | "unprocessable"
  | "network"
  | "other";

export class GitHubError extends Error {
  override name = "GitHubError";
  constructor(
    message: string,
    readonly code: GitHubErrorCode,
    readonly status?: number,
  ) {
    super(message);
  }
}

const API = "https://api.github.com";
const RAW = "https://raw.githubusercontent.com";
const decoder = new TextDecoder();

export interface RepoInfo {
  private: boolean;
  defaultBranch: string;
  canPush: boolean;
  empty: boolean;
}

export interface TreeEntryInput {
  path: string;
  mode: "100644";
  type: "blob";
  sha?: string | null;
  content?: string;
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export class GitHubClient {
  constructor(
    private readonly token?: string,
    private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  get authenticated(): boolean {
    return Boolean(this.token);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(path.startsWith("http") ? path : `${API}${path}`, {
        method,
        headers: {
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        cache: "no-store",
      });
    } catch (error) {
      throw new GitHubError(
        `GitHub cannot be reached (${error instanceof Error ? error.message : "network"}).`,
        "network",
      );
    }
    if (response.ok) {
      return (response.status === 204 ? undefined : await response.json()) as T;
    }
    let detail = "";
    try {
      const data = (await response.json()) as { message?: string };
      detail = data.message ?? "";
    } catch {
      // corps vide
    }
    const status = response.status;
    if (status === 401)
      throw new GitHubError(
        "GitHub token refused or expired: check it in the settings.",
        "auth",
        status,
      );
    if (
      (status === 403 || status === 429) &&
      response.headers.get("x-ratelimit-remaining") === "0"
    ) {
      const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
      const when =
        Number.isFinite(reset) && reset > 0
          ? ` (until ${new Date(reset).toLocaleTimeString("en")})`
          : "";
      throw new GitHubError(`GitHub rate limit reached${when}.`, "rate_limit", status);
    }
    if (status === 403)
      throw new GitHubError(
        `Access refused by GitHub: ${detail || "insufficient permissions"}.`,
        "forbidden",
        status,
      );
    if (status === 404)
      throw new GitHubError(
        "Not found on GitHub (or not accessible with this token).",
        "not_found",
        status,
      );
    if (status === 409) throw new GitHubError(detail || "Conflit GitHub.", "conflict", status);
    if (status === 422)
      throw new GitHubError(detail || "Request refused by GitHub.", "unprocessable", status);
    throw new GitHubError(
      `Erreur GitHub ${status}${detail ? ` : ${detail}` : ""}.`,
      "other",
      status,
    );
  }

  async getUser(): Promise<{ login: string }> {
    return this.request("GET", "/user");
  }

  async getRepo(ref: RepoRef): Promise<RepoInfo> {
    const data = await this.request<{
      private: boolean;
      default_branch: string;
      size: number;
      permissions?: { push?: boolean; admin?: boolean };
    }>("GET", `/repos/${ref.owner}/${ref.name}`);
    return {
      private: data.private,
      defaultBranch: data.default_branch,
      canPush: Boolean(data.permissions?.push || data.permissions?.admin),
      empty: data.size === 0,
    };
  }

  /** SHA of the last commit of a branch, or `null` if the repository is empty. */
  async getBranchHead(ref: RepoRef, branch: string): Promise<string | null> {
    try {
      const data = await this.request<{ object: { sha: string } }>(
        "GET",
        `/repos/${ref.owner}/${ref.name}/git/ref/heads/${encodeURIComponent(branch)}`,
      );
      return data.object.sha;
    } catch (error) {
      if (error instanceof GitHubError && (error.code === "not_found" || error.code === "conflict"))
        return null;
      throw error;
    }
  }

  async getCommitTree(ref: RepoRef, commitSha: string): Promise<string> {
    const data = await this.request<{ tree: { sha: string } }>(
      "GET",
      `/repos/${ref.owner}/${ref.name}/git/commits/${commitSha}`,
    );
    return data.tree.sha;
  }

  /** Complete tree in one call (§10.1). */
  async getTree(ref: RepoRef, treeSha: string): Promise<RepoFile[]> {
    const data = await this.request<{
      truncated: boolean;
      tree: { path: string; type: string; sha: string; size?: number }[];
    }>("GET", `/repos/${ref.owner}/${ref.name}/git/trees/${treeSha}?recursive=1`);
    if (data.truncated) {
      throw new GitHubError(
        "Repository too large: the tree returned by GitHub is truncated.",
        "other",
      );
    }
    return data.tree
      .filter((e) => e.type === "blob")
      .map((e) =>
        e.size === undefined
          ? { path: e.path, sha: e.sha }
          : { path: e.path, sha: e.sha, size: e.size },
      );
  }

  async getBlobBase64(ref: RepoRef, sha: string): Promise<string> {
    const data = await this.request<{ content: string; encoding: string }>(
      "GET",
      `/repos/${ref.owner}/${ref.name}/git/blobs/${sha}`,
    );
    return data.encoding === "base64"
      ? data.content.replace(/\s+/g, "")
      : bytesToBase64(utf8(data.content));
  }

  async getBlobText(ref: RepoRef, sha: string): Promise<string> {
    return decoder.decode(base64ToBytes(await this.getBlobBase64(ref, sha)));
  }

  /** Batched reading of text blobs through GraphQL (50 per request), falling back on REST. */
  async getBlobsText(ref: RepoRef, shas: readonly string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const unique = [...new Set(shas)];
    const fallback: string[] = [];
    for (let i = 0; i < unique.length; i += 50) {
      const batch = unique.slice(i, i + 50);
      const fields = batch
        .map(
          (sha, n) => `b${n}: object(oid: "${sha}") { ... on Blob { text isBinary isTruncated } }`,
        )
        .join("\n");
      const query = `query { repository(owner: ${JSON.stringify(ref.owner)}, name: ${JSON.stringify(ref.name)}) {\n${fields}\n} }`;
      try {
        const data = await this.request<{
          data?: {
            repository?: Record<
              string,
              { text: string | null; isBinary: boolean; isTruncated: boolean } | null
            >;
          };
          errors?: unknown[];
        }>("POST", "/graphql", { query });
        const repository = data.data?.repository;
        if (!repository) throw new GitHubError("Incomplete GraphQL response.", "other");
        batch.forEach((sha, n) => {
          const blob = repository[`b${n}`];
          if (blob && blob.text !== null && !blob.isTruncated && !blob.isBinary)
            out.set(sha, blob.text);
          else fallback.push(sha);
        });
      } catch (error) {
        if (
          error instanceof GitHubError &&
          (error.code === "auth" || error.code === "rate_limit" || error.code === "network")
        ) {
          throw error;
        }
        fallback.push(...batch);
      }
    }
    await mapLimit(fallback, 6, async (sha) => {
      out.set(sha, await this.getBlobText(ref, sha));
    });
    return out;
  }

  async createBlob(ref: RepoRef, base64: string): Promise<string> {
    const data = await this.request<{ sha: string }>(
      "POST",
      `/repos/${ref.owner}/${ref.name}/git/blobs`,
      {
        content: base64,
        encoding: "base64",
      },
    );
    return data.sha;
  }

  async createTree(
    ref: RepoRef,
    baseTree: string | null,
    entries: readonly TreeEntryInput[],
  ): Promise<string> {
    const data = await this.request<{ sha: string }>(
      "POST",
      `/repos/${ref.owner}/${ref.name}/git/trees`,
      {
        ...(baseTree ? { base_tree: baseTree } : {}),
        tree: entries,
      },
    );
    return data.sha;
  }

  async createCommit(
    ref: RepoRef,
    message: string,
    tree: string,
    parents: readonly string[],
  ): Promise<string> {
    const data = await this.request<{ sha: string }>(
      "POST",
      `/repos/${ref.owner}/${ref.name}/git/commits`,
      {
        message,
        tree,
        parents,
      },
    );
    return data.sha;
  }

  /** Moves the branch forward; fails (422) if it moved in the meantime. */
  async updateRef(ref: RepoRef, branch: string, sha: string): Promise<void> {
    await this.request(
      "PATCH",
      `/repos/${ref.owner}/${ref.name}/git/refs/heads/${encodeURIComponent(branch)}`,
      {
        sha,
        force: false,
      },
    );
  }

  /** First file of an empty repository (the Git Data API does not work on an empty one). */
  async createFile(
    ref: RepoRef,
    path: string,
    content: string,
    message: string,
    branch: string,
  ): Promise<string> {
    const data = await this.request<{ commit: { sha: string } }>(
      "PUT",
      `/repos/${ref.owner}/${ref.name}/contents/${encodePath(path)}`,
      { message, content: bytesToBase64(utf8(content)), branch },
    );
    return data.commit.sha;
  }
}

/** Anonymous reading of the public repository, through raw.githubusercontent.com. */
export class RawClient {
  private branch = "HEAD";

  constructor(private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)) {}

  url(ref: RepoRef, path: string, branch = this.branch): string {
    return `${RAW}/${ref.owner}/${ref.name}/${encodeURIComponent(branch)}/${encodePath(path)}`;
  }

  async getResponse(ref: RepoRef, path: string): Promise<Response> {
    for (const branch of this.branch === "HEAD" ? ["HEAD", "main"] : [this.branch]) {
      let response: Response;
      try {
        response = await this.fetchImpl(this.url(ref, path, branch), { cache: "no-cache" });
      } catch {
        throw new GitHubError("raw.githubusercontent.com cannot be reached.", "network");
      }
      if (response.ok) {
        this.branch = branch;
        return response;
      }
      if (response.status !== 404) {
        throw new GitHubError(
          `Error ${response.status} while reading ${repoLabel(ref)}/${path}.`,
          "other",
          response.status,
        );
      }
    }
    throw new GitHubError(`${path} not found in ${repoLabel(ref)}.`, "not_found", 404);
  }

  async getText(ref: RepoRef, path: string): Promise<string> {
    return (await this.getResponse(ref, path)).text();
  }
}

/** Runs `fn` on each item with at most `limit` simultaneous calls. */
export async function mapLimit<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}
