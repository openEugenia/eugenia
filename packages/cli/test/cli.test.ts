import { execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseEmbedding, parseSummary, summaryStates, type SummaryScope } from "@openeugenia/core";
import type { AIProvider, GenerateRequest, JsonRequest } from "@openeugenia/ai";
import { embedCommand, type EmbedOptions } from "../src/commands/embed.ts";
import { summarizeCommand } from "../src/commands/summarize.ts";
import { loadDiskWiki, listFiles } from "../src/fs-source.ts";
import { main } from "../src/main.ts";
import { CliError, type Logger } from "../src/output.ts";

const DEMO = join(import.meta.dirname, "..", "..", "..", "examples", "demo-wiki");

function logger(): { log: Logger; lines: string[] } {
  const lines: string[] = [];
  const push = (m: string): void => {
    lines.push(m);
  };
  return { lines, log: { info: push, warn: push, error: push } };
}

const temp = (prefix: string): Promise<string> => mkdtemp(join(tmpdir(), prefix));

async function demoCopy(): Promise<string> {
  const dir = await temp("eugenia-demo-");
  await cp(DEMO, dir, { recursive: true });
  return dir;
}

class ScriptedProvider implements AIProvider {
  readonly info = { kind: "ollama" as const, label: "Test", model: "test-model", local: true };
  readonly requests: GenerateRequest[] = [];
  async complete(request: GenerateRequest): Promise<string> {
    this.requests.push(request);
    return `Generated description #${this.requests.length}.`;
  }
  async *stream(): AsyncGenerator<string> {
    yield "";
  }
  async json<T>(_request: JsonRequest<T>): Promise<T> {
    throw new Error("not used");
  }
  async countTokens(): Promise<number> {
    return 0;
  }
}

describe("eugenia init", () => {
  it("creates a valid wiki with the default categories and the workflow", async () => {
    const dir = await temp("eugenia-init-");
    const { log } = logger();
    expect(
      await main(["init", dir, "--title", "Test", "--public-repo", "alice/wiki-public"], log),
    ).toBe(0);
    const files = await listFiles(dir);
    expect(files).toContain(".notes/config.yml");
    expect(files).toContain(".github/workflows/eugenia-publish.yml");
    expect(files).toContain("wiki/religion-and-beliefs/index.md");
    expect(files.filter((f) => f.endsWith("index.md")).length).toBe(16);
    expect(await main(["validate", dir], log)).toBe(0);
    await expect(main(["init", dir], log)).rejects.toBeInstanceOf(CliError);
  });

  it("can create a wiki without categories", async () => {
    const dir = await temp("eugenia-init-");
    expect(await main(["init", dir, "--no-categories"], logger().log)).toBe(0);
    expect((await listFiles(dir)).filter((f) => f.endsWith("index.md"))).toEqual(["wiki/index.md"]);
  });
});

describe("eugenia validate", () => {
  it("validates the demo wiki", async () => {
    const { log, lines } = logger();
    expect(await main(["validate", DEMO], log)).toBe(0);
    expect(lines.join("\n")).toContain(
      "6 knowledge item(s), 1 of which need a source, 7 flashcard(s), 6 category(ies), 4 source(s), 4 discussion(s); 16 public page(s).",
    );
    expect(lines.join("\n")).toContain("No problem found.");
  });

  it("fails on a rule 3 violation, in JSON", async () => {
    const dir = await demoCopy();
    const cogito = join(dir, "wiki/philosophy-and-thought/cogito/index.md");
    await writeFile(
      cogito,
      (await readFile(cogito, "utf8")).replace("visibility: private", "visibility: public"),
    );
    const { log, lines } = logger();
    expect(await main(["validate", dir, "--json"], log)).toBe(1);
    const result = JSON.parse(lines.join("\n")) as { ok: boolean; problems: { code: string }[] };
    expect(result.ok).toBe(false);
    expect(result.problems.map((p) => p.code)).toContain("public-under-private");
  });

  it("refuses an unknown command", async () => {
    await expect(main(["oops"], logger().log)).rejects.toThrow(/Unknown command/);
  });
});

describe("eugenia publish", () => {
  it("builds the public part without private content", async () => {
    const out = join(await temp("eugenia-out-"), "public");
    const { log, lines } = logger();
    expect(await main(["publish", DEMO, "--out", out], log)).toBe(0);
    expect(lines.join("\n")).toContain("1 private source(s) as bibliographic records only");
    const files = await listFiles(out);
    expect(files).toContain("wiki/religion-and-beliefs/lilith/index.md");
    expect(files).toContain(".notes/index.json");
    expect(files.some((f) => f.includes("philosophy"))).toBe(false);
    expect(files.some((f) => f.includes("exoplanet"))).toBe(false);
    expect(files).toContain("library/discourse-on-the-method/index.md");
    expect(files.some((f) => f.startsWith("discussions/"))).toBe(false);
    expect(files.some((f) => f.endsWith("_summary.public.md"))).toBe(false);
    const root = await readFile(join(out, "wiki/_summary.md"), "utf8");
    expect(parseSummary(root).fields.scope).toBe("public");
    const all = (await Promise.all(files.map((f) => readFile(join(out, f), "utf8")))).join("\n");
    expect(all).not.toContain("51 Pegasi");
    expect(all).not.toContain("I think, therefore I am");
    // The private article: its bibliographic record only, without content or personal file.
    expect(files).toContain("library/article-on-lilith/index.md");
    expect(files).not.toContain("library/article-on-lilith/article.pdf");
    const record = await readFile(join(out, "library/article-on-lilith/index.md"), "utf8");
    expect(record).toContain("title: Article on Lilith");
    expect(record).toContain("Jane Doe");
    expect(record).toContain("url: https://example.org/lilith");
    expect(record).not.toContain("stands for a deity");
    expect(record).not.toContain("article.pdf");
    // The public knowledge still cites it.
    const lilith = await readFile(join(out, "wiki/religion-and-beliefs/lilith/index.md"), "utf8");
    expect(lilith).toContain("ref: 01M6BK4140P9T3R69AH4Y8K1PA");
  });

  it("pushes a single commit and rewrites the history of the public repository", async () => {
    const bare = await temp("eugenia-bare-");
    execFileSync("git", ["init", "--bare", "-q", bare]);
    for (let i = 0; i < 2; i++) {
      expect(await main(["publish", DEMO, "--remote", bare], logger().log)).toBe(0);
    }
    const log = execFileSync("git", ["--git-dir", bare, "log", "--format=%s", "main"], {
      encoding: "utf8",
    })
      .trim()
      .split("\n");
    expect(log).toHaveLength(1);
    expect(log[0]).toMatch(/^Wiki publication — \d{4}-\d{2}-\d{2}$/);
    const tree = execFileSync("git", ["--git-dir", bare, "ls-tree", "-r", "--name-only", "main"], {
      encoding: "utf8",
    });
    expect(tree).toContain("wiki/science/astronomy/black-moon/index.md");
    expect(tree).not.toContain("cogito");
  });

  it("refuses to publish a public description generated from a private node", async () => {
    const dir = await demoCopy();
    const path = join(dir, "wiki/religion-and-beliefs/_summary.public.md");
    const text = await readFile(path, "utf8");
    await writeFile(
      path,
      text.replace("sources:\n", "sources:\n  01M6BK4140P9T3R69AH4Y8K1PA: 1234abc\n"),
    );
    const out = join(await temp("eugenia-out-"), "public");
    const { log, lines } = logger();
    expect(await main(["publish", dir, "--out", out], log)).toBe(1);
    expect(lines.join("\n")).toContain('private node "Article on Lilith"');
    expect(await readdir(out).catch(() => [])).toEqual([]);
  });

  it("requires a target", async () => {
    await expect(main(["publish", DEMO], logger().log)).rejects.toThrow(/--target/);
  });
});

describe("eugenia summarize", () => {
  it("regenerates stale descriptions, from the deepest to the root", async () => {
    const dir = await demoCopy();
    const apogee = join(dir, "wiki/science/astronomy/apogee/index.md");
    await writeFile(
      apogee,
      (await readFile(apogee, "utf8")).replace("farthest from it", "most distant from it"),
    );
    const provider = new ScriptedProvider();
    const { log } = logger();
    expect(
      await summarizeCommand(
        {
          dir,
          scope: "both",
          force: false,
          dryRun: false,
          localOnlyPrivate: false,
          providerInstance: provider,
        },
        log,
      ),
    ).toBe(0);

    const written = await Promise.all(
      [
        "wiki/science/astronomy/_summary.md",
        "wiki/science/_summary.md",
        "wiki/_summary.md",
        "wiki/science/astronomy/_summary.public.md",
      ].map(async (p) => parseSummary(await readFile(join(dir, p), "utf8"))),
    );
    expect(
      written.every(
        (d) => d.body.startsWith("Generated description") && d.fields.model === "test-model",
      ),
    ).toBe(true);
    expect(
      parseSummary(await readFile(join(dir, "wiki/religion-and-beliefs/_summary.md"), "utf8")).body,
    ).toContain("Lilith");
    expect(provider.requests).toHaveLength(6);
    expect(provider.requests[0]!.messages[0]!.content).toContain("Title: Astronomy");

    const wiki = await loadDiskWiki(dir);
    for (const scope of ["private", "public"] as SummaryScope[]) {
      const states = summaryStates(wiki.tree, scope, wiki.summaries);
      expect(
        [...states.values()].filter((s) => s.status === "stale" || s.status === "missing"),
      ).toEqual([]);
    }
  });

  it("does not send private content to a remote provider with --local-only-private", async () => {
    const dir = await demoCopy();
    const provider = new ScriptedProvider();
    (provider.info as { local: boolean }).local = false;
    const { log, lines } = logger();
    await summarizeCommand(
      {
        dir,
        scope: "private",
        force: true,
        dryRun: true,
        localOnlyPrivate: true,
        providerInstance: provider,
      },
      log,
    );
    expect(lines.join("\n")).toContain("private content and remote provider");
    // Only fully public branches (Religion and beliefs) are sent.
    const sent = provider.requests.map((r) => r.messages[0]!.content).join("\n");
    expect(provider.requests.length).toBe(1);
    expect(sent).toContain("Title: Religion and beliefs");
    expect(sent).not.toContain("Pegasi");
  });
});

describe("eugenia embed", () => {
  class EmbeddingProvider extends ScriptedProvider {
    readonly batches: string[][] = [];
    async embed(texts: string[]): Promise<number[][]> {
      this.batches.push(texts);
      return texts.map((t) => [t.length, 1, 0]);
    }
  }
  const run = (dir: string, provider: AIProvider, extra: Partial<EmbedOptions> = {}) =>
    embedCommand(
      {
        dir,
        force: false,
        dryRun: false,
        localOnlyPrivate: false,
        providerInstance: provider,
        ...extra,
      },
      logger().log,
    );

  it("writes one _embedding.json per page, then only recomputes changed pages", async () => {
    const dir = await demoCopy();
    const provider = new EmbeddingProvider();
    expect(await run(dir, provider)).toBe(0);
    // Categories, knowledge and sources; not flashcards (they repeat their knowledge item).
    const pages = [...(await loadDiskWiki(dir)).tree.nodes.values()].filter(
      (n) => !n.virtual && n.type !== "flashcard",
    );
    const embeddings = (await listFiles(dir)).filter((p) => p.endsWith("/_embedding.json"));
    expect(embeddings).toHaveLength(pages.length);
    expect(embeddings.some((p) => p.startsWith("library/"))).toBe(true);
    const lilith = parseEmbedding(
      await readFile(join(dir, "wiki/religion-and-beliefs/lilith/_embedding.json"), "utf8"),
    );
    expect(lilith.model).toBe("test-model");
    expect(provider.batches.flat().find((t) => t.startsWith("Lilith\n"))).toContain("female demon");

    expect(await run(dir, provider)).toBe(0);
    expect(provider.batches).toHaveLength(1);

    const apogee = join(dir, "wiki/science/astronomy/apogee/index.md");
    await writeFile(
      apogee,
      (await readFile(apogee, "utf8")).replace("farthest from it", "most distant from it"),
    );
    await run(dir, provider);
    expect(provider.batches).toHaveLength(2);
    expect(provider.batches[1]).toHaveLength(1);
    expect(provider.batches[1]![0]).toContain("most distant from it");

    // Embeddings are never published.
    const out = await temp("eugenia-public-");
    expect(await main(["publish", dir, "--out", out], logger().log)).toBe(0);
    const published = await listFiles(out);
    expect(published).toContain("wiki/religion-and-beliefs/lilith/index.md");
    expect(published.filter((p) => p.includes("_embedding"))).toEqual([]);
  });

  it("only sends public pages to a remote provider with --local-only-private", async () => {
    const dir = await demoCopy();
    const provider = new EmbeddingProvider();
    (provider.info as { local: boolean }).local = false;
    await run(dir, provider, { localOnlyPrivate: true });
    const wiki = await loadDiskWiki(dir);
    const nodes = [...wiki.tree.nodes.values()].filter((n) => !n.virtual && n.type !== "flashcard");
    expect(nodes.filter((n) => n.embedding).every((n) => n.isPublic)).toBe(true);
    expect(nodes.filter((n) => n.isPublic).every((n) => n.embedding)).toBe(true);
  });
});
