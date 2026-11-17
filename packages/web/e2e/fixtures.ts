import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { buildPublication, gitBlobSha, loadWiki } from "@openeugenia/core";
import { FakeRepo, readDirectory } from "./fakes.ts";

export const DEMO_DIR = join(import.meta.dirname, "..", "..", "..", "examples", "demo-wiki");
export const TOKEN = "github_pat_test";

/** Dépôt privé (wiki de démonstration) et dépôt public qui en est publié. */
export async function demoRepos(): Promise<{ privateRepo: FakeRepo; publicRepo: FakeRepo }> {
  const files = readDirectory(DEMO_DIR);
  const privateRepo = new FakeRepo("alice/eugenia-wiki", files, true);
  const repoFiles = await Promise.all(
    [...files].map(async ([path, content]) => ({
      path,
      sha: await gitBlobSha(new Uint8Array(content)),
    })),
  );
  const readText = async (path: string): Promise<string> => files.get(path)!.toString("utf8");
  const wiki = await loadWiki({ files: repoFiles, readText });
  const publication = await buildPublication(
    { config: wiki.config, tree: wiki.tree, files: wiki.files, readText },
    { privateRepo: "alice/eugenia-wiki", publicRepo: "alice/eugenia-wiki-public" },
  );
  if (!publication.ok) throw new Error("Publication de démonstration invalide");
  const out = new Map<string, Buffer>();
  for (const file of publication.files)
    out.set(file.path, "content" in file ? Buffer.from(file.content) : files.get(file.copyFrom)!);
  return { privateRepo, publicRepo: new FakeRepo("alice/eugenia-wiki-public", out, false) };
}

export async function saveSettings(
  page: Page,
  options: { token?: string; anthropicKey?: string },
): Promise<void> {
  await page.goto("#/settings");
  await expect(page.getByRole("heading", { name: "Paramètres", level: 1 })).toBeVisible();
  if (options.token)
    await page.getByLabel("Jeton d'accès personnel (fine-grained)").fill(options.token);
  if (options.anthropicKey) {
    await page.locator("#main-kind").selectOption("anthropic");
    await page.locator("#main-key").fill(options.anthropicKey);
  }
  await page.getByRole("button", { name: "Enregistrer les paramètres" }).click();
  if (options.anthropicKey) {
    // Première configuration d'une IA : question sur les nœuds privés.
    await expect(page.getByText("Connaissances privées et IA")).toBeVisible();
    await page.getByRole("button", { name: "Non, utiliser mon fournisseur" }).click();
  }
  await expect(page.getByText("Paramètres enregistrés.")).toBeVisible();
}

export function sidebar(page: Page) {
  return page.locator("aside.sidebar");
}
