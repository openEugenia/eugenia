import { expect, test } from "@playwright/test";
import { installFakeGitHub } from "./fakes.ts";
import { demoRepos, sidebar } from "./fixtures.ts";

test.describe("lecture publique (anonyme)", () => {
  test("affiche la partie publique du wiki, sans contenu privé", async ({ page }) => {
    const { publicRepo } = await demoRepos();
    await installFakeGitHub(page, { token: "inutile", repos: [publicRepo], raw: [publicRepo] });
    await page.goto("?repo=alice/eugenia-wiki-public");

    await expect(
      page.getByRole("heading", { name: "Wiki de démonstration", level: 1 }),
    ).toBeVisible();
    await expect(
      page
        .getByText("La partie publique", { exact: false })
        .or(page.getByText("Ce wiki de démonstration rassemble")),
    ).toBeVisible();
    await expect(sidebar(page).getByRole("link", { name: "Religion et croyances" })).toBeVisible();
    await expect(sidebar(page)).not.toContainText("Philosophie");
    await expect(sidebar(page)).not.toContainText("Première exoplanète");
    await expect(page.locator(".app-bar")).toContainText("Public");

    await sidebar(page).getByRole("link", { name: "Religion et croyances" }).click();
    await expect(
      page.getByRole("heading", { name: "Religion et croyances", level: 1 }),
    ).toBeVisible();
    await page
      .locator(".children-grid")
      .getByRole("link", { name: /^Lilith/ })
      .first()
      .click();
    await expect(page.locator(".knowledge")).toContainText("démon féminin de la tradition juive");
    await page.getByRole("button", { name: "Révéler la réponse" }).click();
    await expect(page.locator(".card-face")).toContainText("Réponse attendue");
    await expect(page.getByRole("link", { name: "Wikipédia, article « Lilith »" })).toBeVisible();
    await expect(page.getByText("Article sur Lilith")).toHaveCount(0);
  });

  test("recherche plein texte", async ({ page }) => {
    const { publicRepo } = await demoRepos();
    await installFakeGitHub(page, { token: "inutile", repos: [publicRepo], raw: [publicRepo] });
    await page.goto("?repo=alice/eugenia-wiki-public#/search?q=apogee");
    await expect(page.getByRole("heading", { name: "Recherche", level: 1 })).toBeVisible();
    await expect(page.locator("main").getByRole("link", { name: "Apogée" })).toBeVisible();
    await expect(page.locator("main").getByRole("link", { name: "Lune noire" })).toBeVisible();
  });

  test("signale un dépôt qui n'est pas un wiki", async ({ page }) => {
    const { publicRepo } = await demoRepos();
    await installFakeGitHub(page, { token: "inutile", repos: [publicRepo], raw: [publicRepo] });
    await page.goto("?repo=alice/inconnu");
    await expect(page.getByText("Impossible d'ouvrir ce wiki")).toBeVisible();
  });

  test("page d'accueil", async ({ page }) => {
    await page.goto("");
    await expect(page.getByRole("heading", { name: "Eugenia" })).toBeVisible();
    await page.getByLabel("Dépôt GitHub").fill("pas un dépôt");
    await page.getByRole("button", { name: "Ouvrir" }).click();
    await expect(page.getByText("Indiquez un dépôt GitHub")).toBeVisible();
  });
});
