# Format de stockage d'un wiki Eugenia

Un wiki Eugenia est un dépôt git ordinaire : des dossiers et des fichiers Markdown avec un
frontmatter YAML. L'application ne montre jamais ces fichiers, mais ils restent lisibles et
modifiables à la main. `eugenia validate` vérifie un dépôt modifié hors de l'application.

Ce document décrit la version 1 du format (spécification §5).

## Arborescence

```
.notes/
  config.yml                 configuration du wiki
  prompts/<nom>.md           surcharges facultatives des prompts d'Eugenia
wiki/                        racine (champ `root` de la configuration)
  index.md                   la page racine : le wiki global
  _summary.md                description du wiki global (portée privée)
  _summary.public.md         description du wiki global (portée publique)
  _embedding.json            embedding de la page (recherche sémantique, jamais publié)
  religion-et-croyances/
    index.md                 une page (catégorie, note ou connaissance atomique)
    _summary.md
    _quizzes/2026-11-17-1030.md
    _discussions/2026-11-17-lilith-et-la-lune-noire.md
    lilith/index.md
    article-sur-lilith/
      index.md
      article.pdf            fichier joint
```

- **Toute page est un dossier contenant un `index.md`**, qu'elle ait des enfants ou non. Les
  sous-pages sont des sous-dossiers.
- Les noms commençant par `_` ou `.` sont réservés à l'application et ne sont pas des pages.
- Un dossier sans `index.md` qui contient des pages est affiché comme une catégorie (signalé
  par `validate`).
- Les autres fichiers d'un dossier sont des **fichiers joints** de sa page.
- Ordre des enfants : champ `order`, puis titre (ordre alphabétique français).
- Ni profondeur ni largeur maximales.

### Nom des dossiers

Dérivé du titre : minuscules, sans accents, caractères non alphanumériques remplacés par `-`,
tronqué à 32 caractères (`folder_name_max_length`) sans couper un mot si possible, suffixe `-2`,
`-3`… en cas de collision. Quand le titre change, l'application renomme le dossier et réécrit
les liens entrants dans le même commit ; l'`id` ne change jamais.

## Pages (`index.md`)

```yaml
---
id: 01M6BC89W0J04TZ0V9ZXT186H6   # ULID, stable
type: flashcard                  # note (défaut) | flashcard
title: Lilith
visibility: public               # public | private ; hérité du parent si absent
created: 2026-11-02T08:30:00Z
updated: 2026-11-02T08:30:00Z
tags: [mythologie]
order: 10                        # facultatif
extracted_from: 01M6BK4140P9T3R69AH4Y8K1PA   # note source (flashcards)
sources:
  - description: Wikipédia, article « Lilith »
    url: https://fr.wikipedia.org/wiki/Lilith
    file: article.pdf            # fichier personnel, jamais publié
---
```

Les clés inconnues sont conservées. Un `type` inconnu est traité comme `note`.

### Notes

Le corps est du Markdown libre (CommonMark et GFM). Une note avec des sous-pages est une
**catégorie** (sous-wiki) ; une note est aussi le **texte source** d'une extraction.

### Connaissances atomiques (flashcards)

```markdown
## Connaissance
**Lilith** est un démon féminin de la tradition juive, inspiré d'une divinité d'origine mésopotamienne.

## Question
Quel est le nom du démon féminin de la tradition juive, inspiré d'une divinité d'origine mésopotamienne ?

## Réponse attendue
Lilith
```

La partie en **gras** de la connaissance est la cible d'apprentissage. Les sections inconnues
(`## Notes`…) sont conservées. La catégorie d'une connaissance est sa position dans l'arbre. La
maîtrise n'est pas stockée : elle est recalculée à partir des quiz.

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

- Texte envoyé au modèle : titre, étiquettes, puis contenu en texte brut (pour une connaissance
  atomique : énoncé, question et réponse, sans les titres de section). Ni frontmatter ni adresse
  de lien : déplacer une page ou changer sa visibilité ne rend pas son embedding périmé.
- `text_sha` : SHA (blob git, 7 caractères) de ce texte. L'embedding est **périmé** quand ce SHA
  ou le modèle diffère ; un embedding d'un autre modèle n'est jamais comparé à la requête.
- `vector` : composantes quantifiées sur 8 bits signés (base64), à multiplier par `scale`.
- Le fichier suit la page quand elle est renommée ou déplacée, et disparaît avec elle. Il n'est
  **jamais publié**, même pour une page publique : il est calculé sur le contenu du dépôt privé.

## Discussions et quiz

Un fichier par discussion, une section par message (`## <rôle> · <horodatage>`), rôles `user`
et `eugenia`. Les métadonnées d'un message sont portées par un commentaire HTML invisible.

```markdown
---
id: 01M6CJ0SR0BVVET7CEJVMHZCXF
type: discussion
kind: quiz                         # absent pour une discussion libre
title: Quiz — Religion et croyances
scope_node: 01M6B8TE80FWZWZ9A13320JP2Z   # quiz : catégorie interrogée ; discussion : `about`
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

- Discussions libres : `_discussions/<date>-<titre>.md` ; quiz : `_quizzes/<date>-<heure>.md`
  (UTC) dans la catégorie interrogée.
- Un message de retour (`role: feedback`) porte le **score** dans [0, 1] de la flashcard `card`
  (`"self": true` pour une auto-évaluation). Ces retours sont la trace de révision.
- Une discussion est privée par défaut ; un quiz n'est jamais publié.

### Maîtrise

Pour chaque flashcard, à partir de sa date de création (jour `e` = `f`, m = 0,5, β = 0,95), on
rejoue chronologiquement les scores x des quiz, au jour d :

1. m ← m · β^(d − e) (déclin) ;
2. m ← (1 − α) · m + α · x (α = 0,5) ;
3. si x > 0,5 : β ← 1 − 0,05 / (1 + d − f) ; sinon f ← d et β ← 0,95 ;
4. e ← d.

La maîtrise actuelle vaut m · β^(aujourd'hui − e). Les paramètres sont dans la configuration ;
les modifier s'applique rétroactivement.

## Liens

Liens Markdown **relatifs** vers le `index.md` de la page cible : `[Lilith](../lilith/index.md)`.
L'application les réécrit quand une page est renommée, déplacée ou supprimée (le lien devient
alors du texte). À la publication, un lien vers ce qui n'est pas publié devient du texte.

## Configuration (`.notes/config.yml`)

```yaml
title: Mon wiki
root: wiki/
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

## Dépôt public généré

Le dépôt public, écrit uniquement par la publication, contient les pages publiques (sans
fichiers personnels de sources ni lien vers le privé), leurs fichiers joints, les descriptions
publiques renommées `_summary.md`, les discussions marquées publiques, une configuration réduite,
un `README.md` et `.notes/index.json` :

```json
{
  "format": "eugenia-index",
  "version": 1,
  "generated": "2026-11-17T16:28:24.202Z",
  "title": "Wiki de démonstration",
  "root": "wiki",
  "rootId": "01M6B5CJM0EDQQYQ3XR5ZN1ACK",
  "files": [{ "path": "wiki/index.md", "sha": "a2d07f6…", "size": 540 }],
  "nodes": [
    { "id": "01M6B5CJM0EDQQYQ3XR5ZN1ACK", "path": "wiki", "type": "note", "title": "Wiki de démonstration",
      "visibility": "public", "parent": null, "description": "Ce wiki de démonstration rassemble…" }
  ]
}
```

L'application lit ce fichier sans API GitHub (raw.githubusercontent.com), puis les fichiers à la
demande, mis en cache par SHA.
