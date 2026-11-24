import { expect, test, type Page } from "@playwright/test";
import {
  installFakeClaude,
  installFakeGitHub,
  installFakeMistral,
  type FakeRepo,
} from "./fakes.ts";
import { demoRepos, saveSettings, sidebar, TOKEN } from "./fixtures.ts";

async function openOwner(
  page: Page,
  repos: { privateRepo: FakeRepo; publicRepo: FakeRepo },
  options: { ai?: boolean } = {},
): Promise<void> {
  await installFakeGitHub(page, {
    token: TOKEN,
    repos: [repos.privateRepo, repos.publicRepo],
    raw: [repos.publicRepo],
  });
  await saveSettings(page, {
    token: TOKEN,
    ...(options.ai ? { anthropicKey: "sk-ant-test" } : {}),
  });
  await page.goto("?repo=alice/eugenia-wiki");
  await expect(page.getByRole("heading", { name: "Demo wiki", level: 1 })).toBeVisible();
}

async function commitAll(page: Page): Promise<void> {
  await page.locator(".app-bar").getByTitle("Changes and synchronization").click();
  await expect(page.getByRole("heading", { name: "Changes", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Save to the repository" }).click();
  await expect(page.getByText("Changes saved to the repository.")).toBeVisible();
}

test.describe("owner", () => {
  test("sees the private wiki and the visibility of each node", async ({ page }) => {
    const repos = await demoRepos();
    await openOwner(page, repos);
    await expect(sidebar(page).getByRole("link", { name: "Philosophy and thought" })).toBeVisible();
    await expect(page.locator(".graph-card__description")).toContainText("Descartes' philosophy");
    await expect(page.locator(".app-bar")).not.toContainText("Read-only");
  });

  test("works from the unified graph alone: unfold, select, act on a card", async ({ page }) => {
    const repos = await demoRepos();
    await openOwner(page, repos);
    const graph = page.locator(".graph-canvas");
    const card = (title: string | RegExp) =>
      graph
        .locator(".react-flow__node")
        .filter({ has: page.locator(".graph-card__title", { hasText: title }) });
    // The focus is selected: its content and its actions.
    await expect(graph.getByRole("group", { name: "Actions on Demo wiki" })).toBeVisible();
    // Only the links of the tree are drawn.
    await expect(graph.locator(".react-flow__edge")).toHaveCount(
      await graph
        .locator(".react-flow__node")
        .count()
        .then((n) => n - 1),
    );
    await graph.getByRole("button", { name: /^Unfold Religion and beliefs/ }).click();
    await card(/^Lilith$/).click();
    await expect(card(/^Lilith$/).locator(".knowledge")).toContainText(
      "female demon of Jewish tradition",
    );
    await expect(
      card(/^Lilith$/).getByRole("link", { name: "Open the page", exact: true }),
    ).toBeVisible();
    // Unfolded branches are remembered.
    await page.reload();
    await expect(graph.getByRole("button", { name: /^Fold Religion and beliefs/ })).toBeVisible();

    // A source unfolds into the parts of its index; a part proposes its knowledge, added in
    // one click to the category of the source.
    await page.goto("?repo=alice/eugenia-wiki#/graph?root=01M6BSZRC0GMZD0N3KYADANR5K");
    await expect(page.getByRole("heading", { name: "Astronomy", level: 1 })).toBeVisible();
    await graph.getByRole("button", { name: /^Unfold Wikipedia: Black Moon Lilith/ }).click();
    await card("Mean and true Black Moon").click();
    await card("Mean and true Black Moon")
      .getByRole("button", { name: "Add it to my wiki" })
      .click();
    await expect(page.getByText("1 knowledge item added to your wiki.")).toBeVisible();
    expect(repos.privateRepo.log()[0]).toBe(
      'Knowledge "Difference between mean and true Black Moon", from "Wikipedia: Black Moon Lilith"',
    );
    await expect(card("Difference between mean and true Black Moon")).toBeVisible();

    // Dialogs open from the cards; the graph stays.
    await page.getByRole("button", { name: "Show everything" }).click();
    await card(/^Black Moon$/).click();
    await card(/^Black Moon$/)
      .getByRole("button", { name: "Move" })
      .click();
    await expect(page.getByRole("dialog")).toContainText('Move "Black Moon" under');
    await page.keyboard.press("Escape");

    // The side tree is optional, and stays hidden once hidden.
    await page.getByRole("button", { name: "Hide the side tree" }).click();
    await expect(sidebar(page)).toBeHidden();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Astronomy", level: 1 })).toBeVisible();
    await expect(sidebar(page)).toBeHidden();
    await page.getByRole("button", { name: "Show the side tree" }).click();
    await expect(sidebar(page)).toBeVisible();
  });

  test("switches from the public repository to the private one", async ({ page }) => {
    const repos = await demoRepos();
    await installFakeGitHub(page, {
      token: TOKEN,
      repos: [repos.privateRepo, repos.publicRepo],
      raw: [repos.publicRepo],
    });
    await saveSettings(page, { token: TOKEN });
    await page.goto("?repo=alice/eugenia-wiki-public");
    await expect(sidebar(page).getByRole("link", { name: "Philosophy and thought" })).toBeVisible();
  });

  test("edits a page and saves it in one commit", async ({ page }) => {
    const repos = await demoRepos();
    await openOwner(page, repos);
    await sidebar(page).getByRole("link", { name: "History" }).click();
    await page.getByRole("link", { name: "Edit", exact: true }).click();
    await page.locator(".cm-content").click();
    await page.keyboard.type("The great dates of history.");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator("main")).toContainText("The great dates of history.");
    await expect(page.locator(".app-bar")).toContainText("1 change(s) to save");
    await commitAll(page);
    expect(repos.privateRepo.read("wiki/history/index.md")).toContain(
      "The great dates of history.",
    );
    expect(repos.privateRepo.log()[0]).toBe('Edit "History"');
  });

  test("renames a page: folder renamed and incoming links rewritten", async ({ page }) => {
    const repos = await demoRepos();
    await openOwner(page, repos);
    await page.goto("?repo=alice/eugenia-wiki#/n/01M6GAPFZ0FMHD7Q6JQAKK3PHP/edit");
    await page.getByLabel("Title", { exact: true }).fill("Orbital apogee");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Orbital apogee", level: 1 })).toBeVisible();
    await commitAll(page);
    const paths = repos.privateRepo.paths();
    expect(paths).toContain("wiki/science/astronomy/orbital-apogee/index.md");
    expect(paths).not.toContain("wiki/science/astronomy/apogee/index.md");
    // Its flashcard follows the renamed folder.
    expect(paths).toContain(
      "wiki/science/astronomy/orbital-apogee/what-is-the-name-of-the-point-of/index.md",
    );
    expect(repos.privateRepo.read("wiki/science/astronomy/black-moon/index.md")).toContain(
      "(../orbital-apogee/index.md)",
    );
  });

  test("creates a private atomic knowledge item, its first flashcard and its source", async ({
    page,
  }) => {
    const repos = await demoRepos();
    await openOwner(page, repos);
    await page.goto("?repo=alice/eugenia-wiki#/n/01M6CEJY409R5NH5S6H1J8AM6Q/new?type=knowledge");
    await page.getByLabel("Title", { exact: true }).fill("Battle of Marignano");
    await page.locator(".cm-content").first().click();
    await page.keyboard.type("The Battle of Marignano took place in 1515.");
    await page.getByRole("button", { name: "New source", exact: true }).click();
    await page.getByLabel("Title of the new source").fill("History of France");
    await page.getByLabel("Kind of source").selectOption("book");
    await page.getByLabel("Location in the source").fill("ch. 4");
    await page.getByLabel("Question").fill("In what year did the Battle of Marignano take place?");
    await page.getByLabel("Expected answer").fill("1515");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Battle of Marignano", level: 1 }),
    ).toBeVisible();
    await expect(page.locator(".flashcard-list")).toContainText("In what year");
    await commitAll(page);
    const text = repos.privateRepo.read("wiki/history/battle-of-marignano/index.md")!;
    expect(text).toContain("type: knowledge");
    expect(text).toContain("visibility: private");
    expect(text).toMatch(/sources:\n {2}- ref: \w+\n {4}locator: ch\. 4/);
    const card = repos.privateRepo
      .paths()
      .find(
        (p) =>
          p.startsWith("wiki/history/battle-of-marignano/") &&
          p !== "wiki/history/battle-of-marignano/index.md",
      );
    expect(repos.privateRepo.read(card!)).toContain("## Expected answer\n1515");
    expect(repos.privateRepo.read(card!)).not.toContain("visibility:");
    expect(repos.privateRepo.read("library/history-of-france/index.md")).toContain("kind: book");
  });

  test("self-assessed quiz: the review is saved", async ({ page }) => {
    const repos = await demoRepos();
    await openOwner(page, repos);
    await page.goto("?repo=alice/eugenia-wiki#/n/01M6B8TE80FWZWZ9A13320JP2Z/quiz");
    await page.getByLabel(/Self-assessment/).check();
    await page.getByRole("button", { name: "Start" }).click();
    await page.getByRole("button", { name: "Reveal the answer" }).click();
    await page.getByRole("button", { name: /1 — known/ }).click();
    // Below the feedback: the card opens or is edited in another tab, without leaving the quiz.
    const edit = page.getByRole("link", { name: "Edit the card" });
    await expect(edit).toHaveAttribute("href", /^#\/n\/[^/]+\/edit$/);
    await expect(edit).toHaveAttribute("target", "_blank");
    await page.getByRole("button", { name: "Next question" }).click();
    await page.getByRole("button", { name: "Reveal the answer" }).click();
    await page.getByRole("button", { name: /0 — to review/ }).click();
    // Three flashcards in the branch, two of them on the "Lilith" knowledge item.
    await page.getByRole("button", { name: "Next question" }).click();
    await page.getByRole("button", { name: "Reveal the answer" }).click();
    await page.getByRole("button", { name: /1 — known/ }).click();
    await page.getByRole("button", { name: "Finish" }).click();
    await expect(page.getByText("Quiz finished")).toBeVisible();
    await expect(page.getByText("Changes saved to the repository.")).toBeVisible();
    const quiz = repos.privateRepo
      .paths()
      .find(
        (p) =>
          p.startsWith("discussions/") &&
          p.includes("quiz-religion-and-beliefs") &&
          !p.startsWith("discussions/2026-11-10-1030"),
      );
    expect(quiz).toBeTruthy();
    const text = repos.privateRepo.read(quiz!)!;
    expect(text).toContain("kind: quiz");
    expect(text).toContain('"role": "feedback", "score": 1, "self": true');
    expect(text).toContain('"score": 0, "self": true');
  });

  test("offline: changes are queued, then sent when the network is back", async ({
    page,
    context,
  }) => {
    const repos = await demoRepos();
    await openOwner(page, repos);
    // Without a service worker (disabled during tests), the views must be loaded before going offline.
    await page.locator(".app-bar").getByTitle("Changes and synchronization").click();
    await expect(page.getByRole("heading", { name: "Changes", level: 1 })).toBeVisible();
    await sidebar(page).getByRole("link", { name: "History" }).click();
    await page.getByRole("link", { name: "Edit", exact: true }).click();
    await expect(page.locator(".cm-content")).toBeVisible();
    await context.setOffline(true);
    await page.locator(".cm-content").click();
    await page.keyboard.type("Written offline.");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.locator(".app-bar").getByTitle("Changes and synchronization").click();
    await page.getByRole("button", { name: "Queue (offline)" }).click();
    await expect(page.getByRole("heading", { name: "Queued" })).toBeVisible();
    expect(repos.privateRepo.read("wiki/history/index.md")).not.toContain("Written offline.");
    await context.setOffline(false);
    await expect(page.getByText("Changes saved to the repository.")).toBeVisible();
    expect(repos.privateRepo.read("wiki/history/index.md")).toContain("Written offline.");
  });

  test("makes a page public with its ancestors, after confirmation", async ({ page }) => {
    const repos = await demoRepos();
    await openOwner(page, repos);
    await page.goto("?repo=alice/eugenia-wiki#/n/01M6NAM9G0N4ZZ728SJECX39T3");
    await page.getByRole("button", { name: "Make public" }).click();
    await expect(page.getByText("Flashcards follow the visibility")).toBeVisible();
    await expect(page.getByText("A public page cannot have a private ancestor")).toBeVisible();
    const confirm = page.getByRole("dialog").getByRole("button", { name: "Make public" });
    await expect(confirm).toBeDisabled();
    await page.getByLabel(/I also make these/).check();
    await confirm.click();
    await commitAll(page);
    expect(repos.privateRepo.read("wiki/philosophy-and-thought/index.md")).toContain(
      "visibility: public",
    );
    expect(repos.privateRepo.read("wiki/philosophy-and-thought/cogito/index.md")).toContain(
      "visibility: public",
    );
    // The flashcard inherits from its knowledge item, without its own visibility.
    expect(
      repos.privateRepo.read(
        "wiki/philosophy-and-thought/cogito/what-phrase-does-descartes-put/index.md",
      ),
    ).not.toContain("visibility:");
  });

  test("browses the library and the knowledge drawn from a source", async ({ page }) => {
    const repos = await demoRepos();
    await openOwner(page, repos);
    await sidebar(page).getByRole("tab", { name: "Library" }).click();
    await sidebar(page).getByRole("link", { name: "Article on Lilith" }).click();
    await expect(page.getByRole("heading", { name: "Article on Lilith", level: 1 })).toBeVisible();
    await expect(page.locator(".notice")).toContainText("article.pdf");
    // A private source: only its bibliographic record is published.
    await expect(page.locator("main")).toContainText("only its bibliographic record");
    const used = page.locator("section", { hasText: "Knowledge drawn from this source" });
    await expect(used.getByRole("link", { name: "Lilith", exact: true })).toBeVisible();
    await expect(used.getByRole("link", { name: "Lilith, Adam's first wife" })).toBeVisible();
    await page.goto("?repo=alice/eugenia-wiki#/library?kind=book");
    await expect(page.locator(".library-item")).toHaveCount(1);
    await expect(page.locator(".library-item")).toContainText("René Descartes");
    // A knowledge item without a source is reported.
    await expect(page.locator(".oe-alert", { hasText: "needing a source" })).toContainText(
      "First exoplanet",
    );
  });

  test("files the sources in the categories: counters in the tree, filtered views", async ({
    page,
  }) => {
    const repos = await demoRepos();
    await openOwner(page, repos);
    await page.goto("?repo=alice/eugenia-wiki#/n/01M6B8TE80FWZWZ9A13320JP2Z");
    const sources = page.locator("section", { hasText: "Add a source" });
    await expect(sources.getByRole("link", { name: "Article on Lilith" })).toBeVisible();
    await expect(sources.getByRole("link", { name: "Wikipedia: Lilith" })).toBeVisible();
    // In the tree, each branch counts its sources and discussions, discreetly.
    const row = (title: string) =>
      sidebar(page).locator(".tree-row", {
        has: page.getByRole("link", { name: title, exact: true }),
      });
    await expect(
      row("Demo wiki").getByRole("link", { name: "Sources of this branch: 4" }),
    ).toBeVisible();
    await expect(
      row("Demo wiki").getByRole("link", { name: "Discussions of this branch: 4" }),
    ).toBeVisible();
    await row("Religion and beliefs")
      .getByRole("link", { name: "Sources of this branch: 2" })
      .click();
    await expect(page.getByRole("heading", { name: "Library", level: 1 })).toBeVisible();
    await expect(page.locator(".library-item")).toHaveCount(2);
    await expect(sidebar(page).locator(".side-panel__filter")).toContainText(
      "In Religion and beliefs",
    );
    await sidebar(page).getByRole("tab", { name: "Wiki" }).click();
    await row("Religion and beliefs")
      .getByRole("link", { name: "Discussions of this branch: 2" })
      .click();
    await expect(page.getByRole("heading", { name: "Discussions", level: 1 })).toBeVisible();
    await expect(page.locator(".discussion-item")).toHaveCount(2);
    await expect(page.locator(".discussion-item").first()).toContainText(
      "Lilith and the Black Moon",
    );

    // A source page: where it is filed.
    await page.goto("?repo=alice/eugenia-wiki#/n/01M6BK4140P9T3R69AH4Y8K1PA");
    await expect(page.locator(".breadcrumb")).toContainText("Religion and beliefs");
    await expect(page.locator(".source-filing")).toContainText(
      "Filed in Demo wiki › Religion and beliefs",
    );

    // Filing a source elsewhere: one commit, the library follows.
    await page.goto("?repo=alice/eugenia-wiki#/n/01M6NACZ40H8ERX9S8220DYTMW");
    await page.locator(".source-filing").getByRole("button", { name: "Change" }).click();
    await page.getByLabel("Page title").fill("History");
    await page.getByRole("option", { name: /History/ }).click();
    await expect(page.getByText("Changes saved to the repository.")).toBeVisible();
    expect(repos.privateRepo.read("library/discourse-on-the-method/index.md")).toContain(
      "category: 01M6CEJY409R5NH5S6H1J8AM6Q",
    );
    await page.goto("?repo=alice/eugenia-wiki#/library?category=01M6CEJY409R5NH5S6H1J8AM6Q");
    await expect(page.locator(".library-item")).toHaveCount(1);
    await expect(page.locator(".library-item")).toContainText("In History");
  });

  test("browses the index of a source like the wiki", async ({ page }) => {
    const repos = await demoRepos();
    await openOwner(page, repos);
    await page.goto("?repo=alice/eugenia-wiki#/n/01M6G9KPP03D31H8CGR4EZWQ50");
    const index = page.locator("#source-index");
    await expect(index).toContainText("Up to date");
    await expect(index).toContainText("a mathematical point in the lunar orbit");
    await expect(index.locator(".child-card")).toHaveCount(4);
    // The proposed knowledge is not in the wiki: the user adds it if they wish.
    await expect(index.getByRole("button", { name: /Add these 6 items to my wiki/ })).toBeVisible();
    await expect(index.getByRole("link", { name: "Review first" })).toBeVisible();
    await index.locator(".child-card", { hasText: "A slow cycle" }).click();

    // A section: a page of its own, in the hierarchy of the wiki and of the source.
    await expect(page.getByRole("heading", { name: "A slow cycle", level: 1 })).toBeVisible();
    await expect(page.locator(".breadcrumb")).toContainText(
      "Demo wiki › Science › Astronomy › Wikipedia: Black Moon Lilith",
    );
    await expect(page.locator("main")).toContainText("nine years");
    // The library panel shows the index of the source, with the open section.
    const panel = sidebar(page);
    await expect(panel.getByRole("tab", { name: "Library" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(panel.locator(".tree-row.is-current")).toContainText("A slow cycle");
    await page
      .locator(".section-nav")
      .getByRole("link", { name: /The name/ })
      .click();
    await expect(page.getByRole("heading", { name: "The name", level: 1 })).toBeVisible();
    await panel.getByRole("link", { name: "A point, not a body" }).click();
    await expect(
      page.getByRole("heading", { name: "A point, not a body", level: 1 }),
    ).toBeVisible();
  });

  test("gathers all the discussions, filterable by kind", async ({ page }) => {
    const repos = await demoRepos();
    await openOwner(page, repos);
    await sidebar(page).getByRole("tab", { name: "Discussions" }).click();
    await expect(sidebar(page)).toContainText("Lilith and the Black Moon");
    await page.goto("?repo=alice/eugenia-wiki#/discussions");
    await expect(page.locator(".discussion-item")).toHaveCount(4);
    await page.getByRole("button", { name: /Quick note/ }).click();
    await expect(page.locator(".discussion-item")).toHaveCount(1);
    await page.locator(".discussion-item").click();
    await expect(page.getByRole("heading", { name: "51 Pegasi b", level: 1 })).toBeVisible();
    await expect(page.locator(".conversation")).toContainText("needs a source");
    // The knowledge extracted from the note points back to its original discussion.
    await page.goto("?repo=alice/eugenia-wiki#/n/01M6M29CX0YR71WFM59B6FRX44");
    await expect(page.getByText("Extracted from the discussion")).toBeVisible();
    // A quiz can be read again, not continued.
    await page.goto("?repo=alice/eugenia-wiki#/discussions?kind=quiz");
    await page.locator(".discussion-item").click();
    await expect(page.getByRole("link", { name: /Start another quiz/ })).toBeVisible();
    await expect(page.getByLabel("Your message")).toHaveCount(0);
  });
});

test.describe("Eugenia (simulated AI)", () => {
  test("regenerates a stale description, reviewed before the commit", async ({ page }) => {
    const repos = await demoRepos();
    const calls = await installFakeClaude(page, {
      summary: "New description of astronomy.",
    });
    await openOwner(page, repos, { ai: true });
    // A change makes the description of "Astronomy" stale.
    await page.goto("?repo=alice/eugenia-wiki#/n/01M6GAPFZ0FMHD7Q6JQAKK3PHP/edit");
    await page.locator(".cm-content").first().click();
    await page.keyboard.press("End");
    await page.keyboard.type(" It is the opposite of the perigee.");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator(".knowledge")).toContainText("the opposite of the perigee");
    await page.goto("?repo=alice/eugenia-wiki#/summaries?root=01M6BSZRC0GMZD0N3KYADANR5K");
    await page.getByRole("button", { name: /Regenerate the branch/ }).click();
    await page.getByRole("button", { name: "Understood, send" }).click();
    await expect(page.getByLabel("New description")).toHaveValue("New description of astronomy.");
    await page.getByRole("button", { name: "Accept" }).click();
    await page.getByRole("button", { name: "Save to the repository" }).click();
    await expect(page.getByText("Changes saved to the repository.")).toBeVisible();
    expect(repos.privateRepo.read("wiki/science/astronomy/_summary.md")).toContain(
      "New description of astronomy.",
    );
    expect(calls[0]!.model).toBe("claude-opus-5-5");
    expect(calls[0]!.messages[0]!.content).toContain("Title: Astronomy");
  });

  test("extracts knowledge from a pasted text into the categories Eugenia proposes, in one commit", async ({
    page,
  }) => {
    const repos = await demoRepos();
    const calls = await installFakeClaude(page, {
      highlights: ["Hypatia was a Greek mathematician", "She taught in Alexandria"],
      category: "Alexandrian scholars",
    });
    await openOwner(page, repos, { ai: true });
    await page.goto("?repo=alice/eugenia-wiki#/n/01M6B8TE80FWZWZ9A13320JP2Z/extract");
    await page.getByRole("tab", { name: "Paste a text" }).click();
    await page.getByLabel("Source title").fill("Notes on Hypatia");
    await page
      .getByLabel("Text", { exact: true })
      .fill("Hypatia was a Greek mathematician. She taught in Alexandria in the 4th century.");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Highlight with Eugenia" }).click();
    await page.getByRole("button", { name: "Understood, send" }).click();
    await expect(page.locator(".source-text mark")).toHaveCount(2);
    await page.getByRole("button", { name: "Propose knowledge" }).click();
    await expect(page.getByRole("heading", { name: "2 knowledge items to create" })).toBeVisible();
    // Eugenia files the knowledge of the document together, in a new category.
    const category = page.getByLabel("Title of the new category");
    await expect(category).toHaveValue("Alexandrian scholars");
    await expect(page.locator(".planned-category")).toContainText("2 knowledge items");
    await category.fill("Scholars of Alexandria");
    await expect(page.locator(".proposal select").first()).toContainText(
      "Demo wiki > Religion and beliefs > Scholars of Alexandria (new)",
    );
    const categorize = calls.find((c) => c.messages[0]!.content.includes("<document>"))!;
    expect(categorize.system).toContain("Wikipedia");
    expect(categorize.messages[0]!.content).toContain("Title: Notes on Hypatia");
    await page.getByRole("button", { name: "Create 2 knowledge items" }).click();
    await expect(page.getByRole("heading", { name: "2 knowledge items created" })).toBeVisible();
    await expect(page.getByText("In 1 new category:")).toBeVisible();
    await expect(page.getByText("Changes saved to the repository.")).toBeVisible();
    // The pasted text becomes a library source, cited by the knowledge.
    const source = repos.privateRepo.read("library/notes-on-hypatia/index.md")!;
    expect(source).toContain("type: source");
    const id = /^id: (\S+)$/m.exec(source)![1]!;
    expect(
      repos.privateRepo.read("wiki/religion-and-beliefs/scholars-of-alexandria/index.md"),
    ).toContain("title: Scholars of Alexandria");
    const knowledge = repos.privateRepo.read(
      "wiki/religion-and-beliefs/scholars-of-alexandria/knowledge-1/index.md",
    )!;
    expect(knowledge).toContain("type: knowledge");
    expect(knowledge).toContain(`extracted_from: ${id}`);
    expect(knowledge).toContain(`- ref: ${id}`);
    const card = repos.privateRepo
      .paths()
      .find((p) =>
        p.startsWith("wiki/religion-and-beliefs/scholars-of-alexandria/knowledge-1/question-1"),
      );
    expect(repos.privateRepo.read(card!)).toContain("type: flashcard");
    expect(repos.privateRepo.log()[0]).toBe(
      'Extraction: 2 knowledge items from "Notes on Hypatia"',
    );
    // Common hierarchy: the new source is filed where its knowledge goes.
    const categoryId = /^id: (\S+)$/m.exec(
      repos.privateRepo.read("wiki/religion-and-beliefs/scholars-of-alexandria/index.md")!,
    )![1]!;
    expect(source).toContain(`category: ${categoryId}`);
  });

  test("questions search the sources filed in the categories, down to the sections of their index", async ({
    page,
  }) => {
    const repos = await demoRepos();
    const source = "01M6G9KPP03D31H8CGR4EZWQ50";
    const section = `${source}#mean-and-true-black-moon`;
    const calls = await installFakeClaude(page, {
      // Goes down into the source filed in the category, then reads a section of its index.
      exploration: () => ({ explore: [source], read: [section], enough: false }),
      reply: `Astrologers compute a mean and a true Black Moon [Mean and true](eugenia:${section}).`,
    });
    await openOwner(page, repos, { ai: true });
    await page.goto("?repo=alice/eugenia-wiki#/n/01M6BSZRC0GMZD0N3KYADANR5K/ask");
    await page.getByLabel("Your question").fill("How is the Black Moon computed?");
    await page.getByRole("button", { name: "Ask Eugenia" }).click();
    await page.getByRole("button", { name: "Understood, send" }).click();
    const log = page.locator(".steps-log");
    await expect(log).toContainText('Goes down into "Wikipedia: Black Moon Lilith"');
    await expect(log).toContainText('Reads "Mean and true Black Moon"');
    await expect(page.locator(".oe-card")).toContainText("a mean and a true Black Moon");
    const based = page.locator("section", { hasText: "Based on" });
    const link = based.getByRole("link", { name: "Mean and true Black Moon" });
    await expect(link).toHaveAttribute("href", `#/n/${source}?s=mean-and-true-black-moon`);
    // The answer is based on what was read, and only on it.
    const answer = calls.at(-1)!;
    expect(answer.system).toContain("using only what you have read");
    expect(answer.messages[0]!.content).toContain("averaged orbit");
    // The cited section opens as a page of the index of its source.
    await link.click();
    await expect(
      page.getByRole("heading", { name: "Mean and true Black Moon", level: 1 }),
    ).toBeVisible();
  });

  test("indexes sources in the background, with the chosen model, while browsing", async ({
    page,
  }) => {
    const repos = await demoRepos();
    const mistral = await installFakeMistral(page, { chatDelayMs: 1500 });
    await openOwner(page, repos);
    await page.goto("?repo=alice/eugenia-wiki#/settings");
    await page.getByLabel("Mistral API key").fill("mistral-test");
    // The models of the indexing: Mistral Small without reasoning by default.
    await expect(page.getByLabel(/Mistral Small — without reasoning/)).toBeChecked();
    await page.getByRole("button", { name: "Save the settings" }).click();
    await expect(page.getByText("Settings saved.")).toBeVisible();

    await page.goto("?repo=alice/eugenia-wiki#/tasks");
    await expect(page.getByRole("heading", { name: "Eugenia's tasks", level: 1 })).toBeVisible();
    // The demo sources are already indexed.
    await expect(page.locator(".index-status--current")).toHaveCount(4);
    await expect(page.getByRole("button", { name: "Index 0 sources" })).toBeDisabled();
    await page.getByLabel("Indexing model").selectOption({ label: "Ministral 8B" });
    await page
      .locator(".library-item", { hasText: "Wikipedia: Lilith" })
      .getByRole("button", { name: "Index again" })
      .click();
    await expect(page.locator(".task-list")).toContainText("Index of Wikipedia: Lilith");
    // The user keeps browsing: the progress shows in the app bar.
    await page.goto("?repo=alice/eugenia-wiki#/n/01M6B8TE80FWZWZ9A13320JP2Z");
    await expect(page.locator(".app-bar").getByText("Indexing 0/1")).toBeVisible();
    await expect(page.getByText('"Wikipedia: Lilith" is indexed.')).toBeVisible();
    await expect(page.locator(".app-bar").getByText(/Indexing/)).toHaveCount(0);
    expect(mistral.chat).toEqual([{ model: "ministral-8b-latest", title: "Wikipedia: Lilith" }]);
    expect(repos.privateRepo.log()[0]).toBe('Index of "Wikipedia: Lilith"');
    expect(repos.privateRepo.read("library/wikipedia-lilith/_index/main-idea/index.md")).toContain(
      "**Wikipedia: Lilith**: Article of the collaborative encyclopedia",
    );
    // The proposed knowledge stays in the index: nothing is added to the wiki.
    expect(repos.privateRepo.paths().filter((p) => p.includes("main-idea-of"))).toEqual([]);
    // With search by meaning set up, the sections are embedded in the same commit.
    expect(
      repos.privateRepo.read("library/wikipedia-lilith/_index/_embeddings.json"),
    ).toBeDefined();
  });

  test("reviews the knowledge proposed by the index, filed in the category of the source", async ({
    page,
  }) => {
    const repos = await demoRepos();
    await installFakeClaude(page);
    await openOwner(page, repos, { ai: true });
    await page.goto("?repo=alice/eugenia-wiki#/n/01M6G9KPP03D31H8CGR4EZWQ50");
    await page.getByRole("link", { name: "Review first" }).click();
    // Only the categories of the branch of the source ("Astronomy", public) are sent: no
    // private content, no confirmation.
    // No highlighting: the proposals of the index are ready to review, in categories.
    await expect(page.getByRole("heading", { name: "6 knowledge items to create" })).toBeVisible();
    await expect(page.locator(".proposal").first()).toContainText("Black Moon");
    await page.getByRole("button", { name: "Create 6 knowledge items" }).click();
    await expect(page.getByRole("heading", { name: "6 knowledge items created" })).toBeVisible();
    await expect(page.getByText("Changes saved to the repository.")).toBeVisible();
    const created = repos.privateRepo
      .paths()
      .filter(
        (p) =>
          p.endsWith("/index.md") &&
          repos.privateRepo.read(p)!.includes("extracted_from: 01M6G9KPP03D31H8CGR4EZWQ50"),
      );
    expect(created).toHaveLength(6);
    // The knowledge of a source stays in its category ("Astronomy") or below it.
    expect(created.every((p) => p.startsWith("wiki/science/astronomy/"))).toBe(true);
  });

  test("adds one proposed knowledge item to the wiki in one click, without review", async ({
    page,
  }) => {
    const repos = await demoRepos();
    await installFakeClaude(page);
    await openOwner(page, repos, { ai: true });
    await page.goto(
      "?repo=alice/eugenia-wiki#/n/01M6G9KPP03D31H8CGR4EZWQ50?s=mean-and-true-black-moon",
    );
    await page
      .getByRole("button", { name: 'Add "Difference between mean and true Black Moon" to my wiki' })
      .click();
    await expect(page.getByText("1 knowledge item added to your wiki.")).toBeVisible();
    await expect(
      page.locator(".proposed-knowledge").getByRole("link", { name: "In your wiki" }),
    ).toBeVisible();
    const knowledge = repos.privateRepo
      .paths()
      .find(
        (p) =>
          p.endsWith("/index.md") &&
          repos.privateRepo.read(p)!.includes("title: Difference between mean and true Black Moon"),
      )!;
    expect(knowledge.startsWith("wiki/science/astronomy/")).toBe(true);
    const text = repos.privateRepo.read(knowledge)!;
    expect(text).toContain("extracted_from: 01M6G9KPP03D31H8CGR4EZWQ50");
    expect(text).toContain("- ref: 01M6G9KPP03D31H8CGR4EZWQ50");
    // With its first flashcard.
    const folder = knowledge.slice(0, -"index.md".length);
    expect(
      repos.privateRepo
        .paths()
        .some(
          (p) =>
            p.startsWith(folder) &&
            p !== knowledge &&
            repos.privateRepo.read(p)!.includes("type: flashcard"),
        ),
    ).toBe(true);
    expect(repos.privateRepo.log()[0]).toBe(
      'Knowledge "Difference between mean and true Black Moon", from "Wikipedia: Black Moon Lilith"',
    );
  });

  test("re-evaluates the stale descriptions in the background, without asking for each one", async ({
    page,
  }) => {
    const repos = await demoRepos();
    await installFakeClaude(page, { summary: "Description written in the background." });
    await installFakeGitHub(page, {
      token: TOKEN,
      repos: [repos.privateRepo, repos.publicRepo],
      raw: [repos.publicRepo],
    });
    await saveSettings(page, { token: TOKEN, anthropicKey: "sk-ant-test", autoSummarize: true });
    await page.goto("?repo=alice/eugenia-wiki");
    // A change makes the description of "Astronomy", then of its ancestors, stale.
    await page.goto("?repo=alice/eugenia-wiki#/n/01M6GAPFZ0FMHD7Q6JQAKK3PHP/edit");
    await page.locator(".cm-content").first().click();
    await page.keyboard.press("End");
    await page.keyboard.type(" It is the opposite of the perigee.");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator(".knowledge")).toContainText("the opposite of the perigee");
    await page.locator(".app-bar").getByTitle("Changes and synchronization").click();
    await page.getByRole("button", { name: "Save to the repository" }).click();
    // Once everything is saved, Eugenia re-evaluates the descriptions on her own.
    await page.getByRole("button", { name: "Understood, send" }).click();
    await page.goto("?repo=alice/eugenia-wiki#/tasks");
    await expect(page.getByText("Every description of your sub-wikis is up to date.")).toBeVisible({
      timeout: 20_000,
    });
    const log = repos.privateRepo.log();
    expect(log).toContain('Description of "Astronomy"');
    expect(log).toContain('Description of "Science"');
    // From the deepest sub-wiki to the root.
    expect(log.indexOf('Description of "Astronomy"')).toBeGreaterThan(
      log.indexOf('Description of "Science"'),
    );
    expect(repos.privateRepo.read("wiki/science/astronomy/_summary.md")).toContain(
      "Description written in the background.",
    );
  });

  test("suggests subcategories and creates the chosen one", async ({ page }) => {
    const repos = await demoRepos();
    await installFakeClaude(page);
    await openOwner(page, repos, { ai: true });
    await page.goto("?repo=alice/eugenia-wiki#/n/01M6B8TE80FWZWZ9A13320JP2Z");
    // The whole branch is public: no confirmation for sending private content.
    await page.getByRole("button", { name: "Suggest subcategories" }).click();
    await expect(page.getByText("Groups the mythological figures.")).toBeVisible();
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page.getByText('Category "Mythologies" created')).toBeVisible();
    await commitAll(page);
    expect(repos.privateRepo.read("wiki/religion-and-beliefs/mythologies/index.md")).toContain(
      "title: Mythologies",
    );
  });

  test("quiz evaluated by Eugenia: official answer and links to the card below the feedback", async ({
    page,
  }) => {
    const repos = await demoRepos();
    await installFakeClaude(page, { score: 0.6 });
    await openOwner(page, repos, { ai: true });
    await page.goto("?repo=alice/eugenia-wiki#/n/01M6B8TE80FWZWZ9A13320JP2Z/quiz");
    await page.getByRole("button", { name: "Start" }).click();
    await page.getByLabel("Your answer").fill("Lilith");
    await page.getByRole("button", { name: "Answer", exact: true }).click();
    const reference = page.locator(".message__reference");
    await expect(reference.getByText("Expected answer", { exact: true })).toBeVisible();
    await expect(reference.getByText("Knowledge", { exact: true })).toBeVisible();
    await expect(reference).toContainText("Lilith");
    await expect(reference.getByRole("link", { name: "Open the card" })).toHaveAttribute(
      "target",
      "_blank",
    );
    await expect(reference.getByRole("link", { name: "Edit the card" })).toHaveAttribute(
      "href",
      /^#\/n\/[^/]+\/edit$/,
    );
  });

  test("search by meaning: indexing in one commit, then pages close to a question", async ({
    page,
  }) => {
    const repos = await demoRepos();
    const mistral = await installFakeMistral(page);
    await openOwner(page, repos);
    await page.goto("?repo=alice/eugenia-wiki#/settings");
    await page.getByLabel("Mistral API key").fill("mistral-test");
    await page.getByRole("button", { name: "Save the settings" }).click();
    await expect(page.getByText("Settings saved.")).toBeVisible();

    await page.goto("?repo=alice/eugenia-wiki#/search");
    await page.getByLabel("By meaning").check();
    // Categories, knowledge and sources (flashcards repeat their knowledge item), discussions
    // (except quizzes) and the sections of the source indexes: 16 + 3 + 4.
    await expect(page.getByText("0 / 23 elements indexed")).toBeVisible();
    await expect(page.getByText("23 elements to index")).toBeVisible();
    await page.getByRole("button", { name: "Index 23 elements" }).click();
    // Private pages go to Mistral: same confirmations as for Eugenia.
    await page.getByRole("button", { name: "No, use my provider" }).click();
    await page.getByRole("button", { name: "Understood, send" }).click();
    await expect(page.getByText("Changes saved to the repository.")).toBeVisible();
    await expect(page.getByText("23 / 23 elements indexed")).toBeVisible();
    expect(repos.privateRepo.log()[0]).toBe("Semantic index: 23 element(s)");
    expect(
      JSON.parse(repos.privateRepo.read("wiki/religion-and-beliefs/lilith/_embedding.json")!),
    ).toMatchObject({ format: "eugenia-embedding", model: "mistral-embed", dimensions: 64 });
    expect(
      JSON.parse(
        repos.privateRepo.read("library/wikipedia-black-moon-lilith/_index/_embeddings.json")!,
      ),
    ).toMatchObject({ format: "eugenia-embeddings", model: "mistral-embed" });
    expect(
      repos.privateRepo.paths().filter((p) => p.startsWith("discussions/_embeddings/")),
    ).toHaveLength(3);
    expect(mistral.embeddings).toHaveLength(1);

    await page
      .locator(".page")
      .getByLabel("Search", { exact: true })
      .fill("What is the name of the point of an orbit farthest from the Earth?");
    const results = page.locator(".link-list > li");
    await expect(results.first()).toContainText("closeness");
    await expect(results.first().locator("a strong")).toHaveText("Apogee");
    expect(mistral.embeddings).toHaveLength(2);

    // Each indexed element gives access to its vector.
    await page.goto(
      "?repo=alice/eugenia-wiki#/n/01M6G9KPP03D31H8CGR4EZWQ50?s=mean-and-true-black-moon",
    );
    await page.locator(".embedding-panel > summary").click();
    await expect(page.locator(".embedding-panel")).toContainText("64 values · mistral-embed");
    await expect(page.locator(".embedding-panel")).toContainText("up to date");
    await expect(page.locator(".embedding-values > li")).toHaveCount(64);
    await page.goto("?repo=alice/eugenia-wiki#/n/01M6G9KPP03D31H8CGR4EZWQ50");
    await page.locator(".embedding-panel > summary").click();
    await expect(page.locator(".embedding-values > li")).toHaveCount(64);
  });

  test("quick note: Eugenia answers right away, the note is saved in the discussions", async ({
    page,
  }) => {
    const repos = await demoRepos();
    const calls = await installFakeClaude(page, {
      reply: "1. **Hypatia** taught in Alexandria. Remember to source it.",
    });
    await openOwner(page, repos, { ai: true });
    await sidebar(page).getByRole("tab", { name: "Discussions" }).click();
    await sidebar(page).getByRole("link", { name: "Note", exact: true }).click();
    await expect(page.getByRole("heading", { name: "New quick note", level: 1 })).toBeVisible();
    await page.getByLabel("Your message").fill("Hypatia taught in Alexandria.");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.getByRole("button", { name: "Understood, send" }).click();
    await expect(page.locator(".message--eugenia")).toContainText("Remember to source it.");
    expect(calls.at(-1)!.system).toContain("quick note");
    expect(calls.at(-1)!.system).toContain("<library>");
    await page.getByRole("button", { name: "Finish" }).click();
    await expect(page.getByRole("heading", { name: "Discussions", level: 1 })).toBeVisible();
    await expect(page.getByText("Changes saved to the repository.")).toBeVisible();
    const note = repos.privateRepo
      .paths()
      .find((p) => p.startsWith("discussions/") && p.includes("hypatia"))!;
    const text = repos.privateRepo.read(note)!;
    expect(text).toContain("kind: note");
    expect(text).toContain("Remember to source it.");
  });

  test("a discussion answers from the wiki, and records what the answer is based on", async ({
    page,
  }) => {
    const repos = await demoRepos();
    const lilith = "01M6DP0H707WPFZNQATGBZG5SB";
    const calls = await installFakeClaude(page, {
      exploration: () => ({
        explore: ["01M6B8TE80FWZWZ9A13320JP2Z"],
        read: [lilith],
        enough: false,
      }),
      reply: `Your wiki says [Lilith](eugenia:${lilith}) is a demon of Jewish tradition.`,
    });
    await openOwner(page, repos, { ai: true });
    await page.goto(`?repo=alice/eugenia-wiki#/n/${lilith}/discuss`);
    await page.getByLabel("Your message").fill("Who is Lilith?");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.getByRole("button", { name: "Understood, send" }).click();
    const reply = page.locator(".message--eugenia").last();
    await expect(reply).toContainText("demon of Jewish tradition");
    await expect(reply.locator(".message__sources")).toContainText("Based on Lilith");
    const discussion = calls.at(-1)!;
    expect(discussion.system).toContain("based only on the user's wiki");
    expect(discussion.system).toContain(`<knowledge>\n### Lilith (knowledge, ${lilith})`);
    await page.getByRole("button", { name: "Finish" }).click();
    await expect(page.getByText("Changes saved to the repository.")).toBeVisible();
    const file = repos.privateRepo
      .paths()
      .find((p) => p.startsWith("discussions/") && p.includes("who-is-lilith"))!;
    expect(repos.privateRepo.read(file)).toContain(`"based_on": ["${lilith}"]`);
  });

  test("proposes new flashcards for a knowledge item", async ({ page }) => {
    const repos = await demoRepos();
    await installFakeClaude(page);
    await openOwner(page, repos, { ai: true });
    await page.goto("?repo=alice/eugenia-wiki#/n/01M6GA4610GKWKVM8WDX8DG6R2");
    // Public knowledge item: no confirmation for sending private content.
    await page.getByRole("button", { name: "Propose flashcards" }).click();
    await expect(page.getByLabel("Question").first()).toHaveValue(
      "Which point do astrologers call Lilith?",
    );
    await page.getByRole("button", { name: "Add the selected flashcards" }).click();
    await expect(page.getByText("Changes saved to the repository.")).toBeVisible();
    await expect(page.locator(".flashcard-list > li")).toHaveCount(2);
    const added = repos.privateRepo
      .paths()
      .find((p) => p.startsWith("wiki/science/astronomy/black-moon/which-point"))!;
    expect(repos.privateRepo.read(added)).toContain("## Expected answer\nThe Black Moon");
  });
});
