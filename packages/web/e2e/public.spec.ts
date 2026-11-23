import { expect, test } from "@playwright/test";
import { installFakeGitHub } from "./fakes.ts";
import { demoRepos, sidebar } from "./fixtures.ts";

test.describe("public reading (anonymous)", () => {
  test("shows the public part of the wiki, without private content", async ({ page }) => {
    const { publicRepo } = await demoRepos();
    await installFakeGitHub(page, { token: "unused", repos: [publicRepo], raw: [publicRepo] });
    await page.goto("?repo=alice/eugenia-wiki-public");

    await expect(page.getByRole("heading", { name: "Demo wiki", level: 1 })).toBeVisible();
    await expect(
      page.getByText("about the figure of Lilith in Jewish tradition", { exact: false }),
    ).toBeVisible();
    await expect(sidebar(page).getByRole("link", { name: "Religion and beliefs" })).toBeVisible();
    await expect(sidebar(page)).not.toContainText("Philosophy");
    await expect(sidebar(page)).not.toContainText("First exoplanet");
    await expect(page.locator(".app-bar")).toContainText("Public");

    await sidebar(page).getByRole("link", { name: "Religion and beliefs" }).click();
    await expect(
      page.getByRole("heading", { name: "Religion and beliefs", level: 1 }),
    ).toBeVisible();
    await page
      .locator(".children-grid")
      .getByRole("link", { name: /^Lilith/ })
      .first()
      .click();
    await expect(page.locator(".knowledge")).toContainText("female demon of Jewish tradition");
    // The public source is cited; so is the private one, through its bibliographic record.
    const sources = page.locator("section", {
      has: page.getByRole("heading", { name: "Sources", level: 2 }),
    });
    await expect(sources.getByRole("link", { name: "Wikipedia: Lilith" })).toBeVisible();
    await expect(sources.getByRole("link", { name: "Article on Lilith" })).toBeVisible();
    await expect(sources).toContainText("Record only");
    await expect(page.getByText("Extracted from")).toContainText("Article on Lilith");
    // Flashcards are viewed from their knowledge item.
    await page.locator(".flashcard-list a").first().click();
    await page.getByRole("button", { name: "Reveal the answer" }).click();
    await expect(page.locator(".card-face")).toContainText("Expected answer");
    await expect(page.locator(".card-face")).toContainText("Tested knowledge");
  });

  test("shows only the bibliographic record of a private source", async ({ page }) => {
    const { publicRepo } = await demoRepos();
    await installFakeGitHub(page, { token: "unused", repos: [publicRepo], raw: [publicRepo] });
    await page.goto("?repo=alice/eugenia-wiki-public#/library");
    await page.locator(".library-item", { hasText: "Article on Lilith" }).click();
    await expect(page.getByRole("heading", { name: "Article on Lilith", level: 1 })).toBeVisible();
    await expect(page.locator(".node-head")).toContainText("Record only");
    await expect(page.locator(".notice")).toContainText("Jane Doe");
    await expect(page.locator(".notice")).toContainText("https://example.org/lilith");
    await expect(page.locator("main")).toContainText("The content of this source is private");
    await expect(page.locator("main")).not.toContainText("stands for a deity");
    await expect(page.locator("main")).not.toContainText("article.pdf");
    // The public knowledge that cites it is listed.
    await expect(page.locator("main")).toContainText("Knowledge drawn from this source");
    await expect(
      page.locator("main").getByRole("link", { name: "Lilith", exact: true }),
    ).toBeVisible();
  });

  test("browses the public library", async ({ page }) => {
    const { publicRepo } = await demoRepos();
    await installFakeGitHub(page, { token: "unused", repos: [publicRepo], raw: [publicRepo] });
    await page.goto("?repo=alice/eugenia-wiki-public");
    await sidebar(page).getByRole("tab", { name: "Library" }).click();
    await expect(sidebar(page)).toContainText("Discourse on the Method");
    await expect(sidebar(page)).toContainText("Article on Lilith");
    await page.goto("?repo=alice/eugenia-wiki-public#/library");
    await expect(page.getByRole("heading", { name: "Library", level: 1 })).toBeVisible();
    await expect(page.locator(".library-item")).toHaveCount(4);
    await page.locator(".library-item", { hasText: "Wikipedia: Lilith" }).click();
    await expect(page.locator(".notice")).toContainText("Website");
    await expect(page.locator("main")).toContainText("Knowledge drawn from this source");
    await expect(
      page.locator("main").getByRole("link", { name: "Lilith", exact: true }),
    ).toBeVisible();
    // The index of a public source is published with it; the source is filed in its category.
    await page.goto("?repo=alice/eugenia-wiki-public#/n/01M6G9KPP03D31H8CGR4EZWQ50");
    await expect(page.locator(".source-filing")).toContainText(
      "Filed in Demo wiki › Science › Astronomy",
    );
    await expect(page.locator("#source-index")).toContainText("Apogee of the lunar orbit");
    expect(publicRepo.read("library/wikipedia-black-moon-lilith/_tree.json")).toBeDefined();
    expect(publicRepo.read("library/article-on-lilith/_tree.json")).toBeUndefined();
  });

  test("full-text search", async ({ page }) => {
    const { publicRepo } = await demoRepos();
    await installFakeGitHub(page, { token: "unused", repos: [publicRepo], raw: [publicRepo] });
    await page.goto("?repo=alice/eugenia-wiki-public#/search?q=apogee");
    await expect(page.getByRole("heading", { name: "Search", level: 1 })).toBeVisible();
    await expect(page.locator("main a strong").filter({ hasText: /^Apogee$/ })).toBeVisible();
    await expect(page.locator("main a strong").filter({ hasText: /^Black Moon$/ })).toBeVisible();
  });

  test("reports a repository that is not a wiki", async ({ page }) => {
    const { publicRepo } = await demoRepos();
    await installFakeGitHub(page, { token: "unused", repos: [publicRepo], raw: [publicRepo] });
    await page.goto("?repo=alice/unknown");
    await expect(page.getByText("Cannot open this wiki")).toBeVisible();
  });

  test("home page", async ({ page }) => {
    await page.goto("");
    await expect(page.getByRole("heading", { name: "Eugenia" })).toBeVisible();
    await page.getByLabel("GitHub repository").fill("not a repository");
    await page.getByRole("button", { name: "Open" }).click();
    await expect(page.getByText("Give a GitHub repository")).toBeVisible();
  });
});
