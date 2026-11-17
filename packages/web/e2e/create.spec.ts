import { expect, test } from "@playwright/test";
import { FakeRepo, installFakeGitHub } from "./fakes.ts";
import { saveSettings, sidebar, TOKEN } from "./fixtures.ts";

test("crée un wiki dans un dépôt privé vide, avec les catégories par défaut", async ({ page }) => {
  const empty = new FakeRepo("alice/nouveau-wiki", new Map(), true);
  await installFakeGitHub(page, { token: TOKEN, repos: [empty] });
  await saveSettings(page, { token: TOKEN });
  await page.goto("?repo=alice/nouveau-wiki");
  await expect(page.getByText("Ce dépôt ne contient pas encore de wiki")).toBeVisible();
  await page.getByRole("link", { name: "la création de wiki" }).click();
  await page.getByLabel("Dépôt privé").fill("alice/nouveau-wiki");
  await page.getByLabel("Titre du wiki").fill("Mes connaissances");
  await page.getByRole("button", { name: "Créer le wiki" }).click();
  await expect(page.getByRole("heading", { name: "Mes connaissances", level: 1 })).toBeVisible();
  await expect(sidebar(page).getByRole("link", { name: "Religion et croyances" })).toBeVisible();
  const paths = empty.paths();
  expect(paths.filter((p) => p.endsWith("/index.md"))).toHaveLength(16);
  expect(paths).toContain(".notes/config.yml");
  expect(paths).toContain(".github/workflows/eugenia-publish.yml");
  expect(empty.read(".notes/config.yml")).toContain("private_repo: alice/nouveau-wiki");
  expect(empty.read(".github/workflows/eugenia-publish.yml")).toContain(
    "target: alice/nouveau-wiki-public",
  );
});
