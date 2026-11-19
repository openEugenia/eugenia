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
  await expect(
    page.getByRole("heading", { name: "Wiki de démonstration", level: 1 }),
  ).toBeVisible();
}

async function commitAll(page: Page): Promise<void> {
  await page.locator(".app-bar").getByTitle("Modifications et synchronisation").click();
  await expect(page.getByRole("heading", { name: "Modifications", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: "Enregistrer dans le dépôt" }).click();
  await expect(page.getByText("Modifications enregistrées dans le dépôt.")).toBeVisible();
}

test.describe("propriétaire", () => {
  test("voit le wiki privé et la visibilité de chaque nœud", async ({ page }) => {
    const repos = await demoRepos();
    await openOwner(page, repos);
    await expect(sidebar(page).getByRole("link", { name: "Philosophie et pensée" })).toBeVisible();
    await expect(page.locator(".description")).toContainText("philosophie de Descartes");
    await expect(page.locator(".app-bar")).not.toContainText("Lecture seule");
  });

  test("bascule du dépôt public vers le dépôt privé", async ({ page }) => {
    const repos = await demoRepos();
    await installFakeGitHub(page, {
      token: TOKEN,
      repos: [repos.privateRepo, repos.publicRepo],
      raw: [repos.publicRepo],
    });
    await saveSettings(page, { token: TOKEN });
    await page.goto("?repo=alice/eugenia-wiki-public");
    await expect(sidebar(page).getByRole("link", { name: "Philosophie et pensée" })).toBeVisible();
  });

  test("modifie une page et l'enregistre en un commit", async ({ page }) => {
    const repos = await demoRepos();
    await openOwner(page, repos);
    await sidebar(page).getByRole("link", { name: "Histoire" }).click();
    await page.getByRole("link", { name: "Modifier" }).click();
    await page.locator(".cm-content").click();
    await page.keyboard.type("Les grandes dates de l'histoire.");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.locator("main")).toContainText("Les grandes dates de l'histoire.");
    await expect(page.locator(".app-bar")).toContainText("1 modification(s) à enregistrer");
    await commitAll(page);
    expect(repos.privateRepo.read("wiki/histoire/index.md")).toContain(
      "Les grandes dates de l'histoire.",
    );
    expect(repos.privateRepo.log()[0]).toBe("Modifier « Histoire »");
  });

  test("renomme une page : dossier renommé et liens entrants réécrits", async ({ page }) => {
    const repos = await demoRepos();
    await openOwner(page, repos);
    await page.goto("?repo=alice/eugenia-wiki#/n/01M6C0VFM0SQ0N0FZWHWXYHRXB/edit");
    await page.getByLabel("Titre", { exact: true }).fill("Apogée orbitale");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(page.getByRole("heading", { name: "Apogée orbitale", level: 1 })).toBeVisible();
    await commitAll(page);
    const paths = repos.privateRepo.paths();
    expect(paths).toContain("wiki/science/astronomie/apogee-orbitale/index.md");
    expect(paths).not.toContain("wiki/science/astronomie/apogee/index.md");
    expect(repos.privateRepo.read("wiki/science/astronomie/lune-noire/index.md")).toContain(
      "(../apogee-orbitale/index.md)",
    );
  });

  test("crée une connaissance atomique privée par défaut", async ({ page }) => {
    const repos = await demoRepos();
    await openOwner(page, repos);
    await page.goto("?repo=alice/eugenia-wiki#/n/01M6CEJY409R5NH5S6H1J8AM6Q/new?type=flashcard");
    await page.getByLabel("Titre", { exact: true }).fill("Bataille de Marignan");
    await page.locator(".cm-content").first().click();
    await page.keyboard.type("La bataille de Marignan a eu lieu en 1515.");
    await page.getByLabel("Question").fill("En quelle année a eu lieu la bataille de Marignan ?");
    await page.getByLabel("Réponse attendue").fill("1515");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await expect(
      page.getByRole("heading", { name: "Bataille de Marignan", level: 1 }),
    ).toBeVisible();
    await commitAll(page);
    const text = repos.privateRepo.read("wiki/histoire/bataille-de-marignan/index.md")!;
    expect(text).toContain("type: flashcard");
    expect(text).toContain("visibility: private");
    expect(text).toContain("## Réponse attendue\n1515");
  });

  test("quiz en auto-évaluation : la révision est enregistrée", async ({ page }) => {
    const repos = await demoRepos();
    await openOwner(page, repos);
    await page.goto("?repo=alice/eugenia-wiki#/n/01M6B8TE80FWZWZ9A13320JP2Z/quiz");
    await page.getByLabel(/Auto-évaluation/).check();
    await page.getByRole("button", { name: "Commencer" }).click();
    await page.getByRole("button", { name: "Révéler la réponse" }).click();
    await page.getByRole("button", { name: /1 — acquise/ }).click();
    // Sous le retour : la fiche s'ouvre ou se modifie dans un autre onglet, sans quitter le quiz.
    const edit = page.getByRole("link", { name: "Modifier la fiche" });
    await expect(edit).toHaveAttribute("href", /^#\/n\/[^/]+\/edit$/);
    await expect(edit).toHaveAttribute("target", "_blank");
    await page.getByRole("button", { name: "Question suivante" }).click();
    await page.getByRole("button", { name: "Révéler la réponse" }).click();
    await page.getByRole("button", { name: /0 — à revoir/ }).click();
    await page.getByRole("button", { name: "Terminer" }).click();
    await expect(page.getByText("Quiz terminé")).toBeVisible();
    await expect(page.getByText("Modifications enregistrées dans le dépôt.")).toBeVisible();
    const quiz = repos.privateRepo
      .paths()
      .find(
        (p) =>
          p.startsWith("wiki/religion-et-croyances/_quizzes/") && !p.endsWith("2026-11-10-1030.md"),
      );
    expect(quiz).toBeTruthy();
    const text = repos.privateRepo.read(quiz!)!;
    expect(text).toContain("kind: quiz");
    expect(text).toContain('"role": "feedback", "score": 1, "self": true');
    expect(text).toContain('"score": 0, "self": true');
  });

  test("hors ligne : les modifications sont mises en file puis envoyées au retour du réseau", async ({
    page,
    context,
  }) => {
    const repos = await demoRepos();
    await openOwner(page, repos);
    // Sans service worker (désactivé pendant les tests), les vues doivent être chargées avant la coupure.
    await page.locator(".app-bar").getByTitle("Modifications et synchronisation").click();
    await expect(page.getByRole("heading", { name: "Modifications", level: 1 })).toBeVisible();
    await sidebar(page).getByRole("link", { name: "Histoire" }).click();
    await page.getByRole("link", { name: "Modifier" }).click();
    await expect(page.locator(".cm-content")).toBeVisible();
    await context.setOffline(true);
    await page.locator(".cm-content").click();
    await page.keyboard.type("Écrit hors ligne.");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await page.locator(".app-bar").getByTitle("Modifications et synchronisation").click();
    await page.getByRole("button", { name: "Mettre en file (hors ligne)" }).click();
    await expect(page.getByRole("heading", { name: "En file d'attente" })).toBeVisible();
    expect(repos.privateRepo.read("wiki/histoire/index.md")).not.toContain("Écrit hors ligne.");
    await context.setOffline(false);
    await expect(page.getByText("Modifications enregistrées dans le dépôt.")).toBeVisible();
    expect(repos.privateRepo.read("wiki/histoire/index.md")).toContain("Écrit hors ligne.");
  });

  test("rend une page publique avec ses ancêtres, après confirmation", async ({ page }) => {
    const repos = await demoRepos();
    await openOwner(page, repos);
    await page.goto("?repo=alice/eugenia-wiki#/n/01M6CB52G079754JK5TQAMTDVB");
    await page.getByRole("button", { name: "Rendre public" }).click();
    await expect(
      page.getByText("Une page publique ne peut pas avoir d'ancêtre privé"),
    ).toBeVisible();
    const confirm = page.getByRole("dialog").getByRole("button", { name: "Rendre public" });
    await expect(confirm).toBeDisabled();
    await page.getByLabel(/Je rends aussi publiques/).check();
    await confirm.click();
    await commitAll(page);
    expect(repos.privateRepo.read("wiki/philosophie-et-pensee/index.md")).toContain(
      "visibility: public",
    );
    expect(repos.privateRepo.read("wiki/philosophie-et-pensee/cogito/index.md")).toContain(
      "visibility: public",
    );
  });
});

test.describe("Eugenia (IA simulée)", () => {
  test("régénère une description périmée, relue avant le commit", async ({ page }) => {
    const repos = await demoRepos();
    const calls = await installFakeClaude(page, {
      summary: "Nouvelle description de l'astronomie.",
    });
    await openOwner(page, repos, { ai: true });
    // Une modification rend périmée la description d'« Astronomie ».
    await page.goto("?repo=alice/eugenia-wiki#/n/01M6C0VFM0SQ0N0FZWHWXYHRXB/edit");
    await page.getByLabel("Réponse attendue").fill("L'apogée (point le plus éloigné)");
    await page.getByRole("button", { name: "Enregistrer" }).click();
    await page.goto("?repo=alice/eugenia-wiki#/summaries?root=01M6BSZRC0GMZD0N3KYADANR5K");
    await page.getByRole("button", { name: /Régénérer la branche/ }).click();
    await page.getByRole("button", { name: "J'ai compris, envoyer" }).click();
    await expect(page.getByLabel("Nouvelle description")).toHaveValue(
      "Nouvelle description de l'astronomie.",
    );
    await page.getByRole("button", { name: "Accepter" }).click();
    await page.getByRole("button", { name: "Enregistrer dans le dépôt" }).click();
    await expect(page.getByText("Modifications enregistrées dans le dépôt.")).toBeVisible();
    expect(repos.privateRepo.read("wiki/science/astronomie/_summary.md")).toContain(
      "Nouvelle description de l'astronomie.",
    );
    expect(calls[0]!.model).toBe("claude-opus-5-5");
    expect(calls[0]!.messages[0]!.content).toContain("Titre : Astronomie");
  });

  test("extrait des connaissances d'un texte collé, en un seul commit", async ({ page }) => {
    const repos = await demoRepos();
    await installFakeClaude(page, {
      highlights: ["Hypatie était une mathématicienne grecque", "Elle enseignait à Alexandrie"],
    });
    await openOwner(page, repos, { ai: true });
    await page.goto("?repo=alice/eugenia-wiki#/n/01M6B8TE80FWZWZ9A13320JP2Z/extract");
    await page.getByRole("tab", { name: "Coller un texte" }).click();
    await page.getByLabel("Titre de la note source").fill("Notes sur Hypatie");
    await page
      .getByLabel("Texte", { exact: true })
      .fill(
        "Hypatie était une mathématicienne grecque. Elle enseignait à Alexandrie au IVe siècle.",
      );
    await page.getByRole("button", { name: "Continuer" }).click();
    await page.getByRole("button", { name: "Surligner avec Eugenia" }).click();
    await page.getByRole("button", { name: "J'ai compris, envoyer" }).click();
    await expect(page.locator(".source-text mark")).toHaveCount(2);
    await page.getByRole("button", { name: "Proposer des connaissances" }).click();
    await expect(page.getByRole("heading", { name: "2 connaissances à créer" })).toBeVisible();
    await page.getByRole("button", { name: "Créer 2 connaissances" }).click();
    await expect(page.getByRole("heading", { name: "2 connaissances créées" })).toBeVisible();
    await expect(page.getByText("Modifications enregistrées dans le dépôt.")).toBeVisible();
    const paths = repos.privateRepo.paths();
    expect(paths).toContain("wiki/religion-et-croyances/notes-sur-hypatie/index.md");
    const card = repos.privateRepo.read("wiki/religion-et-croyances/connaissance-1/index.md")!;
    expect(card).toContain("type: flashcard");
    expect(card).toContain("extracted_from:");
    expect(repos.privateRepo.log()[0]).toBe(
      "Extraction : 2 connaissances depuis « Notes sur Hypatie »",
    );
  });

  test("suggère des sous-catégories et crée celle choisie", async ({ page }) => {
    const repos = await demoRepos();
    await installFakeClaude(page);
    await openOwner(page, repos, { ai: true });
    await page.goto("?repo=alice/eugenia-wiki#/n/01M6B8TE80FWZWZ9A13320JP2Z");
    await page.getByRole("button", { name: "Suggérer des sous-catégories" }).click();
    await page.getByRole("button", { name: "J'ai compris, envoyer" }).click();
    await expect(page.getByText("Regroupe les figures mythologiques.")).toBeVisible();
    await page.getByRole("button", { name: "Créer", exact: true }).click();
    await expect(page.getByText("Catégorie « Mythologies » créée")).toBeVisible();
    await commitAll(page);
    expect(repos.privateRepo.read("wiki/religion-et-croyances/mythologies/index.md")).toContain(
      "title: Mythologies",
    );
  });

  test("quiz évalué par Eugenia : réponse officielle et liens vers la fiche sous le retour", async ({
    page,
  }) => {
    const repos = await demoRepos();
    await installFakeClaude(page, { score: 0.6 });
    await openOwner(page, repos, { ai: true });
    await page.goto("?repo=alice/eugenia-wiki#/n/01M6B8TE80FWZWZ9A13320JP2Z/quiz");
    await page.getByRole("button", { name: "Commencer" }).click();
    await page.getByLabel("Votre réponse").fill("Lilith");
    await page.getByRole("button", { name: "Répondre" }).click();
    const reference = page.locator(".message__reference");
    await expect(reference.getByText("Réponse attendue")).toBeVisible();
    await expect(reference.getByText("Connaissance")).toBeVisible();
    await expect(reference).toContainText("Lilith");
    await expect(reference.getByRole("link", { name: "Ouvrir la fiche" })).toHaveAttribute(
      "target",
      "_blank",
    );
    await expect(reference.getByRole("link", { name: "Modifier la fiche" })).toHaveAttribute(
      "href",
      /^#\/n\/[^/]+\/edit$/,
    );
  });

  test("recherche par le sens : indexation en un commit, puis pages proches d'une question", async ({
    page,
  }) => {
    const repos = await demoRepos();
    const mistral = await installFakeMistral(page);
    await openOwner(page, repos);
    await page.goto("?repo=alice/eugenia-wiki#/settings");
    await page.getByLabel("Clé API Mistral").fill("mistral-test");
    await page.getByRole("button", { name: "Enregistrer les paramètres" }).click();
    await expect(page.getByText("Paramètres enregistrés.")).toBeVisible();

    await page.goto("?repo=alice/eugenia-wiki#/search");
    await page.getByLabel("Par le sens").check();
    await expect(page.getByText("0 / 13 pages indexées · 13 pages à indexer")).toBeVisible();
    await page.getByRole("button", { name: "Indexer 13 pages" }).click();
    // Des pages privées partent vers Mistral : mêmes confirmations que pour Eugenia.
    await page.getByRole("button", { name: "Non, utiliser mon fournisseur" }).click();
    await page.getByRole("button", { name: "J'ai compris, envoyer" }).click();
    await expect(page.getByText("Modifications enregistrées dans le dépôt.")).toBeVisible();
    await expect(page.getByText("13 / 13 pages indexées")).toBeVisible();
    expect(repos.privateRepo.log()[0]).toBe("Index sémantique : 13 page(s)");
    expect(
      JSON.parse(repos.privateRepo.read("wiki/religion-et-croyances/lilith/_embedding.json")!),
    ).toMatchObject({ format: "eugenia-embedding", model: "mistral-embed", dimensions: 64 });
    expect(mistral.embeddings).toHaveLength(1);

    await page
      .locator(".page")
      .getByLabel("Recherche", { exact: true })
      .fill("Comment s'appelle le point le plus éloigné de la Terre sur une orbite ?");
    const results = page.locator(".link-list > li");
    await expect(results.first()).toContainText("proximité");
    await expect(results.first().locator("a strong")).toHaveText("Apogée");
    expect(mistral.embeddings).toHaveLength(2);
  });
});
