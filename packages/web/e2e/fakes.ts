/**
 * Simulations for the end-to-end tests: an in-memory GitHub (REST API, GraphQL, Git Data,
 * raw.githubusercontent.com) and the Claude API.
 */
import { createHash, randomBytes } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Page, Route } from "@playwright/test";

const sha1 = (data: Buffer | string): string => createHash("sha1").update(data).digest("hex");
const randomSha = (): string => randomBytes(20).toString("hex");

export function blobSha(content: Buffer): string {
  return sha1(Buffer.concat([Buffer.from(`blob ${content.byteLength}\0`), content]));
}

export function readDirectory(dir: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else out.set(relative(dir, full).split(sep).join("/"), readFileSync(full));
    }
  };
  walk(dir);
  return out;
}

interface Commit {
  tree: string;
  parents: string[];
  message: string;
}

/** Minimal git repository: blobs, flat trees, commits, one branch. */
export class FakeRepo {
  readonly blobs = new Map<string, Buffer>();
  readonly trees = new Map<string, Map<string, string>>();
  readonly commits = new Map<string, Commit>();
  head: string | null = null;
  readonly branch = "main";

  constructor(
    readonly name: string,
    files: Map<string, Buffer>,
    readonly isPrivate = true,
  ) {
    if (files.size > 0) {
      const tree = this.putTree(
        new Map([...files].map(([path, content]) => [path, this.putBlob(content)])),
      );
      this.head = this.putCommit({ tree, parents: [], message: "Initial" });
    }
  }

  putBlob(content: Buffer): string {
    const sha = blobSha(content);
    this.blobs.set(sha, content);
    return sha;
  }

  putTree(entries: Map<string, string>): string {
    const sha = randomSha();
    this.trees.set(sha, entries);
    return sha;
  }

  putCommit(commit: Commit): string {
    const sha = randomSha();
    this.commits.set(sha, commit);
    return sha;
  }

  headTree(): Map<string, string> {
    return this.head ? this.trees.get(this.commits.get(this.head)!.tree)! : new Map();
  }

  read(path: string): string | undefined {
    const sha = this.headTree().get(path);
    return sha ? this.blobs.get(sha)!.toString("utf8") : undefined;
  }

  paths(): string[] {
    return [...this.headTree().keys()].sort();
  }

  log(): string[] {
    const out: string[] = [];
    let current = this.head;
    while (current) {
      const commit = this.commits.get(current)!;
      out.push(commit.message);
      current = commit.parents[0] ?? null;
    }
    return out;
  }
}

export interface FakeGitHubOptions {
  token: string;
  login?: string;
  /** Repositories reachable through the API (`owner/name`). */
  repos: FakeRepo[];
  /** Public repositories served by raw.githubusercontent.com. */
  raw?: FakeRepo[];
}

function json(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
    headers: { "access-control-allow-origin": "*" },
  });
}

export async function installFakeGitHub(page: Page, options: FakeGitHubOptions): Promise<void> {
  const byName = new Map(options.repos.map((r) => [r.name.toLowerCase(), r]));
  await page.route("https://api.github.com/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (method === "OPTIONS")
      return route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "*",
          "access-control-allow-methods": "*",
        },
      });
    const authorized = request.headers()["authorization"] === `Bearer ${options.token}`;
    const path = url.pathname;
    if (path === "/user")
      return authorized
        ? json(route, 200, { login: options.login ?? "alice" })
        : json(route, 401, { message: "Bad credentials" });
    const body = request.postData()
      ? (JSON.parse(request.postData()!) as Record<string, unknown>)
      : {};
    if (path === "/graphql") {
      const repoMatch = /repository\(owner: "([^"]+)", name: "([^"]+)"\)/.exec(String(body.query));
      const repo = repoMatch
        ? byName.get(`${repoMatch[1]}/${repoMatch[2]}`.toLowerCase())
        : undefined;
      if (!repo || !authorized) return json(route, 200, { data: { repository: null } });
      const result: Record<string, unknown> = {};
      for (const m of String(body.query).matchAll(/(b\d+): object\(oid: "([0-9a-f]+)"\)/g)) {
        const blob = repo.blobs.get(m[2]!);
        result[m[1]!] = blob
          ? { text: blob.toString("utf8"), isBinary: false, isTruncated: false }
          : null;
      }
      return json(route, 200, { data: { repository: result } });
    }
    const m = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(path);
    if (!m) return json(route, 404, { message: "Not Found" });
    const repo = byName.get(`${m[1]}/${m[2]}`.toLowerCase());
    if (!repo || (repo.isPrivate && !authorized)) return json(route, 404, { message: "Not Found" });
    const rest = m[3] ?? "";
    if (rest === "" && method === "GET") {
      return json(route, 200, {
        private: repo.isPrivate,
        default_branch: repo.branch,
        size: repo.head ? 10 : 0,
        permissions: { push: authorized, admin: authorized },
      });
    }
    if (rest === `/git/ref/heads/${repo.branch}` && method === "GET") {
      return repo.head
        ? json(route, 200, { object: { sha: repo.head } })
        : json(route, 409, { message: "Git Repository is empty." });
    }
    let mm: RegExpExecArray | null;
    if ((mm = /^\/git\/commits\/([0-9a-f]+)$/.exec(rest)) && method === "GET") {
      const commit = repo.commits.get(mm[1]!);
      return commit
        ? json(route, 200, { sha: mm[1], tree: { sha: commit.tree } })
        : json(route, 404, { message: "Not Found" });
    }
    if ((mm = /^\/git\/trees\/([0-9a-f]+)$/.exec(rest)) && method === "GET") {
      const tree = repo.trees.get(mm[1]!);
      if (!tree) return json(route, 404, { message: "Not Found" });
      return json(route, 200, {
        sha: mm[1],
        truncated: false,
        tree: [...tree].map(([p, sha]) => ({
          path: p,
          type: "blob",
          mode: "100644",
          sha,
          size: repo.blobs.get(sha)!.byteLength,
        })),
      });
    }
    if ((mm = /^\/git\/blobs\/([0-9a-f]+)$/.exec(rest)) && method === "GET") {
      const blob = repo.blobs.get(mm[1]!);
      return blob
        ? json(route, 200, { sha: mm[1], content: blob.toString("base64"), encoding: "base64" })
        : json(route, 404, { message: "Not Found" });
    }
    if (!authorized) return json(route, 403, { message: "Forbidden" });
    if (rest === "/git/blobs" && method === "POST") {
      return json(route, 201, {
        sha: repo.putBlob(
          Buffer.from(String(body.content), body.encoding === "base64" ? "base64" : "utf8"),
        ),
      });
    }
    if (rest === "/git/trees" && method === "POST") {
      const base = body.base_tree
        ? new Map(repo.trees.get(String(body.base_tree)))
        : new Map<string, string>();
      for (const entry of body.tree as { path: string; sha?: string | null; content?: string }[]) {
        if (entry.content !== undefined)
          base.set(entry.path, repo.putBlob(Buffer.from(entry.content, "utf8")));
        else if (entry.sha === null) base.delete(entry.path);
        else if (entry.sha) base.set(entry.path, entry.sha);
      }
      return json(route, 201, { sha: repo.putTree(base) });
    }
    if (rest === "/git/commits" && method === "POST") {
      return json(route, 201, {
        sha: repo.putCommit({
          tree: String(body.tree),
          parents: body.parents as string[],
          message: String(body.message),
        }),
      });
    }
    if (rest === `/git/refs/heads/${repo.branch}` && method === "PATCH") {
      const commit = repo.commits.get(String(body.sha));
      if (!commit || (repo.head && !commit.parents.includes(repo.head)))
        return json(route, 422, { message: "Update is not a fast forward" });
      repo.head = String(body.sha);
      return json(route, 200, { object: { sha: repo.head } });
    }
    if ((mm = /^\/contents\/(.+)$/.exec(rest)) && method === "PUT") {
      const filePath = decodeURIComponent(mm[1]!);
      const entries = new Map(repo.headTree());
      entries.set(filePath, repo.putBlob(Buffer.from(String(body.content), "base64")));
      const commit = repo.putCommit({
        tree: repo.putTree(entries),
        parents: repo.head ? [repo.head] : [],
        message: String(body.message),
      });
      repo.head = commit;
      return json(route, 201, { commit: { sha: commit } });
    }
    return json(route, 404, { message: `Simulated route missing: ${method} ${path}` });
  });

  const rawRepos = new Map((options.raw ?? []).map((r) => [r.name.toLowerCase(), r]));
  await page.route("https://raw.githubusercontent.com/**", async (route) => {
    const url = new URL(route.request().url());
    const [, owner, name, , ...rest] = url.pathname.split("/");
    const repo = rawRepos.get(`${owner}/${name}`.toLowerCase());
    const content = repo?.read(rest.map(decodeURIComponent).join("/"));
    if (content === undefined)
      return route.fulfill({
        status: 404,
        body: "404: Not Found",
        headers: { "access-control-allow-origin": "*" },
      });
    return route.fulfill({
      status: 200,
      body: content,
      contentType: "text/plain; charset=utf-8",
      headers: { "access-control-allow-origin": "*" },
    });
  });
}

/** Answers of the Claude API, chosen according to the task (system prompt). */
export interface FakeClaudeOptions {
  /** Text of the generated descriptions. */
  summary?: string;
  /** Score of the quiz evaluations. */
  score?: number;
  /** Highlighted passages (exact quotes of the text). */
  highlights?: string[];
  /** Answer of discussions and questions. */
  reply?: string;
  /** Title of the new category proposed for the knowledge of a document. */
  category?: string;
}

export interface ClaudeCall {
  system: string;
  messages: { role: string; content: string }[];
  model: string;
}

export async function installFakeClaude(
  page: Page,
  options: FakeClaudeOptions = {},
): Promise<ClaudeCall[]> {
  const calls: ClaudeCall[] = [];
  const message = (text: string): Record<string, unknown> => ({
    id: `msg_${randomSha().slice(0, 12)}`,
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 100, output_tokens: 50 },
  });
  await page.route("https://api.anthropic.com/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "*",
          "access-control-allow-methods": "*",
        },
      });
    }
    const body = JSON.parse(request.postData() ?? "{}") as {
      system: string;
      messages: { role: string; content: string }[];
      model: string;
      stream?: boolean;
      output_config?: { format?: unknown };
    };
    calls.push({ system: body.system, messages: body.messages, model: body.model });
    const user = body.messages.map((m) => m.content).join("\n");
    let text: string;
    if (user.includes("<existing_flashcards>")) {
      text = JSON.stringify({
        cards: [
          {
            question: "Which point do astrologers call Lilith?",
            answer: "The Black Moon",
          },
        ],
      });
    } else if (body.system.includes("description of a sub-wiki")) {
      text = options.summary ?? "Description generated by Eugenia.";
    } else if (body.system.includes("You are quizzing the user")) {
      text = JSON.stringify({
        score: options.score ?? 0.9,
        feedback: "Very good, that is the expected answer.",
        missing: [],
        superfluous: [],
      });
    } else if (user.includes("<step>highlight</step>")) {
      text = JSON.stringify({
        highlights: (options.highlights ?? []).map((quote) => ({
          quote,
          reason: "Fact worth keeping",
        })),
      });
    } else if (user.includes("<step>propose</step>")) {
      const passages = [...user.matchAll(/^(\d+)\. "(.+)"$/gm)];
      text = JSON.stringify({
        cards: passages.map((p) => ({
          highlight: Number(p[1]),
          knowledge: `**${p[2]!.split(" ")[0]}** ${p[2]!.split(" ").slice(1).join(" ")}`,
          title: `Knowledge ${p[1]}`,
          question: `Question ${p[1]}?`,
          answer: p[2]!.split(" ")[0],
        })),
      });
    } else if (user.includes("<document>")) {
      // Categories of the document: a new category under "Religion and beliefs", grouping
      // every item, as Eugenia would propose for a document on one topic.
      const religion = /^- (\S+) \| [^\n]*Religion and beliefs/m.exec(user)?.[1] ?? "";
      const items = [...user.matchAll(/^(\d+)\. Knowledge \d+:/gm)];
      text = JSON.stringify({
        new_categories: [
          {
            key: "n1",
            title: options.category ?? "Jewish mythology",
            parent: religion,
            reason: "Groups the figures of Jewish mythology of the document.",
          },
        ],
        assignments: items.map((m) => ({ item: Number(m[1]), category: "n1" })),
      });
    } else if (body.system.includes("organize their personal wiki")) {
      text = JSON.stringify({
        suggestions: [{ title: "Mythologies", reason: "Groups the mythological figures." }],
      });
    } else if (user.includes("<step>exploration</step>")) {
      text = JSON.stringify({ explore: [], read: [], enough: true });
    } else {
      text = options.reply ?? "Eugenia's answer.";
    }
    if (body.stream) {
      const events = [
        { type: "message_start", message: { ...message(""), content: [] } },
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
        { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
        { type: "content_block_stop", index: 0 },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn", stop_sequence: null },
          usage: { output_tokens: 10 },
        },
        { type: "message_stop" },
      ];
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        headers: { "access-control-allow-origin": "*" },
        body: events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(""),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(message(text)),
    });
  });
  return calls;
}

/** Requests received by the fake Mistral: texts of each call to /embeddings. */
export interface MistralCalls {
  embeddings: string[][];
}

/**
 * Fake Mistral (`/v1/embeddings`): deterministic 64-dimension vector, bag of the stems (first 5
 * letters without accents) of the words of 4 letters or more. Two texts that share words are
 * therefore close, as with a real model on these simple examples.
 */
export async function installFakeMistral(page: Page): Promise<MistralCalls> {
  const calls: MistralCalls = { embeddings: [] };
  const embed = (text: string): number[] => {
    const vector = new Array<number>(64).fill(0);
    const words = text
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .match(/[a-z]{4,}/g);
    for (const word of words ?? []) {
      let hash = 0;
      for (const c of word.slice(0, 5)) hash = (hash * 31 + c.charCodeAt(0)) % 9973;
      vector[hash % 64]! += 1;
    }
    const norm = Math.hypot(...vector) || 1;
    return vector.map((v) => v / norm);
  };
  await page.route("https://api.mistral.ai/**", async (route) => {
    const request = route.request();
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "*",
    };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    const body = JSON.parse(request.postData() ?? "{}") as { model: string; input: string[] };
    calls.embeddings.push(body.input);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: cors,
      body: JSON.stringify({
        object: "list",
        model: body.model,
        data: body.input.map((text, index) => ({
          object: "embedding",
          index,
          embedding: embed(text),
        })),
      }),
    });
  });
  return calls;
}
