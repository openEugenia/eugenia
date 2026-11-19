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
    return `Description générée n°${this.requests.length}.`;
  }
  async *stream(): AsyncGenerator<string> {
    yield "";
  }
  async json<T>(_request: JsonRequest<T>): Promise<T> {
    throw new Error("non utilisé");
  }
  async countTokens(): Promise<number> {
    return 0;
  }
}

describe("eugenia init", () => {
  it("crée un wiki valide avec les catégories par défaut et le workflow", async () => {
    const dir = await temp("eugenia-init-");
    const { log } = logger();
    expect(
      await main(["init", dir, "--title", "Test", "--public-repo", "alice/wiki-public"], log),
    ).toBe(0);
    const files = await listFiles(dir);
    expect(files).toContain(".notes/config.yml");
    expect(files).toContain(".github/workflows/eugenia-publish.yml");
    expect(files.filter((f) => f.endsWith("index.md")).length).toBe(16);
    expect(await main(["validate", dir], log)).toBe(0);
    await expect(main(["init", dir], log)).rejects.toBeInstanceOf(CliError);
  });

  it("peut créer un wiki sans catégories", async () => {
    const dir = await temp("eugenia-init-");
    expect(await main(["init", dir, "--no-categories"], logger().log)).toBe(0);
    expect((await listFiles(dir)).filter((f) => f.endsWith("index.md"))).toEqual(["wiki/index.md"]);
  });
});

describe("eugenia validate", () => {
  it("valide le wiki de démonstration", async () => {
    const { log, lines } = logger();
    expect(await main(["validate", DEMO], log)).toBe(0);
    expect(lines.join("\n")).toContain("13 page(s), dont 6 flashcard(s), 8 publique(s).");
  });

  it("échoue sur une violation de la règle 3, en JSON", async () => {
    const dir = await demoCopy();
    const cogito = join(dir, "wiki/philosophie-et-pensee/cogito/index.md");
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

  it("refuse une commande inconnue", async () => {
    await expect(main(["oups"], logger().log)).rejects.toThrow(/Commande inconnue/);
  });
});

describe("eugenia publish", () => {
  it("construit la partie publique sans contenu privé", async () => {
    const out = join(await temp("eugenia-out-"), "public");
    expect(await main(["publish", DEMO, "--out", out], logger().log)).toBe(0);
    const files = await listFiles(out);
    expect(files).toContain("wiki/religion-et-croyances/lilith/index.md");
    expect(files).toContain(".notes/index.json");
    expect(files.some((f) => f.includes("philosophie"))).toBe(false);
    expect(files.some((f) => f.includes("exoplanetes"))).toBe(false);
    expect(files.some((f) => f.includes("article"))).toBe(false);
    expect(files.some((f) => f.includes("_quizzes") || f.includes("_discussions"))).toBe(false);
    expect(files.some((f) => f.endsWith("_summary.public.md"))).toBe(false);
    const root = await readFile(join(out, "wiki/_summary.md"), "utf8");
    expect(parseSummary(root).fields.scope).toBe("public");
    const all = (await Promise.all(files.map((f) => readFile(join(out, f), "utf8")))).join("\n");
    expect(all).not.toContain("51 Pegasi");
    expect(all).not.toContain("Descartes");
  });

  it("pousse un unique commit et réécrit l'historique du dépôt public", async () => {
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
    expect(log[0]).toMatch(/^Publication du wiki — \d{4}-\d{2}-\d{2}$/);
    const tree = execFileSync("git", ["--git-dir", bare, "ls-tree", "-r", "--name-only", "main"], {
      encoding: "utf8",
    });
    expect(tree).toContain("wiki/science/astronomie/lune-noire/index.md");
    expect(tree).not.toContain("cogito");
  });

  it("refuse de publier une description publique générée à partir d'un nœud privé", async () => {
    const dir = await demoCopy();
    const path = join(dir, "wiki/religion-et-croyances/_summary.public.md");
    const text = await readFile(path, "utf8");
    await writeFile(
      path,
      text.replace("sources:\n", "sources:\n  01M6BK4140P9T3R69AH4Y8K1PA: 1234abc\n"),
    );
    const out = join(await temp("eugenia-out-"), "public");
    const { log, lines } = logger();
    expect(await main(["publish", dir, "--out", out], log)).toBe(1);
    expect(lines.join("\n")).toContain("nœud privé « Article sur Lilith »");
    expect(await readdir(out).catch(() => [])).toEqual([]);
  });

  it("exige une cible", async () => {
    await expect(main(["publish", DEMO], logger().log)).rejects.toThrow(/--target/);
  });
});

describe("eugenia summarize", () => {
  it("régénère les descriptions périmées, des plus profondes vers la racine", async () => {
    const dir = await demoCopy();
    const apogee = join(dir, "wiki/science/astronomie/apogee/index.md");
    await writeFile(
      apogee,
      (await readFile(apogee, "utf8")).replace("le plus éloigné", "le plus lointain"),
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
        "wiki/science/astronomie/_summary.md",
        "wiki/science/_summary.md",
        "wiki/_summary.md",
        "wiki/science/astronomie/_summary.public.md",
      ].map(async (p) => parseSummary(await readFile(join(dir, p), "utf8"))),
    );
    expect(
      written.every(
        (d) => d.body.startsWith("Description générée") && d.fields.model === "test-model",
      ),
    ).toBe(true);
    expect(
      parseSummary(await readFile(join(dir, "wiki/religion-et-croyances/_summary.md"), "utf8"))
        .body,
    ).toContain("Lilith");
    expect(provider.requests).toHaveLength(6);
    expect(provider.requests[0]!.messages[0]!.content).toContain("Titre : Astronomie");

    const wiki = await loadDiskWiki(dir);
    for (const scope of ["private", "public"] as SummaryScope[]) {
      const states = summaryStates(wiki.tree, scope, wiki.summaries);
      expect(
        [...states.values()].filter((s) => s.status === "stale" || s.status === "missing"),
      ).toEqual([]);
    }
  });

  it("n'envoie pas de contenu privé à un fournisseur distant avec --local-only-private", async () => {
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
    expect(lines.join("\n")).toContain("contenu privé et fournisseur distant");
    expect(provider.requests.length).toBe(0);
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

  it("écrit un _embedding.json par page, puis ne recalcule que les pages modifiées", async () => {
    const dir = await demoCopy();
    const provider = new EmbeddingProvider();
    expect(await run(dir, provider)).toBe(0);
    const pages = (await listFiles(dir)).filter((p) => p.endsWith("/index.md"));
    const embeddings = (await listFiles(dir)).filter((p) => p.endsWith("/_embedding.json"));
    expect(embeddings).toHaveLength(pages.length);
    const lilith = parseEmbedding(
      await readFile(join(dir, "wiki/religion-et-croyances/lilith/_embedding.json"), "utf8"),
    );
    expect(lilith.model).toBe("test-model");
    expect(provider.batches.flat().find((t) => t.startsWith("Lilith\n"))).toContain(
      "démon féminin",
    );

    expect(await run(dir, provider)).toBe(0);
    expect(provider.batches).toHaveLength(1);

    const apogee = join(dir, "wiki/science/astronomie/apogee/index.md");
    await writeFile(
      apogee,
      (await readFile(apogee, "utf8")).replace("le plus éloigné", "le plus lointain"),
    );
    await run(dir, provider);
    expect(provider.batches).toHaveLength(2);
    expect(provider.batches[1]).toHaveLength(1);
    expect(provider.batches[1]![0]).toContain("le plus lointain");

    // Les embeddings ne sont jamais publiés.
    const out = await temp("eugenia-public-");
    expect(await main(["publish", dir, "--out", out], logger().log)).toBe(0);
    const published = await listFiles(out);
    expect(published).toContain("wiki/religion-et-croyances/lilith/index.md");
    expect(published.filter((p) => p.includes("_embedding"))).toEqual([]);
  });

  it("n'envoie que les pages publiques à un fournisseur distant avec --local-only-private", async () => {
    const dir = await demoCopy();
    const provider = new EmbeddingProvider();
    (provider.info as { local: boolean }).local = false;
    await run(dir, provider, { localOnlyPrivate: true });
    const wiki = await loadDiskWiki(dir);
    const nodes = [...wiki.tree.nodes.values()].filter((n) => !n.virtual);
    expect(nodes.filter((n) => n.embedding).every((n) => n.isPublic)).toBe(true);
    expect(nodes.filter((n) => n.isPublic).every((n) => n.embedding)).toBe(true);
  });
});
