# Format de stockage d'un wiki Eugenia

Un wiki Eugenia est un dépôt git ordinaire : des dossiers et des fichiers Markdown avec un
frontmatter YAML. L'application ne montre jamais ces fichiers, mais ils restent lisibles et
modifiables à la main. `eugenia validate` vérifie un dépôt modifié hors de l'application.

Ce document décrit la version 2 du format (spécification §5) : trois espaces (wiki,
bibliothèque, discussions), connaissances atomiques et flashcards distinctes. Un wiki au
format 1 (tout sous `wiki/`, discussions dans des dossiers `_discussions/` et `_quizzes/`) n'est
pas migré automatiquement ; `validate` signale ses fichiers d'ancien format.

## Arborescence

Un wiki a trois espaces, chacun dans son dossier (configurables, §Configuration) :

```
.notes/
  config.yml                 configuration du wiki
  prompts/<nom>.md           surcharges facultatives des prompts d'Eugenia
wiki/                        le wiki : catégories, connaissances atomiques, flashcards
  index.md                   la page racine : le wiki global
  _summary.md                description du wiki global (portée privée)
  _summary.public.md         description du wiki global (portée publique)
  _embedding.json            embedding de la page (recherche sémantique, jamais publié)
  religion-et-croyances/
    index.md                 une catégorie
    _summary.md
    lilith/
      index.md               une connaissance atomique
      quel-est-le-nom-du-demon-feminin/
        index.md             une flashcard sur cette connaissance
library/                     la bibliothèque : les sources, à plat
  article-sur-lilith/
    index.md                 une source
    article.pdf              son fichier personnel (jamais publié)
discussions/                 les discussions, questions, quiz et notes rapides
  2026-11-10-1030-quiz-religion-et-croyances.md
  2026-11-14-0830-51-pegasi-b.md
```

- **Toute page est un dossier contenant un `index.md`**, qu'elle ait des enfants ou non. Les
  sous-pages sont des sous-dossiers.
- **Wiki** : une catégorie contient des sous-catégories et des connaissances ; une connaissance
  ne contient que des flashcards ; une flashcard n'a pas de sous-page. `validate` signale les
  pages mal rangées.
- **Bibliothèque** : une liste à plat de sources, directement sous `library/`. Le dossier
  lui-même n'a pas besoin d'`index.md`.
- **Discussions** : un fichier Markdown par discussion, directement sous `discussions/`.
- Les noms commençant par `_` ou `.` sont réservés à l'application et ne sont pas des pages.
- Un dossier sans `index.md` qui contient des pages est affiché comme une catégorie (signalé
  par `validate`).
- Les autres fichiers d'un dossier sont des **fichiers joints** de sa page.
- Ordre des enfants : champ `order`, puis titre (ordre alphabétique français).
- Ni profondeur ni largeur maximales dans le wiki.

### Nom des dossiers

Dérivé du titre : minuscules, sans accents, caractères non alphanumériques remplacés par `-`,
tronqué à 32 caractères (`folder_name_max_length`) sans couper un mot si possible, suffixe `-2`,
`-3`… en cas de collision. Quand le titre change, l'application renomme le dossier et réécrit
les liens entrants (dans les trois espaces) dans le même commit ; l'`id` ne change jamais.

## Pages (`index.md`)

```yaml
---
id: 01M6DP0H707WPFZNQATGBZG5SB   # ULID, stable
type: knowledge                  # category | knowledge | flashcard | source
title: Lilith
visibility: public               # public | private ; hérité du parent si absent
created: 2026-11-02T08:29:00Z
updated: 2026-11-02T08:29:00Z
tags: [mythologie]
order: 10                        # facultatif
---
```

Sans `type`, une page du wiki est une catégorie et une page de la bibliothèque une source
(`note`, l'ancien type, est lu de la même façon). Un `type` inconnu est signalé. Les clés
inconnues sont conservées.

### Catégories

Le corps est un texte d'introduction libre (CommonMark et GFM), facultatif. Une catégorie avec
des enfants est un **sous-wiki**, décrit par Eugenia (§Descriptions).

### Connaissances atomiques

```yaml
type: knowledge
extracted_from: 01M6BK4140P9T3R69AH4Y8K1PA   # source ou discussion d'origine (facultatif)
sources:
  - ref: 01M6BK4140P9T3R69AH4Y8K1PA        # une source de la bibliothèque
    locator: p. 12                         # facultatif : page, chapitre, minutage…
  - description: Conférence au Collège de France   # référence libre, hors bibliothèque
    url: https://example.org
```

```markdown
**Lilith** est un démon féminin de la tradition juive, inspiré d'une divinité d'origine mésopotamienne.

## Notes
Voir aussi [la Lune noire](../../science/astronomie/lune-noire/index.md).
```

Le corps commence par l'**énoncé** : un texte simple, précis, compréhensible sans contexte. La
partie en **gras** est la cible d'apprentissage. Des sections libres (`## Notes`…) peuvent
suivre. La catégorie d'une connaissance est sa position dans l'arbre. Une connaissance sans
aucune source est signalée **« à sourcer »**.

### Flashcards

Une flashcard est une sous-page d'une connaissance, qu'elle teste. Une connaissance peut en
avoir plusieurs.

```markdown
---
id: 01M6BC89W0J04TZ0V9ZXT186H6
type: flashcard
title: Quel est le nom du démon féminin de la tradition juive, inspiré d'une divinité…
created: 2026-11-02T08:30:00Z
updated: 2026-11-02T08:30:00Z
---

## Question
Quel est le nom du démon féminin de la tradition juive, inspiré d'une divinité d'origine mésopotamienne ?

## Réponse attendue
Lilith
```

Le titre est tiré de la question. Une flashcard n'écrit pas de `visibility` : elle suit celle
de sa connaissance. Les sections inconnues sont conservées. La maîtrise n'est pas stockée :
elle est recalculée, flashcard par flashcard, à partir des quiz.

### Sources

```yaml
---
id: 01M6BK4140P9T3R69AH4Y8K1PA
type: source
kind: article          # book | article | web | video | audio | document | other
title: Article sur Lilith
authors: [Jeanne Dupont]
published: "2019"      # date ou année, texte libre
url: https://example.org/lilith
file: article.pdf      # fichier personnel joint, jamais publié
visibility: private
---
```

Le corps (extraits, résumé, notes de lecture) est le texte d'où Eugenia extrait des
connaissances. La page d'une source liste les connaissances qui la citent (`sources[].ref`) ou
qui en ont été extraites (`extracted_from`).

## Descriptions des sous-wikis

`_summary.md` (portée privée : tous les enfants) et `_summary.public.md` (portée publique : les
seuls enfants publics), dans le dossier de la page décrite :

```yaml
---
id: 01M6CWACM0CXSNMC6T29E31548
type: summary
scope: public
model: claude-opus-5-5
generated: 2026-11-15T09:00:00Z
locked: false        # true : ne plus proposer de régénération
sources:             # empreinte des sources au moment de la génération
  01M6B5CJM0EDQQYQ3XR5ZN1ACK: a2d07f6    # la page elle-même : SHA de son index.md
  01M6B8TE80FWZWZ9A13320JP2Z: 600db5a    # un enfant : SHA de sa description ou de son index.md
---
Texte de la description…
```

- L'empreinte d'un enfant est le SHA (blob git, 7 caractères) de sa description de même portée
  s'il a lui-même des enfants et une description, sinon de son `index.md`.
- Une description est **périmée** quand l'ensemble des sources ou l'un de leurs SHA diffère ; la
  péremption remonte aux ancêtres, sauf à travers une description verrouillée.
- La régénération va des nœuds les plus profonds vers la racine.

## Embeddings (recherche sémantique)

`_embedding.json`, dans le dossier de la page, résume le sens de son `index.md` par un vecteur,
pour la recherche « par le sens » de l'application. Il est calculé par l'application ou par
`eugenia embed` (Mistral `mistral-embed` par défaut, ou tout fournisseur compatible OpenAI).

```json
{
  "format": "eugenia-embedding",
  "version": 1,
  "model": "mistral-embed",
  "text_sha": "2f6e197",
  "generated": "2026-11-18T13:54:22Z",
  "dimensions": 1024,
  "encoding": "int8",
  "scale": 0.00076,
  "vector": "7SUl8vw+DsML8e0q…"
}
```

- Pages indexées : catégories, connaissances et sources. Les flashcards ne le sont pas : elles
  reprennent leur connaissance.
- Texte envoyé au modèle : titre, auteurs (sources), étiquettes, puis contenu en texte brut. Ni
  frontmatter ni adresse de lien : déplacer une page ou changer sa visibilité ne rend pas son
  embedding périmé.
- `text_sha` : SHA (blob git, 7 caractères) de ce texte. L'embedding est **périmé** quand ce SHA
  ou le modèle diffère ; un embedding d'un autre modèle n'est jamais comparé à la requête.
- `vector` : composantes quantifiées sur 8 bits signés (base64), à multiplier par `scale`.
- Le fichier suit la page quand elle est renommée ou déplacée, et disparaît avec elle. Il n'est
  **jamais publié**, même pour une page publique : il est calculé sur le contenu du dépôt privé.

## Discussions

Un fichier par discussion dans `discussions/`, nommé `<date>-<heure>-<titre>.md` (UTC). Une
section par message (`## <rôle> · <horodatage>`), rôles `user` et `eugenia`. Les métadonnées
d'un message sont portées par un commentaire HTML invisible.

```markdown
---
id: 01M6CJ0SR0BVVET7CEJVMHZCXF
type: discussion
kind: quiz                         # discussion (défaut) | question | quiz | note
title: Quiz — Religion et croyances
scope_node: 01M6B8TE80FWZWZ9A13320JP2Z   # périmètre : catégorie interrogée, branche d'une question
about: 01M6DP0H707WPFZNQATGBZG5SB        # page d'où la discussion a été ouverte (facultatif)
visibility: private
---

## eugenia · 2026-11-10T10:30:00Z
<!-- eugenia: {"card": "01M6BC89W0J04TZ0V9ZXT186H6", "role": "question"} -->
Quel est le nom du démon féminin… ?

## user · 2026-11-10T10:30:20Z
Je pense que c'est Lilite la Pépite

## eugenia · 2026-11-10T10:30:24Z
<!-- eugenia: {"card": "01M6BC89W0J04TZ0V9ZXT186H6", "role": "feedback", "score": 0.3} -->
La réponse est incorrecte : Lilith était attendue.
```

| `kind` | Usage |
|---|---|
| `discussion` (ou absent) | Discussion libre avec Eugenia, à partir d'une page (`about`) ou non. |
| `question` | Question sur l'arbre enregistrée, avec son périmètre (`scope_node`). |
| `quiz` | Session de révision : la trace d'où la maîtrise est recalculée. |
| `note` | Note rapide : Eugenia y répond par des connaissances candidates et des pistes de sources. |

- Une discussion est rattachée aux pages `about` et `scope_node` : elle apparaît sur leur page.
- Un message de retour (`role: feedback`) d'un quiz porte le **score** dans [0, 1] de la
  flashcard `card` (`"self": true` pour une auto-évaluation). Seuls les quiz comptent pour la
  maîtrise.
- Une connaissance extraite d'une discussion la désigne par son `id` dans `extracted_from`.
- Une discussion est privée par défaut ; un quiz n'est jamais publié.

### Maîtrise

La maîtrise se calcule par flashcard ; celle d'une connaissance ou d'une catégorie est la
moyenne de ses flashcards. Pour chaque flashcard, à partir de sa date de création (jour `e` =
`f`, m = 0,5, β = 0,95), on rejoue chronologiquement les scores x des quiz, au jour d :

1. m ← m · β^(d − e) (déclin) ;
2. m ← (1 − α) · m + α · x (α = 0,5) ;
3. si x > 0,5 : β ← 1 − 0,05 / (1 + d − f) ; sinon f ← d et β ← 0,95 ;
4. e ← d.

La maîtrise actuelle vaut m · β^(aujourd'hui − e). Les paramètres sont dans la configuration ;
les modifier s'applique rétroactivement.

## Liens

Liens Markdown **relatifs** vers le `index.md` de la page cible : `[Lilith](../lilith/index.md)`,
y compris d'un espace à l'autre (`../wiki/…` depuis une discussion). L'application les réécrit
quand une page est renommée, déplacée ou supprimée (le lien devient alors du texte). Supprimer
une source transforme ses citations en références libres (son titre). À la publication, un lien
vers ce qui n'est pas publié devient du texte.

## Configuration (`.notes/config.yml`)

```yaml
title: Mon wiki
root: wiki/                         # le wiki
library: library/                   # la bibliothèque des sources
discussions: discussions/           # les discussions
private_repo: alice/eugenia-wiki    # recopié dans le dépôt public (détection du propriétaire)
default_visibility: private
folder_name_max_length: 32
mastery:
  initial: 0.5
  alpha: 0.5
  decay_rate: 0.05
  success_threshold: 0.5            # réussite si score > 0,5
  reminder_threshold: 0.4           # rappel de révision sous ce seuil
```

Les réglages personnels (jeton, clés d'API, fournisseur d'IA) ne sont jamais dans le dépôt.

## Visibilité

1. Une nouvelle page est privée.
2. Sans `visibility`, une page hérite de son parent (la racine : `default_visibility`).
3. Une page publique ne peut pas avoir d'ancêtre privé (`validate` et la publication refusent).
4. Rendre une page publique ne rend pas publics ses descendants (l'application propose de les inclure).
5. Rendre une page privée rend privés tous ses descendants.
6. Chaque source de la bibliothèque a sa propre visibilité (privée par défaut). Une connaissance
   publique qui cite une source privée est publiée sans cette référence.

## Dépôt public généré

Le dépôt public, écrit uniquement par la publication, contient les pages publiques du wiki et de
la bibliothèque (sans fichier personnel des sources, ni lien ou référence vers le privé), leurs
fichiers joints, les descriptions publiques renommées `_summary.md`, les discussions marquées
publiques (jamais les quiz), une configuration réduite, un `README.md` et `.notes/index.json` :

```json
{
  "format": "eugenia-index",
  "version": 2,
  "generated": "2026-11-17T16:28:24.202Z",
  "title": "Wiki de démonstration",
  "root": "wiki",
  "library": "library",
  "discussions": "discussions",
  "rootId": "01M6B5CJM0EDQQYQ3XR5ZN1ACK",
  "files": [{ "path": "wiki/index.md", "sha": "a2d07f6…", "size": 540 }],
  "nodes": [
    { "id": "01M6B5CJM0EDQQYQ3XR5ZN1ACK", "path": "wiki", "type": "category", "title": "Wiki de démonstration",
      "visibility": "public", "parent": null, "description": "Ce wiki de démonstration rassemble…" },
    { "id": "01M6DKS4209DK53G50GBPV3WD6", "path": "library/wikipedia-lilith", "type": "source",
      "kind": "web", "url": "https://fr.wikipedia.org/wiki/Lilith", "parent": "virtual:library", "…": "…" }
  ],
  "discussionList": []
}
```

L'application lit ce fichier sans API GitHub (raw.githubusercontent.com), puis les fichiers à la
demande, mis en cache par SHA.
