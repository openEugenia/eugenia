import { join } from "node:path";
import { expect, type Page } from "@playwright/test";
import { buildPublication, gitBlobSha, loadWiki } from "@openeugenia/core";
import { FakeRepo, readDirectory } from "./fakes.ts";

export const DEMO_DIR = join(import.meta.dirname, "..", "..", "..", "examples", "demo-wiki");
export const TOKEN = "github_pat_test";

/** Private repository (demo wiki) and the public repository published from it. */
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
  if (!publication.ok) throw new Error("Invalid demo publication");
  const out = new Map<string, Buffer>();
  for (const file of publication.files)
    out.set(file.path, "content" in file ? Buffer.from(file.content) : files.get(file.copyFrom)!);
  return { privateRepo, publicRepo: new FakeRepo("alice/eugenia-wiki-public", out, false) };
}

export async function saveSettings(
  page: Page,
  options: { token?: string; anthropicKey?: string; autoSummarize?: boolean },
): Promise<void> {
  await page.goto("#/settings");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  // Descriptions re-evaluated in the background: off unless a test is about them.
  await page
    .getByLabel(/Re-evaluate the stale descriptions automatically/)
    .setChecked(options.autoSummarize === true);
  if (options.token)
    await page.getByLabel("Personal access token (fine-grained)").fill(options.token);
  if (options.anthropicKey) {
    await page.locator("#main-kind").selectOption("anthropic");
    await page.locator("#main-key").fill(options.anthropicKey);
  }
  await page.getByRole("button", { name: "Save the settings" }).click();
  if (options.anthropicKey) {
    // First AI configuration: question about private nodes.
    await expect(page.getByText("Private knowledge and AI")).toBeVisible();
    await page.getByRole("button", { name: "No, use my provider" }).click();
  }
  await expect(page.getByText("Settings saved.")).toBeVisible();
}

export function sidebar(page: Page) {
  return page.locator("aside.sidebar");
}
