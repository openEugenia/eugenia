# Eugenia

**A personal knowledge wiki, on git.** Eugenia helps everyone extract, structure and durably
remember the knowledge of their daily life, then share it. Eugenia is both the name of the
project and of the AI assistant that accompanies the user.

- Your knowledge is **Markdown files in your own git repositories**: a private repository that
  holds everything, and a generated public repository with what you choose to share. No central
  database; a free GitHub account is enough.
- Three spaces: the **wiki**, a tree of categories (each sub-wiki **described by Eugenia**) that
  holds your **atomic knowledge**, each item tested by one or more **flashcards**; the
  **library**, the sources this knowledge comes from (books, articles, websites, PDFs); the
  **discussions**, all your exchanges with Eugenia (discussions, questions, quizzes, quick notes).
  They form **one hierarchy**: each source is filed in a category of the wiki, each discussion
  sits under the page it was started from.
- Each source is **indexed**: a Mistral model reads it once and describes its whole content as a
  **knowledge tree**, browsed like the wiki and read by Eugenia at low cost, and proposes the
  knowledge worth extracting.
- Eugenia **answers from your tree only**: each question searches every element of the hierarchy
  (knowledge, sources and their index, discussions), by going down the tree or by meaning, and her
  answers cite what they are based on — or say that your wiki does not hold the answer.
- Eugenia **extracts atomic knowledge** from your sources, quick notes and discussions, linking
  it to its sources and filing it into categories as Wikipedia would, then helps you **review**
  it with conversational quizzes, with a mastery that decays over time.
- **A single instance** of the app, published by openEugenia on GitHub Pages, serves every user:
  each one opens it on their own repository. It works **offline** (PWA).

App: <https://openeugenia.github.io/eugenia/> · Specification: [`specifications/`](specifications/README.md)

## Getting started

### Create your wiki

With the CLI (Node.js 22.12 or later, pnpm 10, [GitHub CLI](https://cli.github.com/) logged in):

```sh
git clone https://github.com/openEugenia/eugenia.git && cd eugenia
pnpm install && pnpm --filter @openeugenia/cli build
node packages/cli/dist/eugenia.mjs init ../my-wiki --title "My wiki" --github
```

`--github` creates the private repository, the public repository, the deploy key and the
publication secret. Without this option, only the files are created (configuration, root and the
15 default categories). You can also create the wiki from the app ("New wiki") in an empty
private repository.

### Open it

1. Create a [fine-grained token](https://github.com/settings/personal-access-tokens/new) limited
   to the private repository of the wiki, with the "Contents" permission in read and write.
2. Open `https://openeugenia.github.io/eugenia/?repo=<account>/<repository>` and enter the token
   in the settings, along with your AI provider (Claude key, OpenAI-compatible server or local
   Ollama).

Anyone can read your public part with `?repo=<account>/<public-repository>`; with your token, you
also see the private part.

### Publish the public part

Every push to the private repository triggers the [`openEugenia/eugenia`](action.yml) action,
which publishes the public nodes only to the public repository, rewriting its history. Private
sources are published as their bibliographic record only (title, kind, authors, date, URL), so
that public knowledge can still cite them. See [docs/publication.md](docs/publication.md).

## Features (v1)

| | |
|---|---|
| **Wiki** | Collapsible tree of categories and atomic knowledge (each branch shows how many sources and discussions it holds, opening the filtered Library or Discussions), sub-wiki descriptions (written in the first person), mastery gauges, knowledge that "needs a source" flagged, backlinks, full-text search or search by meaning across pages, discussions and source indexes (Mistral embeddings), radial graph, dashboard. |
| **Library** | Sources (book, article, website, video, audio, document), each filed in a category of the wiki (common hierarchy: shown in the category, counted in the tree), filters by category, kind and tag, personal file never published, knowledge that cites each source. Private sources show only their bibliographic record in the public part. |
| **Indexing** | Each new or changed source is indexed by a Mistral model of your choice (Mistral Small without reasoning by default; Mistral Large, Mistral Small with reasoning, Ministral 14B or 8B): a knowledge tree (topics, ideas, arguments, examples, conclusions) with the knowledge worth extracting, stored like the wiki in its `_index/` folder (one page per node), browsed like the wiki, published with public sources. An "Indexes" view indexes the sources in the background while you keep browsing; the extraction can start from the proposed knowledge. Long sources are read in parts. `eugenia index` indexes in a batch. |
| **Editing** | Categories and sources in Markdown (CodeMirror), atomic knowledge (statement, bold target, library sources with location), flashcards (question, answer), links by title search (`[[`). Renaming or moving a page rewrites its incoming links. All changes go out in a single commit. |
| **Visibility** | Private by default; a public page never has a private ancestor; links to private content become text on publication; personal files and quizzes are never published; private sources only publish their bibliographic record. |
| **Extraction** | From a source, a discussion, a quick note, a pasted text or a PDF (which becomes a source): highlighting by Eugenia and by you, proposals of knowledge and of its first flashcard, then the categories that best group the knowledge of the document, as Wikipedia would (existing ones, or new ones to review), and creation in one commit. Eugenia also proposes new flashcards for a knowledge item. |
| **Review** | Quizzes on flashcards by increasing mastery, evaluation by Eugenia or offline self-assessment, mastery recomputed by replaying quizzes, reminders. |
| **Discussions** | A section that gathers discussions, questions, quizzes and quick notes, filterable by kind; discussion from any page (placed under it in the hierarchy), quick note that Eugenia answers right away (candidate knowledge, what the wiki says, source leads), summary of the exchange, extraction. |
| **Questions** | Questions about a branch of the tree: Eugenia searches every element of the hierarchy (categories, knowledge, sources down to the sections of their index, discussions), by going down the tree and by meaning (embeddings), then answers from what she read only, with citations and the list of elements the answer is based on. Her discussion answers follow the same rule. |
| **AI** | Claude (default `claude-opus-5-5`), any OpenAI-compatible provider (reasoning models included), Ollama; Mistral models for indexing (with or without reasoning), `mistral-embed` for search by meaning. "Local AI for private content" option. Versioned, overridable prompts. |
| **Offline** | Local copy (IndexedDB), commit queue, node-by-node conflict resolution. |

Planned after v1 (specification §14): "Sign in with GitHub" (GitHub App), audio and video
transcription, notifications, social features (similarity between wikis, public discussions,
news feed).

## Repository layout

```
packages/
  core/   Data model: three spaces (wiki, library, discussions) and their common hierarchy,
          page format, tree, source indexes, embeddings, naming, links, visibility,
          publication, stale descriptions, mastery algorithm. No browser or Node dependency.
  ai/     Eugenia: providers (Claude through the official SDK, OpenAI-compatible, Ollama),
          prompts (prompts/*.md) and tasks (extraction, categorization, flashcards,
          descriptions, evaluation, discussion, quick note, indexing of sources, questions
          about the tree).
  cli/    `eugenia init | validate | publish | summarize | index | embed`, built into a single file
          and used by the publication action.
  web/    React app (PWA): views, git synchronization, offline copy.
examples/demo-wiki/   Demo wiki (typical private repository).
docs/                 Storage format, publication.
action.yml            Publication GitHub Action.
specifications/       Specification and functional documentation.
```

## Development

Prerequisites: Node.js 22.12 or later, pnpm 10 (`npx pnpm@10` works).

```sh
pnpm install
pnpm dev          # app on http://localhost:5173/eugenia/
pnpm test         # unit tests (core, ai, cli, web)
pnpm test:e2e     # end-to-end tests (Playwright; GitHub and Claude simulated)
pnpm typecheck
pnpm build        # app (packages/web/dist) and CLI (packages/cli/dist)
pnpm eugenia validate examples/demo-wiki
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the conventions.

## Documentation

- [Storage format](docs/format.md): editing a wiki by hand, without the app.
- [Publication](docs/publication.md): repositories, deploy key, action, private sources.
- [Eugenia's prompts](packages/ai/prompts/README.md): what the AI is asked, and how to override it.
- [Specification](specifications/README.md) and [functional documentation](specifications/functional_doc/).

## License

[MIT](LICENSE). The openEugenia graphic charter, included in `packages/web/src/vendor/`, is also
under the MIT license.
