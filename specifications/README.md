# Spécifications — Eugenia : wiki personnel de connaissances, sur git

> Statut : brouillon v0.5 — 2026-11-17
> Ce document sert de point de départ au dépôt git du projet. Il traduit en spécifications techniques la documentation fonctionnelle du dossier [`functional_doc/`](functional_doc/), qui reste la référence pour le « quoi » et le « pourquoi ». Les points encore ouverts sont listés en §16.

---

## 1. Vision

**Eugenia** aide chacun à **extraire, structurer et mémoriser durablement** les connaissances de son quotidien, puis à les partager ([pitch](functional_doc/pitch.qmd)). Eugenia est à la fois le nom du projet et celui de l'**assistante IA** qui accompagne l'utilisateur ([intro](functional_doc/0_intro.qmd)).

Ce projet en est l'implémentation **décentralisée et open source** :

- Les connaissances de l'utilisateur sont des **fichiers Markdown dans ses propres dépôts git** (un privé, un public) : il est seul propriétaire de ses données, aucune base de données centrale. Un compte GitHub gratuit suffit.
- Elles forment un **arbre** : le **wiki personnel**. Chaque nœud parent (sous-wiki) est **résumé par Eugenia** à partir de ce qui se trouve plus bas.
- Eugenia propose des **connaissances atomiques** (flashcards) extraites des notes et sources de l'utilisateur, puis l'aide à les **renforcer** par des quiz conversationnels avec un score de maîtrise et un mécanisme de déclin.
- Les connaissances sont **publiques ou privées** : n'importe qui peut parcourir la partie publique d'un wiki, le propriétaire voit aussi sa partie privée.
- **Une seule instance** de l'application, publiée sur GitHub Pages par le compte **openEugenia**, sert tous les utilisateurs : chacun l'ouvre sur son propre dépôt.
- L'application fonctionne **hors ligne** (PWA) et se synchronise au retour du réseau.

L'utilisateur **ne manipule jamais les fichiers** : il ne voit qu'une hiérarchie de nœuds. Le format de stockage (§5) est un détail d'implémentation, mais il reste lisible et modifiable sans l'application.

## 2. Objectifs et non-objectifs

### Objectifs (v1)
1. Naviguer dans un wiki personnel hiérarchique à partir d'un dépôt git donné.
2. Créer, éditer, déplacer et supprimer des nœuds depuis l'interface, avec commit dans le dépôt.
3. Extraire des connaissances atomiques à partir de textes (notes, documents importés) avec l'aide d'Eugenia.
4. Générer et maintenir les descriptions des sous-wikis (résumés) en mode semi-automatique.
5. Renforcer les connaissances par des quiz conversationnels, avec suivi de la maîtrise et du déclin.
6. Discuter avec Eugenia à partir de n'importe quel nœud, et l'interroger sur tout l'arbre.
7. Séparer de façon fiable les connaissances publiques et privées.
8. Travailler hors ligne.

### Non-objectifs (v1)
Les fonctions **sociales** décrites dans la doc fonctionnelle ([§4](functional_doc/4_toward_social_network.qmd), [§5](functional_doc/5_discussion.qmd), [§6](functional_doc/6_other_sn_tools.qmd)) sont hors du périmètre v1, mais l'architecture doit les permettre plus tard (§14) :
- similarité entre wikis, suggestions de connexions, fil d'actualité, capsules (« reals ») ;
- discussions publiques à plusieurs participants (les discussions v1 sont **personnelles** : l'utilisateur et Eugenia) ;
- badges, trophées, classements ;
- portée automatique selon la maîtrise (une connaissance mal maîtrisée qui redevient privée).

Également hors périmètre : édition collaborative en temps réel, backend applicatif (hors éventuel micro-service d'authentification, §7), forges autres que GitHub, application mobile native (la PWA couvre l'usage mobile).

## 3. Glossaire

Les définitions fonctionnelles viennent de `functional_doc/`. Ce tableau précise leur traduction dans le modèle de données.

| Terme | Définition | Dans le modèle |
|---|---|---|
| **Eugenia** | L'assistante, interface vers les algorithmes d'IA. | Couche `packages/ai` + prompts. |
| **Connaissance atomique** | Énoncé simple, précis, compréhensible sans contexte implicite ([§1](functional_doc/1_knowledge_extraction.qmd)). | Nœud de type `flashcard`. |
| **Catégorie / sous-wiki** | Ensemble de connaissances regroupées ; niveau de l'arbre ([§2](functional_doc/2_wiki.qmd)). | Nœud ayant des enfants (souvent de type `note`). |
| **Description de sous-wiki** | Texte qui résume ce que contient un sous-wiki. | Nœud de type `summary` rattaché au parent. |
| **Wiki personnel** | Interface de navigation dans l'arbre des connaissances. | L'application elle-même. |
| **Base de connaissances** | Ensemble des connaissances atomiques et de leur état de maîtrise. | Toutes les `flashcard` du dépôt + historique des quiz. |
| **Source** | Origine d'une connaissance (publication, site…) ([§1](functional_doc/1_knowledge_extraction.qmd)). | Champ `sources` d'un nœud, avec fichier personnel optionnel. |
| **Maîtrise (mastery)** | Valeur dans [0, 1] de maîtrise d'une connaissance, 0,5 par défaut ([§3](functional_doc/3_reinforcement.qmd)). | Calculée à partir de l'historique des quiz (§8.3). |
| **Déclin (decay)** | Facteur quotidien de diminution de la maîtrise. | Calculé à partir de l'historique des quiz (§8.3). |
| **Quiz** | Conversation où Eugenia interroge l'utilisateur sur une catégorie. | Nœud `discussion` de sous-type `quiz`. |
| **Dépôt privé** | Dépôt git privé contenant **tout** le wiki. Source de vérité, seul dépôt édité. | — |
| **Dépôt public** | Dépôt git public généré à partir des seuls nœuds publics. Jamais édité à la main. | — |
| **Branche de l'arbre** | Un nœud et tous ses descendants (à ne pas confondre avec une branche git). | — |
| **Périmé (stale)** | Résumé dont au moins une source a changé depuis sa génération. | — |

## 4. Architecture générale

```
┌──────────────────────────────┐            ┌──────────────────────────────┐
│ Dépôt PRIVÉ (source vérité)  │──CI───────▶│ Dépôt PUBLIC (généré)        │
│ ex. user/eugenia-wiki        │  publish   │ ex. user/eugenia-wiki-public │
│ wiki public + privé          │            │ nœuds publics + index.json   │
└───────────────▲──────────────┘            └──────────────────▲───────────┘
                │ GitHub API (token propriétaire)              │ HTTP anonyme
                │                                              │ (raw.githubusercontent.com)
                │                                              │
        ┌───────┴───────────────────────────────────────────────────────┴───┐
        │  Application Eugenia — PWA statique                               │
        │  https://openeugenia.github.io/eugenia/                           │
        │  - wiki / édition / extraction / quiz                             │
        │  - copie locale (IndexedDB) + file de sync                        │
        │  - appels IA directs depuis le navigateur                         │
        └─────────────────────────────────┬─────────────────────────────────┘
                                          │
                           ┌──────────────┴──────────────┐
                           │ Fournisseur IA configurable │
                           │ (API Claude, Ollama local…) │
                           └─────────────────────────────┘
```

### 4.1 Composants (monorepo)

| Paquet | Rôle |
|---|---|
| `packages/core` | Bibliothèque TypeScript sans dépendance navigateur : parsing des nœuds, frontmatter, construction de l'arbre, nommage des dossiers, réécriture des liens, règles de visibilité, filtrage public, calcul des résumés périmés, **algorithme de maîtrise** (§8.3). Réutilisée par le web et la CLI. |
| `packages/web` | Application React (SPA + PWA) déployée sur GitHub Pages par le compte openEugenia. |
| `packages/cli` | Outil en ligne de commande / GitHub Action : validation du format, publication vers le dépôt public, génération de résumés en lot, initialisation d'un nouveau wiki. |
| `packages/ai` | Abstraction des fournisseurs IA et prompts d'Eugenia (extraction, résumé, évaluation de réponse, discussion). |

### 4.2 Stack
- Langage : **TypeScript** partout.
- UI : **React**.
- Build : **Vite** (+ `vite-plugin-pwa`), monorepo **pnpm workspaces**.
- Markdown : **unified / remark / rehype** (parsing, frontmatter, rendu, réécriture des liens).
- Éditeur : **CodeMirror 6**.
- Visualisation : arbre repliable + vue graphe (d3-hierarchy) ; graphiques de progression.
- Stockage local : **IndexedDB** (Dexie ou idb).
- Import de documents : **pdf.js** pour les PDF (audio et vidéo : plus tard, §14).
- Tests : **Vitest** (core), **Playwright** (web).
- Accès git : **API GitHub** (Octokit). Alternative à étudier : `isomorphic-git`.

## 5. Modèle de données

### 5.1 Arborescence

**Toute page du wiki** (`note`, `flashcard`) **est un dossier contenant un `index.md`**, qu'elle ait des enfants ou non. Les pages enfants sont des sous-dossiers.

Les fichiers rattachés à une page sans en être une (descriptions, discussions, quiz) sont des **fichiers Markdown nommés directement**, préfixés par `_`, dans le dossier de la page :

```
wiki/
├── index.md                              # racine : le wiki global
├── _summary.md                           # description du wiki global (portée privée)
├── _summary.public.md                    # description du wiki global (portée publique)
├── religion-et-croyances/
│   ├── index.md                          # catégorie (type: note)
│   ├── _summary.md                       # description du sous-wiki
│   ├── _quizzes/
│   │   └── 2026-11-17-1030.md            # quiz (type: discussion, kind: quiz)
│   ├── _discussions/
│   │   └── 2026-11-17-lilith-et-la-lune.md   # discussion libre
│   ├── lilith/
│   │   └── index.md                      # connaissance atomique (type: flashcard)
│   └── article-sur-lilith/
│       ├── index.md                      # note source (type: note)
│       └── article.pdf                   # fichier personnel de la source
└── science/
    ├── index.md
    └── astronomie/
        └── ...
```

- L'ordre des enfants est défini par le champ `order`, sinon alphabétique sur le titre.
- Les fichiers et dossiers préfixés par `_` ou `.` sont réservés à l'application (descriptions, discussions, quiz, configuration) et n'apparaissent pas comme des enfants dans l'arbre.
- **Pas de limite** de profondeur ni de largeur de l'arbre.
- Les fichiers joints (PDF, images, audio) sont rangés dans le dossier du nœud concerné.

### 5.2 Nommage des dossiers

Le nom du dossier est dérivé du titre, sans que l'utilisateur le voie :
1. passage en minuscules, suppression des accents, caractères non alphanumériques remplacés par `-` ;
2. **troncature aux premiers caractères** (32 par défaut, sans couper au milieu d'un mot si possible) ;
3. en cas de collision avec un frère, ajout d'un suffixe `-2`, `-3`…

**Quand le titre change, le dossier est renommé** selon la même règle, et les liens entrants sont réécrits dans le même commit (§5.8). L'`id` du nœud ne change jamais.

### 5.3 Frontmatter commun

```yaml
---
id: 01JD3K8Z9X...          # ULID stable, généré à la création
type: note                 # note | summary | discussion | flashcard
title: Religion et croyances
visibility: private        # public | private (hérité du parent si absent)
created: 2026-11-17T10:30:00Z
updated: 2026-11-17T11:00:00Z
tags: []
order: 10                  # optionnel
sources: []                # cf. 5.7
---
```

### 5.4 Types de nœuds

| Type | Rôle |
|---|---|
| `note` | Note libre en Markdown. Sert de **catégorie** quand elle a des enfants, et de **texte source** pour l'extraction de connaissances. Type par défaut. |
| `summary` | Description d'un sous-wiki, générée par Eugenia (§5.5). |
| `discussion` | Échange personnel entre l'utilisateur et Eugenia, rattaché à une page (`_discussions/`). Un **quiz** est une discussion de sous-type `quiz` (`_quizzes/`, §5.6). |
| `flashcard` | **Connaissance atomique** : énoncé, question, réponse attendue (§5.7). |

Un type inconnu est traité comme `note`.

### 5.5 Résumés (descriptions de sous-wikis)

Stockés dans le fichier `_summary.md` du dossier de la page décrite, ils sont affichés **en tête du nœud parent**, et non comme un enfant.

```yaml
---
id: 01JD3M...
type: summary
scope: private             # private = tous les enfants ; public = enfants publics seuls
model: claude-sonnet-5-5
generated: 2026-11-17T11:05:00Z
locked: false              # true = ne plus proposer de régénération
sources:                   # empreinte des sources au moment de la génération
  01JD3K8Z9X...: 3f2a9c1   # id enfant → SHA du blob git (contenu ou résumé de l'enfant)
---
Texte de la description…
```

- Construction **ascendante** : la description d'un parent est faite à partir des descriptions de ses enfants (ou de leur contenu pour les nœuds sans enfants). On va ainsi du plus fin au plus global ([§2](functional_doc/2_wiki.qmd)).
- Une page peut avoir deux descriptions : `_summary.md` (portée privée) et `_summary.public.md` (portée publique), cf. §6.3.

### 5.6 Discussions et quiz

Une discussion est un fichier unique : les messages y sont stockés, une section par message. Des métadonnées par message sont portées par un commentaire HTML invisible au rendu.

**Discussion libre**, rattachée à n'importe quelle page (« tout est discussion », [§5](functional_doc/5_discussion.qmd)), stockée dans `_discussions/<date>-<slug>.md` :

```markdown
---
id: 01JD3P...
type: discussion
title: Lilith et la Lune noire
about: 01JD3R...           # nœud à l'origine de la discussion (optionnel)
---

## user · 2026-11-17T10:00:00Z
Quel lien entre Lilith et la Lune noire ?

## eugenia · 2026-11-17T10:00:12Z
En astrologie, la « Lune noire » désigne…
```

**Quiz**, stocké dans `_quizzes/<date>-<heure>.md` de la catégorie interrogée. **Le quiz est la trace qui stocke l'état de révision** : la maîtrise de chaque flashcard est recalculée en rejouant les quiz (§8.3).

```markdown
---
id: 01JD3Q...
type: discussion
kind: quiz
title: Quiz — Religion et croyances
scope_node: 01JD3K8Z9X...  # catégorie choisie
visibility: private
---

## eugenia · 2026-11-17T10:30:00Z
<!-- eugenia: {"card": "01JD3R...", "role": "question"} -->
Quel est le nom du démon féminin de la tradition juive, inspiré d'une divinité mésopotamienne ?

## user · 2026-11-17T10:30:20Z
Je pense que c'est Lilite la Pépite

## eugenia · 2026-11-17T10:30:24Z
<!-- eugenia: {"card": "01JD3R...", "role": "feedback", "score": 0.3} -->
La réponse est incorrecte : Lilith était attendue. L'orthographe est fausse et l'ajout n'existe pas.
```

- Rôles : `user`, `eugenia`.
- Un quiz est **privé par défaut** et n'est jamais publié s'il contient des flashcards privées.
- Le quiz est commité **en une fois, à la fin de la session** (ou à la fermeture, via la file hors ligne).

### 5.7 Flashcards (connaissances atomiques)

Elles reprennent le tuple *(connaissance, titre, catégorie, question)* de la doc fonctionnelle ([§1](functional_doc/1_knowledge_extraction.qmd)). La **catégorie est la position dans l'arbre** : elle n'est pas stockée.

```markdown
---
id: 01JD3R...
type: flashcard
title: Lilith
visibility: public
created: 2026-11-17T10:30:00Z
extracted_from: 01JD3S...  # note source (optionnel)
sources:
  - description: Wikipédia, article « Lilith »
    url: https://fr.wikipedia.org/wiki/Lilith
    file: article.pdf      # fichier personnel, jamais publié
---

## Connaissance
**Lilith** est un démon féminin de la tradition juive, inspiré d'une divinité d'origine mésopotamienne.

## Question
Quel est le nom du démon féminin de la tradition juive, inspiré d'une divinité d'origine mésopotamienne ?

## Réponse attendue
Lilith
```

- La partie en **gras** de la connaissance est la **cible d'apprentissage**, c'est-à-dire ce sur quoi l'utilisateur est interrogé.
- **Sources** : la description et l'URL suivent la visibilité du nœud ; le **fichier personnel** joint reste toujours privé.
- La maîtrise, la date du dernier échec et le déclin **ne sont pas stockés dans la flashcard** : ils sont dérivés des quiz (§8.3).

### 5.8 Liens entre nœuds

- Syntaxe : **liens Markdown relatifs** vers le `index.md` cible, ex. `[Lilith](../lilith/index.md)`.
- Dans l'éditeur, l'utilisateur insère un lien en cherchant un nœud par son titre ; le chemin est généré automatiquement.
- Quand un nœud est déplacé ou renommé, **tous les liens entrants sont réécrits** dans le même commit.
- L'interface affiche les **rétroliens** (nœuds qui pointent vers le nœud courant).

### 5.9 Configuration du wiki

```yaml
# .notes/config.yml
title: Mon wiki
root: wiki/
private_repo: user/eugenia-wiki        # recopié dans le dépôt public, optionnel (§7)
default_visibility: private
folder_name_max_length: 32
mastery:                                # paramètres de l'algorithme (§8.3)
  initial: 0.5
  alpha: 0.5
  decay_rate: 0.05
  success_threshold: 0.5               # réussite si x > 0.5
```

Les réglages personnels (clés API, fournisseur IA, préférence IA locale) ne sont **pas** dans le dépôt : ils restent dans le navigateur.

## 6. Visibilité public / privé

### 6.1 Principe : deux dépôts

- **Dépôt privé** (ex. `user/eugenia-wiki`) : contient tout, c'est le seul que l'on édite.
- **Dépôt public** (ex. `user/eugenia-wiki-public`) : généré par une GitHub Action à chaque push sur le dépôt privé, il ne contient que les nœuds `visibility: public`.

> **Pourquoi pas un seul dépôt avec deux branches ?** Sur GitHub, l'accès en lecture s'applique au dépôt entier, pas à une branche : une branche privée dans un dépôt public serait lisible par tous. Et exposer la partie publique d'un dépôt privé (via GitHub Pages) exige un compte payant. Deux dépôts fonctionnent avec un compte gratuit.

### 6.2 Règles de visibilité
1. Un nouveau nœud est **privé par défaut**.
2. Un nœud sans champ `visibility` hérite de son parent.
3. **Un nœud public ne peut pas avoir d'ancêtre privé.** Quand l'utilisateur rend public un nœud dont un ancêtre est privé, l'application **propose de rendre publique toute la branche** jusqu'à la racine, en affichant les ancêtres concernés et en demandant une confirmation explicite. S'il refuse, le nœud reste privé.
4. Rendre public un nœud ne rend **pas** automatiquement publics ses descendants : l'application propose de les inclure (cases à cocher).
5. Rendre privé un nœud rend privés tous ses descendants, après confirmation.
6. Lors de la publication, un lien d'un nœud public vers un nœud privé est réécrit en texte simple.
7. Les fichiers personnels des sources ne sont jamais publiés ; les autres fichiers joints suivent la visibilité de leur nœud.
8. Les quiz ne sont pas publiés en v1.
9. La CLI de publication refuse toute arborescence qui viole la règle 3, par exemple si le dépôt a été modifié hors application.

### 6.3 Fuites par les résumés
Une description générée à partir d'enfants privés **ne doit jamais** être publiée. Le dépôt public reçoit uniquement `_summary.public.md` (renommé en `_summary.md`), généré à partir des seuls enfants publics. La CLI de publication vérifie ce point et échoue en cas d'incohérence.

### 6.4 Publication
GitHub Action dans le dépôt privé, déclenchée par chaque push :
1. `cli publish --target user/eugenia-wiki-public` construit l'arborescence filtrée (règles §6.2 et §6.3) et la valide.
2. Il génère `.notes/index.json` (arbre, titres, types, descriptions courtes) et `.notes/config.yml` (sans les paramètres personnels).
3. Il pousse le résultat dans le dépôt public en **réécrivant son historique** (un seul commit par publication) : aucun historique privé n'est exposé, et le message de commit ne reprend pas ceux du dépôt privé.
4. L'écriture dans le dépôt public utilise un secret du dépôt privé : une *deploy key* ou un jeton fine-grained limité au dépôt public, créé par `cli init`.

## 7. Authentification et accès

L'instance unique `openeugenia.github.io/eugenia/` n'a ni secret serveur ni compte propre : l'identité est celle de GitHub.

| Mode | Usage |
|---|---|
| **Anonyme** | Lecture du dépôt public en HTTP simple via `raw.githubusercontent.com` (`index.json` puis fichiers Markdown), sans API GitHub ni limite de débit. |
| **Propriétaire — v1** | Jeton GitHub *fine-grained* (lecture/écriture limitées au dépôt privé) saisi dans les paramètres, stocké dans le navigateur (IndexedDB). |
| **Propriétaire — v2** | « Se connecter avec GitHub » via une GitHub App openEugenia + un micro-service d'échange de jeton (ex. Cloudflare Worker). |

**Détection du propriétaire** : pour `?repo=owner/name`, l'application charge la partie publique du dépôt public `owner/name`. Si son `.notes/config.yml` déclare un `private_repo` et que l'utilisateur connecté y a accès, elle bascule sur le dépôt privé via l'API GitHub et affiche tout le wiki, avec un badge public/privé sur chaque nœud. Le propriétaire peut aussi ouvrir directement son dépôt privé (`?repo=owner/eugenia-wiki`).

## 8. Parcours fonctionnels

### 8.1 Extraction de connaissances ([§1](functional_doc/1_knowledge_extraction.qmd))

1. **Entrée** : un texte. Il peut venir d'une note existante, d'un texte collé, ou d'un document importé (PDF converti par pdf.js ; audio et vidéo transcrits en texte, en v2). Le texte source est conservé comme nœud `note`, avec le fichier original joint si l'utilisateur le souhaite.
2. **Surlignage** : Eugenia surligne dans le texte les connaissances atomiques candidates.
3. **Ajustement** : l'utilisateur ajoute ses propres surlignages, ou découpe et affine ceux qu'Eugenia propose.
4. **Proposition** : pour chaque connaissance retenue, Eugenia reformule un énoncé autonome (en réintroduisant le contexte, ex. « Lilith ») et propose une cible d'apprentissage, un **titre**, une **question**, une **réponse attendue** et une **catégorie** (un nœud existant, ou un nouveau nœud à créer).
5. **Validation** : l'utilisateur sélectionne, modifie et valide. Les flashcards sont créées dans leurs catégories, avec un lien `extracted_from` vers la note source et ses sources. Le tout fait l'objet d'un seul commit.

**Catégories par défaut** : à l'initialisation d'un nouveau wiki (`cli init` ou assistant web), l'application propose de créer les catégories de premier niveau de la doc fonctionnelle : Arts et culture, Économie et finance, Géographie, Histoire, Langues et linguistique, Médecine et santé, Militaire et défense, Nature et environnement, Philosophie et pensée, Religion et croyances, Science, Société et sciences sociales, Sports et loisirs, Technologie, Transports. L'utilisateur peut en ajouter, en renommer ou en supprimer, et Eugenia peut lui suggérer des sous-catégories. Il n'y a pas de limite de profondeur ni de largeur.

### 8.2 Wiki personnel ([§2](functional_doc/2_wiki.qmd))

- Navigation dans l'arbre : chaque sous-wiki affiche sa **description** (§5.5), ses enfants avec leurs descriptions courtes, et une **jauge de maîtrise**.
- Maîtrise d'une catégorie : moyenne de la maîtrise actuelle des flashcards qu'elle contient (descendants compris).
- Les descriptions sont maintenues en mode **semi-automatique** (§11.2).

### 8.3 Quiz et renforcement ([§3](functional_doc/3_reinforcement.qmd))

**Déroulement** :
1. L'utilisateur choisit une catégorie (n'importe quel nœud de l'arbre).
2. Eugenia trie les flashcards de cette branche par **maîtrise actuelle croissante**.
3. Pour chaque flashcard : Eugenia pose la question, l'utilisateur répond librement, puis Eugenia compare la réponse à la réponse attendue et renvoie un **retour détaillé** (éléments manquants et superflus) et un **score** $x \in [0, 1]$.
4. La maîtrise est mise à jour après chaque réponse (calcul local, immédiat).
5. L'utilisateur peut arrêter à tout moment ou relancer un quiz, qui suit alors le nouvel ordre.
6. En fin de session, le quiz est enregistré comme discussion (§5.6) et commité.

**État d'une flashcard** (dérivé, jamais saisi) :

| Champ | Initialisation |
|---|---|
| `mastery` $m$ | 0,5 |
| `failure_date` $f$ | date de création de la flashcard |
| `decay` $\beta$ | $1 - \frac{0{,}05}{1 + 0} = 0{,}95$ |
| `last_eval` $e$ | date de création de la flashcard |

**Maîtrise actuelle** au jour $d$ (déclin quotidien, en jours entiers) :

$$m_{\text{actuelle}}(d) = m \cdot \beta^{\,(d - e)}$$

**Mise à jour après une évaluation** de score $x$ au jour $d$ :
1. $m \gets m_{\text{actuelle}}(d)$ (le déclin est d'abord appliqué)
2. $m \gets \frac{m + x}{2}$ dans tous les cas (moyenne mobile exponentielle, $\alpha = \tfrac{1}{2}$) : un échec (score faible, jusqu'à $x = 0$) fait donc baisser la maîtrise naturellement
3. **Si réussite** ($x > 0{,}5$) :
   - $t \gets d - f$ (jours depuis le dernier échec)
   - $\beta \gets 1 - \frac{0{,}05}{1 + t}$ : plus les réussites s'enchaînent longtemps après le dernier échec, plus l'oubli ralentit
4. **Sinon (échec, $x \leq 0{,}5$)** : $f \gets d$ et $\beta \gets 0{,}95$, c'est-à-dire que le déclin repart à son rythme le plus rapide
5. $e \gets d$

**Stockage par rejeu** : `core` reconstruit l'état de chaque flashcard en rejouant chronologiquement tous les scores trouvés dans les quiz (`_quizzes/`) du dépôt. Conséquences :
- aucune donnée de maîtrise n'est dupliquée ou désynchronisée ;
- un changement des paramètres (§5.9) s'applique rétroactivement à tout l'historique ;
- l'état calculé est mis en cache dans IndexedDB et invalidé quand un quiz change (SHA).

**Rappels de révision** ([§5](functional_doc/5_discussion.qmd)) : à l'ouverture, l'application signale les catégories dont des flashcards passent sous un seuil de maîtrise (ex. « 3 connaissances de *Philosophie et pensée* risquent d'être oubliées »). Les notifications push sont prévues en v2 (§14).

**Tableau de bord** ([§6](functional_doc/6_other_sn_tools.qmd)) : nombre de connaissances, taux de révision, courbe de maîtrise dans le temps par catégorie.

### 8.4 Discussions ([§5](functional_doc/5_discussion.qmd))

- Depuis n'importe quelle page (catégorie, flashcard, note source), l'utilisateur peut ouvrir une discussion avec Eugenia. Elle est enregistrée dans `_discussions/` de cette page et affichée dans la vue de la page.
- Eugenia peut : clarifier ou reformuler une notion, suggérer des liens vers des nœuds existants, résumer l'échange, et **proposer d'extraire de nouvelles connaissances** de la discussion (retour au parcours §8.1).
- Les discussions v1 sont **personnelles** ; leur visibilité suit les règles §6.2.

### 8.5 Questions sur l'arbre

L'utilisateur pose une question sur un périmètre donné (wiki entier ou branche) :
1. Eugenia reçoit d'abord les descriptions du premier niveau du périmètre.
2. Elle choisit les branches pertinentes et **descend** dans l'arbre (descriptions → descriptions enfants → contenu des nœuds).
3. Sa réponse cite les nœuds utilisés, sous forme de liens cliquables.
4. L'échange peut être enregistré comme discussion dans `_discussions/` de la page racine du périmètre.

## 9. Interface web

### 9.1 Point d'entrée
- `https://openeugenia.github.io/eugenia/?repo=owner/name` : ouvre n'importe quel wiki compatible.
- Sans paramètre : page d'accueil (présentation d'Eugenia, saisie d'un dépôt, derniers wikis consultés, création d'un nouveau wiki).

### 9.2 Vues
1. **Arbre** (panneau latéral) : hiérarchie repliable, icône par type, badge public/privé, jauge de maîtrise, badge « description périmée », indicateur « modifié hors ligne ».
2. **Nœud** : description en tête, contenu rendu, enfants avec leurs descriptions courtes, rétroliens, discussions liées.
3. **Flashcard** : connaissance (cible en gras), question, réponse attendue, sources, courbe de maîtrise.
4. **Extraction** : texte source avec surlignages, panneau des connaissances proposées (§8.1).
5. **Quiz** : conversation avec Eugenia, score et retour après chaque réponse, progression de la session.
6. **Discussion** : messages chronologiques, réponse d'Eugenia en streaming.
7. **Graphe** : visualisation de l'arbre (zoom, focus sur une branche).
8. **Tableau de bord** : indicateurs et courbes de progression.
9. **Recherche** : plein texte (index côté client) avec filtres par type, tag, visibilité et maîtrise.
10. **Éditeur** : Markdown, métadonnées sous forme de formulaire (le frontmatter brut n'est jamais affiché).
11. **Paramètres** : jeton GitHub, fournisseur IA, clé API, modèle, IA locale pour le privé, données hors ligne.

### 9.3 Opérations d'édition
- Créer un nœud enfant ou frère, changer son type.
- Renommer (le dossier est renommé, §5.2) ou déplacer par glisser-déposer : l'`id` est conservé et les liens entrants sont réécrits.
- Supprimer, avec confirmation (la suppression récursive est explicite).
- Changer la visibilité, avec les propositions décrites en §6.2.
- **Enregistrement** : les modifications sont regroupées localement puis commitées en un seul commit (message généré, modifiable).

## 10. Synchronisation git et mode hors ligne

### 10.1 Lecture
- Propriétaire : arbre complet du dépôt privé récupéré via l'API Git Trees (`recursive=1`) ; un appel donne tous les chemins et SHA.
- Anonyme : `index.json` puis fichiers Markdown chargés depuis `raw.githubusercontent.com`.
- Contenus chargés à la demande et mis en cache par SHA (immuables, donc cache permanent).

### 10.2 Écriture
- Commit multi-fichiers via l'API Git Data (blobs → tree → commit → mise à jour de la ref).
- Toujours dans le dépôt privé (branche par défaut) ; le dépôt public n'est écrit que par la CI.

### 10.3 Mode hors ligne (PWA)
- Le service worker met l'application en cache : elle s'ouvre sans réseau.
- Une **copie locale** des wikis consultés (arbre + contenus) est conservée dans IndexedDB.
- Hors ligne, on peut lire, éditer, créer, déplacer. Les quiz restent possibles si un fournisseur IA local est joignable ; sinon, un **mode d'auto-évaluation** permet de révéler la réponse et de noter soi-même sa réponse (0 / 0,5 / 1).
- Les modifications sont placées dans une **file de changements en attente**, visible dans l'interface.
- Au retour du réseau :
  1. récupération de l'état distant ;
  2. si aucun fichier modifié localement n'a changé à distance → commit direct ;
  3. sinon → résolution de conflit nœud par nœud (version locale, version distante, ou fusion manuelle côte à côte). Aucune résolution automatique silencieuse.
- Les quiz étant des fichiers distincts horodatés, ils n'entrent jamais en conflit entre appareils.

## 11. Intelligence artificielle (Eugenia)

### 11.1 Fournisseurs
Interface commune `AIProvider` (`complete`, `stream`, `countTokens`, et `embed` pour la recherche sémantique, chez les fournisseurs compatibles OpenAI : Mistral `mistral-embed` par défaut) avec adaptateurs :
- **Anthropic (Claude)** : appel direct depuis le navigateur avec la clé de l'utilisateur.
- **Ollama / serveur local** : nécessite d'autoriser l'origine `openeugenia.github.io` en CORS.
- **Compatible OpenAI** : tout autre fournisseur.

**IA locale pour le privé** : lors de la première configuration (puis dans les paramètres), l'application **demande à l'utilisateur** s'il souhaite réserver les nœuds privés à une IA locale.
- Si oui : tout traitement impliquant un nœud privé (description, extraction, quiz, discussion, question sur l'arbre) passe obligatoirement par le fournisseur local. À défaut, l'action est bloquée avec une explication.
- Si non : un avertissement s'affiche la première fois qu'un contenu privé est envoyé à un fournisseur distant.

Les clés API ne sont jamais commitées ; elles sont stockées uniquement dans le navigateur.

### 11.2 Descriptions de sous-wikis (mode semi-automatique)
1. **Détection** : `core` compare les `sources` de chaque résumé aux SHA actuels des enfants. Un écart → description **périmée**, propagée aux ancêtres.
2. **Signalement** : badge dans l'arbre et compteur global « N descriptions périmées ».
3. **Régénération** : à la demande, sur un nœud, une branche ou tout le wiki, des nœuds les plus profonds vers la racine.
4. **Relecture** : chaque description régénérée est présentée en diff avant d'entrer dans le commit ; elle peut être éditée puis verrouillée (`locked`).
5. **Lot** : `cli summarize --stale`, en local ou en CI.

### 11.3 Prompts
Les prompts d'Eugenia sont versionnés dans le dépôt de l'application et peuvent être surchargés dans le wiki (`.notes/prompts/`) :
- `extract.md` : surlignage et proposition de connaissances atomiques ;
- `summarize.md` : description d'un sous-wiki (variante pour les discussions : décisions + questions ouvertes) ;
- `evaluate.md` : comparaison réponse / réponse attendue, avec un retour et un score dans [0, 1] en **sortie structurée** (JSON validé) ;
- `discuss.md` : rôle d'Eugenia dans une discussion.

## 12. Sécurité et confidentialité
- Données détenues par l'utilisateur dans ses propres dépôts, sans serveur central.
- Nœuds privés par défaut ; validation CI bloquante avant publication (§6).
- Le dépôt source doit être privé : l'application refuse d'y écrire s'il est public.
- Aucun contenu privé dans le dépôt public : ni dans son historique, ni dans les descriptions, ni via les fichiers personnels des sources.
- Jetons et clés stockés localement, jamais transmis ailleurs qu'à leur service respectif.
- Copie hors ligne effaçable depuis les paramètres (« oublier ce wiki sur cet appareil »).
- CSP stricte ; rendu Markdown assaini (aucun HTML/JS arbitraire exécuté).
- Instance partagée : aucune donnée d'un utilisateur n'est accessible à un autre au-delà de ce que GitHub autorise.

## 13. Hébergement et dépôts du projet
- Code source : dépôt public **`openEugenia/eugenia`**, sous licence **MIT** (pour le moment).
- Application : déployée sur **`https://openeugenia.github.io/eugenia/`** par une GitHub Action à chaque tag de version.
- GitHub Action de publication (§6.4) : publiée sur le Marketplace par openEugenia, pour être utilisée dans les dépôts privés des utilisateurs.
- La documentation fonctionnelle (`functional_doc/`) reste dans le dépôt et pourra être publiée avec Quarto.

## 14. Évolutions prévues (hors v1)

Le format git reste la base de ces évolutions : un wiki public est déjà une donnée ouverte et indexable.
- **Réseau social** ([§4](functional_doc/4_toward_social_network.qmd)) : registre (opt-in) des wikis publics, vecteurs d'embeddings par wiki, similarité sémantique entre utilisateurs, suggestions de connexions.
- **Portée automatique selon la maîtrise** : proposer de rendre privée une connaissance publique qui passe sous un seuil de maîtrise, puis de la republier quand elle remonte.
- **Ajout de connaissances d'autrui** : copier une flashcard publique d'un autre wiki dans le sien (avec source d'origine).
- **Discussions publiques** à plusieurs participants (ex. via GitHub Discussions ou issues du dépôt public).
- **Fil d'actualité, capsules, gamification** (badges, trophées) ([§6](functional_doc/6_other_sn_tools.qmd)).
- **Notifications** push et e-mail.
- **Transcription audio/vidéo** pour l'extraction.

## 15. Feuille de route

| Jalon | Contenu |
|---|---|
| **M0 — Fondations** | Monorepo, `core` (parsing, arbre, nommage, liens, visibilité), format documenté, tests. |
| **M1 — Lecteur public** | Application React, lecture anonyme d'un wiki public, arbre, rendu, recherche, déploiement sur openEugenia. |
| **M2 — Propriétaire** | Jeton fine-grained, dépôt privé, édition, renommage, déplacement, commit, `cli init` avec catégories par défaut. |
| **M3 — Publication** | CLI + GitHub Action dépôt privé → dépôt public, validations, `index.json`. |
| **M4 — Hors ligne** | PWA, copie IndexedDB, file de changements, résolution de conflits. |
| **M5 — Eugenia : descriptions** | Abstraction fournisseurs, choix IA locale pour le privé, descriptions périmées, régénération et relecture. |
| **M6 — Extraction** | Parcours §8.1 depuis une note ou un texte collé, import PDF. |
| **M7 — Quiz** | Quiz conversationnel, évaluation par Eugenia, algorithme de maîtrise par rejeu, jauges, rappels, auto-évaluation hors ligne. |
| **M8 — Discussions & questions** | Discussions depuis un nœud, extraction depuis une discussion, questions sur l'arbre. |
| **M9 — Confort** | Vue graphe, tableau de bord, connexion GitHub App, transcription audio/vidéo. |

## 16. Questions ouvertes
Aucune pour le moment. Décisions récentes :
- deux dépôts (privé + public) pour rester compatible avec un compte GitHub gratuit ;
- catégories par défaut de la doc fonctionnelle conservées telles quelles.
