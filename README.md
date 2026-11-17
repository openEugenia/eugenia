# Eugenia

**Wiki personnel de connaissances, sur git.** Eugenia aide chacun à extraire, structurer et
mémoriser durablement les connaissances de son quotidien, puis à les partager. Eugenia est à la
fois le nom du projet et celui de l'assistante IA qui accompagne l'utilisateur.

- Vos connaissances sont des **fichiers Markdown dans vos propres dépôts git** : un dépôt privé
  qui contient tout, un dépôt public généré avec ce que vous choisissez de partager. Aucune base
  de données centrale ; un compte GitHub gratuit suffit.
- Elles forment un **arbre** : chaque sous-wiki est **décrit par Eugenia**, du plus fin au plus global.
- Eugenia **extrait des connaissances atomiques** (flashcards) de vos notes, textes et PDF, puis
  vous aide à les **réviser** par des quiz conversationnels, avec une maîtrise qui décline avec le temps.
- **Une seule instance** de l'application, publiée par openEugenia sur GitHub Pages, sert tous
  les utilisateurs : chacun l'ouvre sur son propre dépôt. Elle fonctionne **hors ligne** (PWA).

Application : <https://openeugenia.github.io/eugenia/> · Spécifications : [`specifications/`](specifications/README.md)

## Démarrer

### Créer son wiki

Avec la CLI (Node.js 22.12 ou plus, pnpm 10, [GitHub CLI](https://cli.github.com/) connectée) :

```sh
git clone https://github.com/openEugenia/eugenia.git && cd eugenia
pnpm install && pnpm --filter @openeugenia/cli build
node packages/cli/dist/eugenia.mjs init ../mon-wiki --title "Mon wiki" --github
```

`--github` crée le dépôt privé, le dépôt public, la clé de déploiement et le secret de
publication. Sans cette option, seuls les fichiers sont créés (configuration, racine et les
15 catégories par défaut). On peut aussi créer le wiki depuis l'application (« Nouveau wiki »)
dans un dépôt privé vide.

### L'ouvrir

1. Créez un [jeton fine-grained](https://github.com/settings/personal-access-tokens/new) limité au
   dépôt privé du wiki, avec la permission « Contents » en lecture et écriture.
2. Ouvrez `https://openeugenia.github.io/eugenia/?repo=<compte>/<dépôt>` et saisissez le jeton
   dans les paramètres, ainsi que votre fournisseur d'IA (clé Claude, serveur compatible OpenAI ou
   Ollama local).

N'importe qui peut lire votre partie publique avec `?repo=<compte>/<dépôt-public>` ; vous, avec
votre jeton, y voyez aussi la partie privée.

### Publier la partie publique

Chaque push sur le dépôt privé déclenche l'action [`openEugenia/eugenia`](action.yml), qui publie
les seuls nœuds publics dans le dépôt public, en réécrivant son historique. Voir
[docs/publication.md](docs/publication.md).

## Fonctionnalités (v1)

| | |
|---|---|
| **Wiki** | Arbre repliable, descriptions des sous-wikis, jauges de maîtrise, rétroliens, recherche plein texte, graphe radial, tableau de bord. |
| **Édition** | Notes en Markdown (CodeMirror), connaissances atomiques (énoncé, cible en gras, question, réponse), sources et fichiers personnels, liens par recherche de titre (`[[`). Renommer ou déplacer une page réécrit ses liens entrants. Toutes les modifications partent en un seul commit. |
| **Visibilité** | Privé par défaut ; une page publique n'a jamais d'ancêtre privé ; les liens vers le privé deviennent du texte à la publication ; les fichiers personnels et les quiz ne sont jamais publiés. |
| **Extraction** | Depuis une note, une discussion, un texte collé ou un PDF : surlignage par Eugenia et par vous, propositions de flashcards et de catégories, création en un commit. |
| **Révision** | Quiz par maîtrise croissante, évaluation par Eugenia ou auto-évaluation hors ligne, maîtrise recalculée en rejouant les quiz, rappels. |
| **Discussions** | Avec Eugenia depuis n'importe quelle page, résumé de l'échange, extraction ; questions sur tout l'arbre avec citations. |
| **IA** | Claude (par défaut `claude-opus-5-5`), tout fournisseur compatible OpenAI, Ollama. Option « IA locale pour le privé ». Prompts versionnés et surchargeables. |
| **Hors ligne** | Copie locale (IndexedDB), file de commits, résolution de conflits nœud par nœud. |

Prévu après la v1 (spécification §14) : connexion « avec GitHub » (GitHub App), transcription
audio et vidéo, notifications, fonctions sociales (similarité entre wikis, discussions publiques,
fil d'actualité).

## Organisation du dépôt

```
packages/
  core/   Modèle de données : format des nœuds, arbre, nommage, liens, visibilité,
          publication, descriptions périmées, algorithme de maîtrise. Sans dépendance
          navigateur ni Node.
  ai/     Eugenia : fournisseurs (Claude via le SDK officiel, compatible OpenAI, Ollama),
          prompts (prompts/*.md) et tâches (extraction, descriptions, évaluation,
          discussion, questions sur l'arbre).
  cli/    `eugenia init | validate | publish | summarize`, construite en un seul fichier
          et utilisée par l'action de publication.
  web/    Application React (PWA) : vues, synchronisation git, copie hors ligne.
examples/demo-wiki/   Wiki de démonstration (dépôt privé type).
docs/                 Format de stockage, publication.
action.yml            GitHub Action de publication.
specifications/       Spécifications et documentation fonctionnelle.
```

## Développer

Prérequis : Node.js 22.12 ou plus, pnpm 10 (`npx pnpm@10` convient).

```sh
pnpm install
pnpm dev          # application sur http://localhost:5173/eugenia/
pnpm test         # tests unitaires (core, ai, cli, web)
pnpm test:e2e     # tests de bout en bout (Playwright ; GitHub et Claude simulés)
pnpm typecheck
pnpm build        # application (packages/web/dist) et CLI (packages/cli/dist)
pnpm eugenia validate examples/demo-wiki
```

Voir [CONTRIBUTING.md](CONTRIBUTING.md) pour les conventions.

## Documentation

- [Format de stockage](docs/format.md) : modifier un wiki à la main, sans l'application.
- [Publication](docs/publication.md) : dépôts, clé de déploiement, action.
- [Prompts d'Eugenia](packages/ai/prompts/README.md) : ce qui est demandé à l'IA, et comment le surcharger.
- [Spécifications](specifications/README.md) et [documentation fonctionnelle](specifications/functional_doc/).

## Licence

[MIT](LICENSE). La charte graphique openEugenia, incluse dans `packages/web/src/vendor/`, est
également sous licence MIT.
