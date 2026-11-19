# Contribuer à Eugenia

## Mise en place

```sh
pnpm install
pnpm --filter @openeugenia/web exec playwright install chromium   # pour les tests de bout en bout
```

## Conventions

- **TypeScript strict** partout (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`), imports
  relatifs avec l'extension `.ts`.
- **`core` ne dépend ni du navigateur ni de Node** : chemins POSIX, WebCrypto, aucune E/S. Les
  accès aux fichiers passent par un lecteur (`readText`) fourni par l'appelant.
- **Interface et messages en français.** Les textes destinés à l'utilisateur expliquent la règle
  appliquée (visibilité, conflit, IA locale…).
- **Les fichiers écrits restent lisibles à la main** : ordre des clés stable, pas de valeur vide,
  contenu Markdown préservé (les liens sont réécrits sans reformater le reste).
- **Aucun contenu privé ne doit pouvoir atteindre le dépôt public** : toute évolution de la
  publication s'accompagne d'un test dans `packages/core/test/publish.test.ts`.
- Formatage : `pnpm format` (Prettier).

## Tests

| Commande | Portée |
|---|---|
| `pnpm test` | Vitest : `core`, `ai` (fournisseurs simulés), `cli` (dépôts git temporaires), `web` (logique de synchronisation). |
| `pnpm test:e2e` | Playwright sur l'application construite ; GitHub (REST, GraphQL, raw, commits) et l'API Claude sont simulés en mémoire (`packages/web/e2e/fakes.ts`). |
| `pnpm test:live` | Vitest contre de vraies API d'IA (`packages/ai/test/live/`) : fournisseur compatible OpenAI et évaluation des quiz, avec Mistral. Clé `MISTRAL_API_KEY` lue dans le `.env` de la racine (ignoré par git) ; sans clé, les tests sont ignorés. Hors CI : lents et soumis au quota gratuit (2 requêtes par minute et par modèle). |

## Prompts

Les prompts sont dans `packages/ai/prompts/*.md` et embarqués dans
`packages/ai/src/prompts/defaults.generated.ts`. Après modification :

```sh
pnpm --filter @openeugenia/ai prompts
```

Un test et la CI vérifient que le module embarqué est à jour.

## Versions

Une version est publiée par un tag `vX.Y.Z` : la CI construit et déploie l'application sur
GitHub Pages. Le tag majeur `v1` de l'action de publication suit la dernière version compatible.
