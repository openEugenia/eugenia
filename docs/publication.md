# Publishing the public part of a wiki

An Eugenia wiki lives in **two repositories** (specification §6):

- the **private repository** (e.g. `alice/eugenia-wiki`) holds everything, and it is the only one
  you edit;
- the **public repository** (e.g. `alice/eugenia-wiki-public`) is generated on every push to the
  private repository, with the public nodes only. It is never edited by hand.

Why two repositories: on GitHub, read access applies to a whole repository, not to a branch, and
exposing part of a private repository requires a paid account.

## Automatic setup

```sh
eugenia init my-wiki --title "My wiki" --github
```

The command, which uses the [GitHub CLI](https://cli.github.com/) (`gh auth login`) and
`ssh-keygen`:

1. creates the private repository and the public repository;
2. generates an SSH deploy key, adds it **with write access** to the public repository only, and
   stores the private key in the `EUGENIA_DEPLOY_KEY` secret of the private repository (it is
   kept nowhere else);
3. pushes the wiki, which triggers the first publication.

Useful options: `--private-repo`, `--public-repo`, `--dry-run` (shows the commands).

## Manual setup

1. Create the public repository (empty).
2. Generate a key: `ssh-keygen -t ed25519 -N "" -f eugenia_deploy_key`.
3. Public repository → *Settings* → *Deploy keys* → add `eugenia_deploy_key.pub`, checking
   *Allow write access*.
4. Private repository → *Settings* → *Secrets and variables* → *Actions* → secret
   `EUGENIA_DEPLOY_KEY` containing `eugenia_deploy_key` (the private key). Then delete both
   files.
5. Add `.github/workflows/eugenia-publish.yml` to the private repository:

```yaml
name: Eugenia — publish
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

Instead of a deploy key, the `token` input accepts a fine-grained token limited to the public
repository ("Contents" write access).

## Action inputs

| Input | Default | Role |
|---|---|---|
| `target` | — | Target public repository (`owner/name`). |
| `deploy-key` | — | Private SSH deploy key (recommended). |
| `token` | — | Token limited to the public repository, instead of the key. |
| `path` | `.` | Folder of the wiki in the private repository. |
| `branch` | `main` | Branch of the public repository. |
| `private-repo` | the one of the configuration | Private repository declared in the public configuration. |
| `dry-run` | `false` | Builds and checks without pushing. |

## What the publication does

`eugenia publish` (used by the action):

1. loads the wiki and **refuses** to publish if a public page has a private ancestor, if a public
   page has an unreadable frontmatter, or if a public description was generated from a private
   node;
2. builds the public tree: public pages (links to unpublished content turned into text, personal
   files of sources removed), attached files, public descriptions (`_summary.public.md` renamed
   `_summary.md`), the bibliographic records of private sources (see below), discussions marked
   public, a reduced `.notes/config.yml`, a `README.md` and `.notes/index.json`;
3. pushes a **single commit** whose message repeats nothing from the private repository,
   replacing the history of the public repository.

Quizzes and personal files are never published.

To check locally: `eugenia publish . --out /tmp/public` builds the tree without pushing anything.

## Private sources: bibliographic record only

A private source of the library keeps its content (excerpts, summary, reading notes), its
personal file and its tags private. Its **bibliographic record** is published, so that public
knowledge can still cite it and readers can find the source themselves:

```yaml
---
id: 01M6BK4140P9T3R69AH4Y8K1PA
type: source
kind: article
title: Article on Lilith
visibility: private      # marks the record: the content is private
authors:
  - Jane Doe
url: https://example.org/lilith
published: "2019"
---
```

Only these fields are published: `id`, `type`, `kind`, `title`, `authors`, `published`, `url`
and `visibility: private`. Every other key is left out, as is the body. The citations of the
source (`sources[].ref`), `extracted_from` and the Markdown links to it stay in the public
pages. The app shows such a source with a "Record only" badge. A private source whose
frontmatter cannot be read is left out, with a warning.

Do not put in the title, authors or URL of a private source anything you do not want to make
public.

## Public descriptions

Only public-scope descriptions are published. They are generated from the app ("Descriptions"
view, public scope) or in a batch:

```sh
ANTHROPIC_API_KEY=… eugenia summarize . --scope public
```

`--local-only-private` forbids sending private content to a remote provider (useful with
`--provider ollama` for the private scope).

## Public reading

Once published, the wiki can be read without an account:
`https://openeugenia.github.io/eugenia/?repo=alice/eugenia-wiki-public`. If `private_repo` is
declared and the visitor can access that repository with their token, the app switches to the
private repository and shows the whole wiki.
