# Publier la partie publique d'un wiki

Un wiki Eugenia vit dans **deux dépôts** (spécification §6) :

- le **dépôt privé** (ex. `alice/eugenia-wiki`) contient tout, et c'est le seul qu'on modifie ;
- le **dépôt public** (ex. `alice/eugenia-wiki-public`) est généré à chaque push sur le dépôt
  privé, avec les seuls nœuds publics. Il n'est jamais modifié à la main.

Pourquoi deux dépôts : sur GitHub, l'accès en lecture vaut pour tout un dépôt, pas pour une
branche, et exposer une partie d'un dépôt privé exige un compte payant.

## Mise en place automatique

```sh
eugenia init mon-wiki --title "Mon wiki" --github
```

La commande, qui utilise la [CLI GitHub](https://cli.github.com/) (`gh auth login`) et `ssh-keygen` :

1. crée le dépôt privé et le dépôt public ;
2. génère une clé SSH de déploiement, l'ajoute **en écriture** au seul dépôt public, et range la
   clé privée dans le secret `EUGENIA_DEPLOY_KEY` du dépôt privé (elle n'est conservée nulle part
   ailleurs) ;
3. pousse le wiki, ce qui déclenche la première publication.

Options utiles : `--private-repo`, `--public-repo`, `--dry-run` (affiche les commandes).

## Mise en place manuelle

1. Créez le dépôt public (vide).
2. Générez une clé : `ssh-keygen -t ed25519 -N "" -f eugenia_deploy_key`.
3. Dépôt public → *Settings* → *Deploy keys* → ajoutez `eugenia_deploy_key.pub`, en cochant
   *Allow write access*.
4. Dépôt privé → *Settings* → *Secrets and variables* → *Actions* → secret
   `EUGENIA_DEPLOY_KEY` contenant `eugenia_deploy_key` (la clé privée). Supprimez ensuite les
   deux fichiers.
5. Ajoutez au dépôt privé `.github/workflows/eugenia-publish.yml` :

```yaml
name: Eugenia — publication
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
concurrency:
  group: eugenia-publish
  cancel-in-progress: true
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: openEugenia/eugenia@v1
        with:
          target: alice/eugenia-wiki-public
          deploy-key: ${{ secrets.EUGENIA_DEPLOY_KEY }}
```

Au lieu d'une clé de déploiement, l'entrée `token` accepte un jeton fine-grained limité au dépôt
public (« Contents » en écriture).

## Entrées de l'action

| Entrée | Défaut | Rôle |
|---|---|---|
| `target` | — | Dépôt public cible (`owner/name`). |
| `deploy-key` | — | Clé SSH privée de déploiement (recommandé). |
| `token` | — | Jeton limité au dépôt public, à la place de la clé. |
| `path` | `.` | Dossier du wiki dans le dépôt privé. |
| `branch` | `main` | Branche du dépôt public. |
| `private-repo` | celui de la configuration | Dépôt privé déclaré dans la configuration publique. |
| `dry-run` | `false` | Construit et vérifie sans pousser. |

## Ce que fait la publication

`eugenia publish` (utilisé par l'action) :

1. charge le wiki et **refuse** de publier si une page publique a un ancêtre privé, si une page
   publique a un frontmatter illisible, ou si une description publique a été générée à partir
   d'un nœud privé ;
2. construit l'arborescence publique : pages publiques (liens vers le non-publié changés en
   texte, fichiers personnels des sources retirés), fichiers joints, descriptions publiques
   (`_summary.public.md` renommé `_summary.md`), discussions marquées publiques,
   `.notes/config.yml` réduit, `README.md` et `.notes/index.json` ;
3. pousse un **unique commit** dont le message ne reprend rien du dépôt privé, en remplaçant
   l'historique du dépôt public.

Les quiz et les fichiers personnels ne sont jamais publiés.

Pour vérifier localement : `eugenia publish . --out /tmp/public` construit l'arborescence sans
rien pousser.

## Descriptions publiques

Seules les descriptions de portée publique sont publiées. Elles se génèrent depuis
l'application (vue « Descriptions », portée publique) ou en lot :

```sh
ANTHROPIC_API_KEY=… eugenia summarize . --scope public
```

`--local-only-private` interdit l'envoi de contenu privé à un fournisseur distant (utile avec
`--provider ollama` pour la portée privée).

## Lecture publique

Une fois publié, le wiki se lit sans compte : `https://openeugenia.github.io/eugenia/?repo=alice/eugenia-wiki-public`.
Si `private_repo` est déclaré et que le visiteur a accès à ce dépôt avec son jeton, l'application
bascule sur le dépôt privé et affiche tout le wiki.
