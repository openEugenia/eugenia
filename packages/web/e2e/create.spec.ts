import { expect, test } from "@playwright/test";
import { FakeRepo, installFakeGitHub } from "./fakes.ts";
import { saveSettings, sidebar, TOKEN } from "./fixtures.ts";

test("creates a wiki in an empty private repository, with the default categories", async ({
  page,
}) => {
  const empty = new FakeRepo("alice/new-wiki", new Map(), true);
  await installFakeGitHub(page, { token: TOKEN, repos: [empty] });
  await saveSettings(page, { token: TOKEN });
  await page.goto("?repo=alice/new-wiki");
  await expect(page.getByText("This repository does not contain a wiki yet")).toBeVisible();
  await page.getByRole("link", { name: "the wiki creation page" }).click();
  await page.getByLabel("Private repository").fill("alice/new-wiki");
  await page.getByLabel("Wiki title").fill("My knowledge");
  await page.getByRole("button", { name: "Create the wiki" }).click();
  await expect(page.getByRole("heading", { name: "My knowledge", level: 1 })).toBeVisible();
  await expect(sidebar(page).getByRole("link", { name: "Religion and beliefs" })).toBeVisible();
  const paths = empty.paths();
  expect(paths.filter((p) => p.endsWith("/index.md"))).toHaveLength(16);
  expect(paths).toContain(".notes/config.yml");
  expect(paths).toContain(".github/workflows/eugenia-publish.yml");
  expect(empty.read(".notes/config.yml")).toContain("private_repo: alice/new-wiki");
  expect(empty.read(".github/workflows/eugenia-publish.yml")).toContain(
    "target: alice/new-wiki-public",
  );
});
