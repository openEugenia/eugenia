# Specification — Eugenia: a personal knowledge wiki, on git

> Status: draft v0.10 — 2026-11-23 (common hierarchy of the wiki, the library and the discussions; indexing of sources as detailed knowledge trees stored like the wiki, checked against the source, with knowledge proposed for the user to add; a choice of Mistral models; Eugenia's tasks in the background — indexes and descriptions; embedding vectors of every indexed element; Eugenia's answers based on the tree only)
> This document is the starting point of the project's git repository. It turns the functional documentation of the [`functional_doc/`](functional_doc/) folder into a technical specification; the functional documentation remains the reference for the "what" and the "why". Open points are listed in §16.

---

## 1. Vision

**Eugenia** helps everyone **extract, structure and durably remember** the knowledge of their daily life, then share it ([pitch](functional_doc/pitch.qmd)). Eugenia is both the name of the project and of the **AI assistant** that accompanies the user ([intro](functional_doc/0_intro.qmd)).

This project is its **decentralized and open-source** implementation:

- The user's knowledge is **Markdown files in their own git repositories** (one private, one public): they are the sole owner of their data, with no central database. A free GitHub account is enough.
- It forms a **tree**: the **personal wiki**. Each parent node (sub-wiki) is **summarized by Eugenia** from what lies below.
- Eugenia proposes **atomic knowledge** (flashcards) extracted from the user's notes and sources, then helps them **reinforce** it through conversational quizzes, with a mastery score and a decay mechanism.
- The wiki, the library of sources and the discussions form **one hierarchy**; each source is **indexed** as a knowledge tree, and Eugenia's answers are **based on this tree only**.
- Knowledge is **public or private**: anyone can browse the public part of a wiki; the owner also sees the private part.
- **A single instance** of the app, published on GitHub Pages by the **openEugenia** account, serves every user: each one opens it on their own repository.
- The app works **offline** (PWA) and synchronizes when the network is back.

The user **never handles files**: they only see a hierarchy of nodes. The storage format (§5) is an implementation detail, but it stays readable and editable without the app.

## 2. Goals and non-goals

### Goals (v1)
1. Browse a hierarchical personal wiki from a given git repository.
2. Create, edit, move and delete nodes from the interface, with a commit to the repository.
3. Extract atomic knowledge from texts (notes, imported documents) with Eugenia's help, and file it into categories.
4. Generate and maintain the sub-wiki descriptions (summaries), re-evaluated in the background when they become stale.
5. Reinforce knowledge through conversational quizzes, tracking mastery and decay.
6. Discuss with Eugenia from any node, and ask her about the whole tree.
7. Reliably separate public and private knowledge.
8. Work offline.

### Non-goals (v1)
The **social** features described in the functional documentation ([§4](functional_doc/4_toward_social_network.qmd), [§5](functional_doc/5_discussion.qmd), [§6](functional_doc/6_other_sn_tools.qmd)) are out of the v1 scope, but the architecture must allow them later (§14):
- similarity between wikis, connection suggestions, news feed, capsules ("reals");
- public discussions with several participants (v1 discussions are **personal**: the user and Eugenia);
- badges, trophies, rankings;
- automatic scope according to mastery (a poorly mastered knowledge item that becomes private again).

Also out of scope: real-time collaborative editing, an application backend (except a possible authentication micro-service, §7), forges other than GitHub, a native mobile app (the PWA covers mobile use).

## 3. Glossary

The functional definitions come from `functional_doc/`. This table states how they translate into the data model.

| Term | Definition | In the model |
|---|---|---|
| **Eugenia** | The assistant, an interface to the AI algorithms. | `packages/ai` layer + prompts. |
| **Atomic knowledge** | A simple, precise statement, understandable without implicit context ([§1](functional_doc/1_knowledge_extraction.qmd)). Leaf of the wiki. | Node of type `knowledge`. |
| **Flashcard** | A question and an expected answer that test an atomic knowledge item; a knowledge item can have several. | Node of type `flashcard`, child of a `knowledge`. |
| **Category / sub-wiki** | A set of grouped knowledge; a level of the tree ([§2](functional_doc/2_wiki.qmd)). | Node of type `category`. |
| **Sub-wiki description** | A text that summarizes what a sub-wiki contains. | Node of type `summary` attached to the parent. |
| **Personal wiki** | The navigation interface of the knowledge tree. | The app itself. |
| **Knowledge base** | All the atomic knowledge and its mastery state. | All the `knowledge` and `flashcard` of the repository + quiz history. |
| **Source** | Origin of a knowledge item (publication, website…) ([§1](functional_doc/1_knowledge_extraction.qmd)). | Node of type `source` of the **library**, cited by knowledge (`sources[].ref`). |
| **Bibliographic record** | The descriptive fields of a source (title, kind, authors, date, URL), as opposed to its content. | The only part of a private source that is published (§6.2). |
| **Library** | All the user's sources, separate from the wiki. | `library/` folder, flat list. |
| **Discussions** | All the exchanges with Eugenia: free discussions, questions, quizzes, quick notes. | `discussions/` folder, one file per discussion (§5.6). |
| **Quick note** | An idea or a fact noted on the fly, which Eugenia answers with candidate knowledge and source leads. | `discussion` node of kind `note`. |
| **Mastery** | Value in [0, 1] of the mastery of a flashcard, 0.5 by default ([§3](functional_doc/3_reinforcement.qmd)); the mastery of a knowledge item or a category is the average of its flashcards. | Computed from the quiz history (§8.3). |
| **Decay** | Daily factor by which mastery decreases. | Computed from the quiz history (§8.3). |
| **Quiz** | A conversation in which Eugenia questions the user on a category. | `discussion` node of kind `quiz`. |
| **Private repository** | Private git repository holding the **whole** wiki. Source of truth, the only one edited. | — |
| **Public repository** | Public git repository generated from the public nodes only. Never edited by hand. | — |
| **Branch of the tree** | A node and all its descendants (not to be confused with a git branch). | — |
| **Stale** | A summary at least one of whose sources changed since it was generated. | — |
| **Common hierarchy** | The single tree formed by the wiki, the library and the discussions: each source is filed in a category, each discussion is placed under the page it was started from. | Computed from identifiers (§5.10). |
| **Source index** | A tree of concepts that describes the whole content of a source, with the knowledge worth extracting, generated once by a model and read at low cost. | `_index/` folder of the source, one `index.md` per node (§8.6). |
| **Section** | A node of the index of a source, below its root. | `<source id>#<path>`, e.g. `01JD3S…#origins/lilitu`. |

## 4. General architecture

```
┌──────────────────────────────┐            ┌──────────────────────────────┐
│ PRIVATE repo (source of truth)│──CI──────▶│ PUBLIC repo (generated)      │
│ e.g. user/eugenia-wiki       │  publish   │ e.g. user/eugenia-wiki-public│
│ public + private wiki        │            │ public nodes + index.json    │
└───────────────▲──────────────┘            └──────────────────▲───────────┘
                │ GitHub API (owner token)                     │ anonymous HTTP
                │                                              │ (raw.githubusercontent.com)
                │                                              │
        ┌───────┴───────────────────────────────────────────────────────┴───┐
        │  Eugenia app — static PWA                                         │
        │  https://openeugenia.github.io/eugenia/                           │
        │  - wiki / editing / extraction / quiz                             │
        │  - local copy (IndexedDB) + sync queue                            │
        │  - AI calls straight from the browser                             │
        └─────────────────────────────────┬─────────────────────────────────┘
                                          │
                           ┌──────────────┴──────────────┐
                           │ Configurable AI provider    │
                           │ (Claude API, local Ollama…) │
                           └─────────────────────────────┘
```

### 4.1 Components (monorepo)

| Package | Role |
|---|---|
| `packages/core` | TypeScript library without browser dependency: node parsing, frontmatter, tree building, folder naming, link rewriting, visibility rules, public filtering, stale summary detection, **mastery algorithm** (§8.3). Reused by the web app and the CLI. |
| `packages/web` | React app (SPA + PWA) deployed on GitHub Pages by the openEugenia account. |
| `packages/cli` | Command-line tool / GitHub Action: format validation, publication to the public repository, batch summary generation, initialization of a new wiki. |
| `packages/ai` | AI provider abstraction and Eugenia's prompts (extraction, categorization, summary, answer evaluation, discussion). |

### 4.2 Stack
- Language: **TypeScript** everywhere.
- UI: **React**.
- Build: **Vite** (+ `vite-plugin-pwa`), **pnpm workspaces** monorepo.
- Markdown: **unified / remark / rehype** (parsing, frontmatter, rendering, link rewriting).
- Editor: **CodeMirror 6**.
- Visualization: collapsible tree + graph view (d3-hierarchy); progress charts.
- Local storage: **IndexedDB** (Dexie or idb).
- Document import: **pdf.js** for PDFs (audio and video: later, §14).
- Tests: **Vitest** (core), **Playwright** (web).
- Git access: **GitHub API** (Octokit). Alternative to study: `isomorphic-git`.

## 5. Data model

### 5.1 Tree

The repository has **three spaces**, each in its own folder (§5.9):

- the **wiki** (`wiki/`): a tree of categories holding atomic knowledge, itself extended **only** by its flashcards;
- the **library** (`library/`): the sources the knowledge comes from, as a flat list;
- the **discussions** (`discussions/`): all the exchanges with Eugenia (discussions, questions, quizzes, quick notes), one file per exchange.

**Every page** (`category`, `knowledge`, `flashcard`, `source`) **is a folder containing an `index.md`**, whether it has children or not. Child pages are subfolders. Files attached to a page without being pages themselves (descriptions, embeddings) start with `_`, in the page's folder:

```
wiki/
├── index.md                              # root: the global wiki (type: category)
├── _summary.md                           # description of the global wiki (private scope)
├── _summary.public.md                    # description of the global wiki (public scope)
├── religion-and-beliefs/
│   ├── index.md                          # category (type: category)
│   ├── _summary.md                       # description of the sub-wiki
│   └── lilith/
│       ├── index.md                      # atomic knowledge (type: knowledge)
│       └── what-is-the-name-of-the-female/
│           └── index.md                  # flashcard (type: flashcard)
└── science/
    ├── index.md
    └── astronomy/
        └── ...
library/
└── article-on-lilith/
    ├── index.md                          # source (type: source), filed in a category
    ├── article.pdf                       # personal file of the source
    └── _index/                           # index of the source: knowledge tree (§8.6)
        ├── index.md                      # root: summary of the source, knowledge to extract
        ├── origins/index.md              # a section (subsections in subfolders)
        └── _embeddings.json              # embeddings of its sections (never published)
discussions/
├── 2026-11-12-1800-lilith-and-the-black-moon.md   # free discussion
├── 2026-11-14-0830-51-pegasi-b.md                  # quick note (kind: note)
└── 2026-11-17-1030-quiz-religion-and-beliefs.md   # quiz (kind: quiz)
```

- Structure of the wiki: a **category** contains categories and knowledge items; a **knowledge item** only contains **flashcards**; a flashcard has no child. The library is **flat**. `validate` reports misplaced pages, and the interface refuses to move them elsewhere.
- The order of the children is set by the `order` field, otherwise alphabetical by title.
- Files and folders starting with `_` or `.` are reserved for the app and do not appear as children in the tree.
- **No limit** on the depth or width of categories.
- The three spaces form a **common hierarchy** (§5.10): the folders do not mirror it, the identifiers do.
- Attached files (PDFs, images, audio) are stored in the folder of the node concerned.
- The v1 format (everything under `wiki/`, free notes, discussions in `_discussions/` and `_quizzes/`) is not migrated automatically; `validate` reports its files.

### 5.2 Folder naming

The folder name is derived from the title, without the user seeing it:
1. lowercase, accents removed, non-alphanumeric characters replaced with `-`;
2. **truncation to the first characters** (32 by default, without cutting in the middle of a word when possible);
3. on collision with a sibling, a `-2`, `-3`… suffix is added.

**When the title changes, the folder is renamed** following the same rule, and incoming links are rewritten in the same commit (§5.8). The node's `id` never changes.

### 5.3 Common frontmatter

```yaml
---
id: 01JD3K8Z9X...          # stable ULID, generated on creation
type: category             # category | knowledge | flashcard | source | summary | discussion
title: Religion and beliefs
visibility: private        # public | private (inherited from the parent if absent)
created: 2026-11-17T10:30:00Z
updated: 2026-11-17T11:00:00Z
tags: []
order: 10                  # optional
---
```

### 5.4 Node types

| Type | Space | Role |
|---|---|---|
| `category` | wiki | **Category** (sub-wiki), with an optional introduction text. Default type in the wiki (`note`, the v1 type, is read this way). |
| `knowledge` | wiki | **Atomic knowledge**: a statement, its sources (§5.7). Leaf of the category tree. |
| `flashcard` | wiki | Question and expected answer on the parent knowledge item (§5.7). |
| `source` | library | Source of a knowledge item: bibliographic record, personal file, content (§5.7). Default type in the library. |
| `summary` | wiki | Description of a sub-wiki, generated by Eugenia (§5.5). |
| `discussion` | discussions | Personal exchange between the user and Eugenia (§5.6). |

An unknown type is reported and treated as the default type of the space.

### 5.5 Summaries (sub-wiki descriptions)

Stored in the `_summary.md` file of the folder of the described **category**, they are shown **at the top of the category**, not as a child. Only categories have a description: a knowledge item and its flashcards do not form a sub-wiki.

```yaml
---
id: 01JD3M...
type: summary
scope: private             # private = all children; public = public children only
model: claude-sonnet-5-5
generated: 2026-11-17T11:05:00Z
locked: false              # true = no longer offer regeneration
sources:                   # fingerprint of the sources at generation time
  01JD3K8Z9X...: 3f2a9c1   # child id → git blob SHA (content or summary of the child)
---
Text of the description…
```

- **Bottom-up** construction: the description of a category is made from the descriptions of its subcategories and the statements of its knowledge items. It thus goes from the most specific to the most general ([§2](functional_doc/2_wiki.qmd)).
- A category can have two descriptions: `_summary.md` (private scope) and `_summary.public.md` (public scope), see §6.3.

### 5.6 Discussions

All the exchanges with Eugenia are stored **in the same place**, `discussions/<date>-<time>-<title>.md` (UTC), and gathered in the Discussions section of the interface. A discussion is a single file: the messages are stored in it, one section per message. Per-message metadata is carried by an HTML comment invisible when rendered.

| `kind` | Kind | Attachment |
|---|---|---|
| absent (`discussion`) | Free discussion ("everything is a discussion", [§5](functional_doc/5_discussion.qmd)). | `about`: page it was opened from (optional). |
| `question` | Saved question about the tree (§8.5). | `scope_node`: scope of the question. |
| `quiz` | Review session (§8.3). | `scope_node`: quizzed category. |
| `note` | Quick note (§8.4). | `about` optional. |

A discussion also appears on the page of its `about` and `scope_node` nodes.

```markdown
---
id: 01JD3P...
type: discussion
title: Lilith and the Black Moon
about: 01JD3R...           # page the discussion started from (optional)
---

## user · 2026-11-17T10:00:00Z
What is the link between Lilith and the Black Moon?

## eugenia · 2026-11-17T10:00:12Z
In astrology, the "Black Moon" refers to…
```

**The quiz is the trace that stores the review state**: the mastery of each flashcard is recomputed by replaying the quizzes (§8.3).

```markdown
---
id: 01JD3Q...
type: discussion
kind: quiz
title: Quiz — Religion and beliefs
scope_node: 01JD3K8Z9X...  # chosen category
visibility: private
---

## eugenia · 2026-11-17T10:30:00Z
<!-- eugenia: {"card": "01JD3R...", "role": "question"} -->
What is the name of the female demon of Jewish tradition, inspired by a Mesopotamian deity?

## user · 2026-11-17T10:30:20Z
I think it is Lilita the Pita

## eugenia · 2026-11-17T10:30:24Z
<!-- eugenia: {"card": "01JD3R...", "role": "feedback", "score": 0.3} -->
The answer is incorrect: Lilith was expected. The spelling is wrong and the addition does not exist.
```

- Roles: `user`, `eugenia`.
- Only quizzes count for mastery; `card` refers to a **flashcard**.
- A discussion is **private by default**; a quiz is never published.
- The quiz is committed **in one go, at the end of the session** (or when the page closes, through the offline queue).

### 5.7 Atomic knowledge, flashcards and sources

The tuple *(knowledge, title, category, question)* of the functional documentation ([§1](functional_doc/1_knowledge_extraction.qmd)) is split between the **knowledge item** (statement, title; the **category is its position in the tree**) and its **flashcards** (question, expected answer). The only thing that extends a knowledge item is a flashcard.

**Atomic knowledge**:

```markdown
---
id: 01JD3R...
type: knowledge
title: Lilith
visibility: public
created: 2026-11-17T10:30:00Z
extracted_from: 01JD3S...  # originating source or discussion (optional)
sources:
  - ref: 01JD3S...         # library source
    locator: p. 12         # location in the source (optional)
  - description: Lecture at the Royal Institution   # free reference (optional)
    url: https://example.org
---

**Lilith** is a female demon of Jewish tradition, inspired by a deity of Mesopotamian origin.

## Notes
See also the [Black Moon](../../science/astronomy/black-moon/index.md).
```

- The body starts with the **statement**; its **bold** part is the **learning target**. Free sections (`## Notes`) may follow.
- A knowledge item **without a source** is allowed (for example from a quick note) but flagged **"needs a source"**: the interface invites the user to attach it to an external source.

**Flashcard**, child of a knowledge item:

```markdown
---
id: 01JD3T...
type: flashcard
title: What is the name of the female demon of Jewish tradition…
created: 2026-11-17T10:31:00Z
---

## Question
What is the name of the female demon of Jewish tradition, inspired by a deity of Mesopotamian origin?

## Expected answer
Lilith
```

- The title is taken from the question. A flashcard has no `visibility` of its own: it follows its knowledge item.
- Mastery, the date of the last failure and decay **are not stored**: they are derived from quizzes (§8.3), **per flashcard**.
- The French headings (`## Réponse attendue`, `## Connaissance`) of wikis written in French are also read.

**Source**, in the library:

```yaml
---
id: 01JD3S...
type: source
kind: article              # book | article | web | video | audio | document | other
title: Article on Lilith
authors: [Jane Doe]
published: "2019"
url: https://example.org/lilith
file: article.pdf          # personal file, never published
category: 01JD3K8Z9X...    # wiki category it is filed in (§5.10)
visibility: private
---
```

- The body (excerpts, summary, reading notes, text of an imported PDF) is the source text for extraction and for its index (§8.6).
- **Visibility**: each source has its own. A **private source** is published as its **bibliographic record** only (`id`, `type`, `kind`, `title`, `authors`, `published`, `url`, `visibility: private`): its content, personal file, tags and any other key stay private. A public knowledge item that cites a private source therefore keeps its citation in the public part, which leads to the record. The **personal file** is never published.
- Deleting a source turns its citations into free references (title, URL, location).

### 5.8 Links between nodes

- Syntax: **relative Markdown links** to the target `index.md`, e.g. `[Lilith](../lilith/index.md)`.
- In the editor, the user inserts a link by searching a node by its title; the path is generated automatically.
- When a node is moved or renamed, **all incoming links are rewritten** in the same commit.
- The interface shows **backlinks** (nodes that point to the current node).

### 5.9 Wiki configuration

```yaml
# .notes/config.yml
title: My wiki
root: wiki/                             # the wiki
library: library/                       # the source library
discussions: discussions/               # the discussions
private_repo: user/eugenia-wiki        # copied to the public repository, optional (§7)
default_visibility: private
folder_name_max_length: 32
mastery:                                # algorithm parameters (§8.3)
  initial: 0.5
  alpha: 0.5
  decay_rate: 0.05
  success_threshold: 0.5               # success if x > 0.5
```

Personal settings (API keys, AI provider, local AI preference) are **not** in the repository: they stay in the browser.

### 5.10 Common hierarchy

The wiki, the library and the discussions form **a single tree**. The wiki gives its structure; the other two spaces are placed in it:

- a **source** is filed in a category of the wiki (`category` field of the source, chosen by the user, proposed when the source is created from a category, or deduced from the knowledge extracted from it: the deepest category common to that knowledge, otherwise the one that holds most of it). Without a category, it is at the root;
- a **discussion** finds its place under the node it was started from (`about`), otherwise under its scope (`scope_node`), otherwise at the root. A discussion started from a flashcard is placed under its knowledge item.

The files do not move (the library stays a flat folder, the discussions a flat folder of files): the hierarchy is computed from identifiers, so renaming or moving a category does not touch its sources or discussions. Deleting a node moves up what was placed in it (its parent; for a deleted source, its category). In the interface, a category lists the sources filed in it; in the side tree, each branch shows discreetly how many sources and discussions it holds (two icons with a count), which open the Library or the Discussions filtered on that branch; the library and the discussions can be filtered by branch.

Every element of the hierarchy — category, knowledge item, source and the sections of its index, discussion — is searched together by Eugenia (§8.5). Quizzes are left out: their answers are the user's attempts, right or wrong.

## 6. Public / private visibility

### 6.1 Principle: two repositories

- **Private repository** (e.g. `user/eugenia-wiki`): contains everything; it is the only one edited.
- **Public repository** (e.g. `user/eugenia-wiki-public`): generated by a GitHub Action on every push to the private repository, it only contains the `visibility: public` nodes and the bibliographic records of private sources.

> **Why not a single repository with two branches?** On GitHub, read access applies to the whole repository, not to a branch: a private branch in a public repository would be readable by everyone. And exposing the public part of a private repository (through GitHub Pages) requires a paid account. Two repositories work with a free account.

### 6.2 Visibility rules
1. A new node is **private by default**.
2. A node without a `visibility` field inherits from its parent.
3. **A public node cannot have a private ancestor.** When the user makes public a node one of whose ancestors is private, the app **offers to make the whole branch public** up to the root, showing the ancestors concerned and asking for an explicit confirmation. If the user refuses, the node stays private.
4. Making a node public does **not** automatically make its descendants public: the app offers to include them (checkboxes). Flashcards, however, always follow their knowledge item.
5. Making a node private makes all its descendants private, after confirmation.
6. On publication, a link from a public node to a private node is rewritten as plain text.
7. The personal files of sources are never published; the other attached files follow the visibility of their node. Each library source has its own visibility; a private source is published as its **bibliographic record** only (title, kind, authors, date, URL), so that the knowledge that cites it keeps its citation and the links to it in the public part. The **index** of a public source (§8.6) is published with it; the index of a private source never is. The category of a source is only published if the category is public. Embeddings are never published.
8. Quizzes are not published in v1.
9. The publication CLI refuses any tree that breaks rule 3, for example if the repository was edited outside the app.

### 6.3 Leaks through summaries
A description generated from private children **must never** be published. The public repository only receives `_summary.public.md` (renamed `_summary.md`), generated from the public children only. The publication CLI checks this and fails on inconsistency.

### 6.4 Publication
GitHub Action in the private repository, triggered by every push:
1. `cli publish --target user/eugenia-wiki-public` builds the filtered tree (rules §6.2 and §6.3) and validates it.
2. It generates `.notes/index.json` (tree, titles, types, short descriptions, bibliographic records of private sources marked `visibility: private`) and `.notes/config.yml` (without personal settings).
3. It pushes the result to the public repository **rewriting its history** (a single commit per publication): no private history is exposed, and the commit message repeats nothing from the private repository.
4. Writing to the public repository uses a secret of the private repository: a *deploy key* or a fine-grained token limited to the public repository, created by `cli init`.

## 7. Authentication and access

The single instance `openeugenia.github.io/eugenia/` has no server secret and no account of its own: identity is GitHub's.

| Mode | Use |
|---|---|
| **Anonymous** | Reading the public repository over plain HTTP through `raw.githubusercontent.com` (`index.json`, then the Markdown files), without the GitHub API or rate limit. |
| **Owner — v1** | Fine-grained GitHub token (read/write limited to the private repository) entered in the settings, stored in the browser (IndexedDB). |
| **Owner — v2** | "Sign in with GitHub" through an openEugenia GitHub App + a token-exchange micro-service (e.g. Cloudflare Worker). |

**Owner detection**: for `?repo=owner/name`, the app loads the public part of the public repository `owner/name`. If its `.notes/config.yml` declares a `private_repo` and the signed-in user can access it, the app switches to the private repository through the GitHub API and shows the whole wiki, with a public/private badge on each node. The owner can also open their private repository directly (`?repo=owner/eugenia-wiki`).

## 8. Functional flows

### 8.1 Knowledge extraction ([§1](functional_doc/1_knowledge_extraction.qmd))

1. **Input**: a text. It can come from a library source, a discussion or a quick note, a pasted text, or an imported document (PDF converted by pdf.js; audio and video transcribed to text, in v2). A pasted or imported text becomes a **source** of the library, with the original file attached if the user wishes.
2. **Highlighting**: Eugenia highlights the candidate atomic knowledge in the text.
3. **Adjustment**: the user adds their own highlights, or splits and refines the ones Eugenia proposes.
4. **Proposal**: for each knowledge item kept, Eugenia rewrites a self-contained statement (reintroducing the context, e.g. "Lilith") and proposes a learning target, a **title**, and the **question** and **expected answer** of a first flashcard. The user chooses the **sources** the knowledge will cite (the originating source by default; none for a discussion, which makes them "need a source" until the user adds one).
5. **Categorization**: Eugenia then looks at the existing categories (path and description) and at **all the knowledge items of the document together**, and files them the way Wikipedia files its articles: an existing category when it names exactly the topic of an item; otherwise, **one or more new categories** that best group the items of the document sharing a topic, placed under the most specific existing category, possibly nested (at most two new levels). New categories are named like Wikipedia categories (short topic, plural noun for a set of things, proper name for a subject), never duplicate an existing sibling, and are only created if they end up holding knowledge. The user reviews these proposals: renames, re-parents, removes or adds categories, and changes the category of each knowledge item.
6. **Validation**: the user selects, edits and validates. The new categories are created, then the knowledge items in their categories, with their first flashcard, their sources and an `extracted_from` link to the originating source or discussion. Everything goes into a single commit.
7. **Additional flashcards**: from a knowledge item, Eugenia proposes new flashcards (other angles, without going beyond the statement), which the user reviews before adding them.

**Default categories**: when a new wiki is initialized (`cli init` or the web wizard), the app offers to create the top-level categories of the functional documentation: Arts and culture, Economy and finance, Geography, History, Languages and linguistics, Medicine and health, Military and defense, Nature and environment, Philosophy and thought, Religion and beliefs, Science, Society and social sciences, Sports and leisure, Technology, Transport. The user can add, rename or delete some, and Eugenia can suggest subcategories. There is no limit on depth or width.

### 8.2 Personal wiki ([§2](functional_doc/2_wiki.qmd))

- Navigation in the tree: each sub-wiki shows its **description** (§5.5), its children with their short descriptions, and a **mastery gauge**.
- Mastery of a category: average current mastery of the flashcards it contains (descendants included).
- Descriptions are kept up to date by Eugenia in the background, or reviewed by the user (§11.2).

### 8.3 Quiz and reinforcement ([§3](functional_doc/3_reinforcement.qmd))

**Flow**:
1. The user chooses a category (any node of the tree).
2. Eugenia sorts the flashcards of this branch by **increasing current mastery**.
3. For each flashcard: Eugenia asks the question, the user answers freely, then Eugenia compares the answer with the expected answer and returns **detailed feedback** (missing and superfluous elements) and a **score** $x \in [0, 1]$.
4. Mastery is updated after each answer (local, immediate computation).
5. The user can stop at any time or start a new quiz, which then follows the new order.
6. At the end of the session, the quiz is saved as a discussion (§5.6) and committed.

**State of a flashcard** (derived, never entered):

| Field | Initialization |
|---|---|
| `mastery` $m$ | 0.5 |
| `failure_date` $f$ | creation date of the flashcard |
| `decay` $\beta$ | $1 - \frac{0.05}{1 + 0} = 0.95$ |
| `last_eval` $e$ | creation date of the flashcard |

**Current mastery** on day $d$ (daily decay, in whole days):

$$m_{\text{current}}(d) = m \cdot \beta^{\,(d - e)}$$

**Update after an evaluation** with score $x$ on day $d$:
1. $m \gets m_{\text{current}}(d)$ (decay is applied first)
2. $m \gets \frac{m + x}{2}$ in every case (exponential moving average, $\alpha = \tfrac{1}{2}$): a failure (low score, down to $x = 0$) thus lowers mastery naturally
3. **If success** ($x > 0.5$):
   - $t \gets d - f$ (days since the last failure)
   - $\beta \gets 1 - \frac{0.05}{1 + t}$: the longer successes follow one another after the last failure, the slower forgetting gets
4. **Otherwise (failure, $x \leq 0.5$)**: $f \gets d$ and $\beta \gets 0.95$, i.e. decay restarts at its fastest pace
5. $e \gets d$

**Storage by replay**: `core` rebuilds the state of each flashcard by replaying in chronological order all the scores found in the quizzes (`discussions/`, `kind: quiz`) of the repository. Consequences:
- no mastery data is duplicated or out of sync;
- a change of the parameters (§5.9) applies retroactively to the whole history;
- the computed state is cached in IndexedDB and invalidated when a quiz changes (SHA).

**Review reminders** ([§5](functional_doc/5_discussion.qmd)): when the app opens, it reports the categories whose flashcards drop below a mastery threshold (e.g. "3 flashcards in *Philosophy and thought* may be forgotten"). Push notifications are planned for v2 (§14).

**Dashboard** ([§6](functional_doc/6_other_sn_tools.qmd)): number of knowledge items, review rate, mastery curve over time per category.

### 8.4 Discussions ([§5](functional_doc/5_discussion.qmd))

- The **Discussions** section gathers all the exchanges (discussions, questions, quizzes, quick notes), filterable by kind and text, with the page each one is attached to.
- From any page (category, knowledge item, flashcard, source), the user can open a discussion with Eugenia. It is saved in `discussions/` and also shown on the page's view.
- **Quick note**: the user notes an idea or a fact; Eugenia answers **right away** with the candidate atomic knowledge, what deserves checking, and leads to **external sources** (a library source if one fits). The note continues as a discussion and can be extracted (§8.1).
- Eugenia can: clarify or rephrase a notion, suggest links to existing nodes, summarize the exchange, and **offer to extract new knowledge** from the discussion (back to flow §8.1), inviting the user to back it with a source.
- **Answers based on the tree only**: before each answer, Eugenia searches the common hierarchy for the user's message (§8.5, without the answer step) and answers from the elements found and the page the discussion was started from, citing them. She adds no fact of her own; when the wiki does not hold the answer, she says so. The elements an answer is based on are recorded in its metadata (`based_on`) and shown under it. A quick note is compared with what the wiki says, not with Eugenia's own knowledge.
- A saved quiz can be read again in the Discussions section, without being continued.
- v1 discussions are **personal** and private by default (§6.2).

### 8.5 Questions about the tree

The user asks a question about a given scope (whole wiki or branch). The search covers **every element of the common hierarchy** of the scope (§5.10): categories, knowledge items, sources and the sections of their index, discussions. Two searches are combined:

1. **Exhaustive search** (owner, with search by meaning set up): the question's embedding is compared with those of every element (pages, discussions, sections of the source indexes); the closest elements of the scope are shown to Eugenia from the start, with their place in the tree, and the best ones are read right away.
2. **Tree search**: Eugenia receives the top-level descriptions of the scope, chooses the relevant branches and **goes down** the tree (descriptions → child descriptions → contents). A source goes down into its index: summary, sections, subsections — so a small model reads only the relevant parts of a long source, never its full text.
3. Her answer is **based only on what she read**: no knowledge of her own, every fact cited as a clickable link to its element (page, section of a source, discussion); if the tree does not hold the answer, she says so and points to what comes closest. The interface lists the elements the answer is based on.
4. The exchange can be saved as a discussion of kind `question` in `discussions/`, attached to the scope.

### 8.6 Indexing of sources

Each source of the library is transformed into an **index**: a tree of concepts that describes its whole content exhaustively — topics, subtopics, key ideas, arguments, examples, facts, decisions, conclusions, relationships — each node with a name and a **precise, self-contained description of what the source says at this node** (facts, figures, names, definitions, arguments, examples: up to about a hundred words when the source develops the part, never more than the source says), the root summing up the source. The plan of the source is followed when it gives one; duplicate concepts are merged. **The model only writes what the source says**: even if it recognizes the source (a famous book, a Wikipedia article), it adds nothing from its own knowledge — a two-line summary gives a root alone.

**Check against the source**: small models tend to complete a short source with what they remember of the document it describes. Whatever the model writes, the app keeps only what the source backs: a proposed knowledge item whose content words are mostly absent from the source (less than half of them) is dropped, as is a sentence of a description (less than 40 %) and a section left with neither. On a real 30 KB source, the check removes nothing; on a two-line note, it removes what was invented.

1. **Knowledge to extract**: each node also proposes the knowledge worth remembering (at most three per node): a title, a self-contained statement with its learning target in bold, and a first flashcard (question, answer). It is **proposed, never added to the wiki on its own**: the user adds it when they wish — one item, or all the items of the source or of a section, in one click, without review — or reviews it first in the extraction (§8.1), from the source page or from a section, skipping the highlighting. What is already in the wiki is shown as such and never added twice.
2. **Where it goes**: the knowledge of a source stays **in the category of the source or below it** — Eugenia files it in the existing subcategories of that branch, or creates new subcategories there; a source not filed yet is filed where its knowledge goes. The review shows only the categories of that branch.
3. **Models**: the user chooses, in the settings or for a batch, between presets of Mistral models (OpenAI-compatible API, `reasoning_effort` when the model supports it), measured on a 30 KB text: Mistral Large with reasoning (≈ 5 min, the most detailed descriptions: about 130 words per node), Mistral Small with reasoning (≈ 40 s, about 60 words), **Mistral Small without reasoning (≈ 25 s, about 50 words, the default)**, Ministral 14B (≈ 45 s, about 70 words) and Ministral 8B (≈ 35 s, about 60 words); or another model. Long answers are streamed: a model that thinks for minutes keeps the connection active. The index is generated once; it is then read at low cost by smaller models (§8.5).
4. **When**: automatically for a new source and when the text of a source changes (option in the settings), on demand from the source page, from **Eugenia's tasks** (§11.4) — the state of the index of every source, and the indexing of all the missing or stale ones with the chosen model — or in a batch (`eugenia index`, `--extract` to also add the proposed knowledge). Indexing runs **in the background** (two sources at a time): the user keeps browsing, the progress shows in the app bar, and each index is committed when it is ready (with the source, if the source is not saved yet). An index is **stale** when the text of its source changed (fingerprint `text_sha`).
5. **Long sources**: read in parts (about 60,000 characters each, three at the same time); each part gets its tree, then the model gathers the main topics of the parts into the top of the tree of the whole source. A part whose answer is cut off is split in two and read again.
6. **Storage and browsing**: like the wiki, one folder per node with an `index.md`, in the `_index/` folder of the source (format in `docs/format.md`). The index is browsed like the wiki: the source page shows its summary, its sections as cards and its knowledge to extract; each section is a page (breadcrumb through the wiki, the source and the enclosing sections, subsections, previous and next sections); in the side panel, the open source unfolds its index as a tree. Its sections get embeddings (`_index/_embeddings.json`) for the exhaustive search; the page of every indexed element (page or section) gives access to its **embedding vector** (1,024 values with `mistral-embed`, its model and whether it is up to date), to copy or download — for the owner only, since embeddings are never published.
7. **Privacy**: a private source follows the "local AI for private content" rule (§11.1); the index of a public source is published with it, never the index of a private one.

## 9. Web interface

### 9.1 Entry point
- `https://openeugenia.github.io/eugenia/?repo=owner/name`: opens any compatible wiki.
- Without a parameter: home page (presentation of Eugenia, repository input, recently viewed wikis, creation of a new wiki).

### 9.2 Views
1. **Side panel** with three tabs, which follow the open page: **Wiki** (collapsible tree of categories and knowledge, each branch with two discreet counters of its sources and discussions (common hierarchy, §5.10) that open the filtered Library or Discussions, icon per type, public/private badge, mastery gauge, "stale description" and "needs a source" badges, "changed offline" indicator), **Library** (sources by title; the open source unfolds its index as a tree), **Discussions** (recent exchanges); both follow the branch filter of the main view.
2. **Category**: description at the top, introduction, subcategories and knowledge items with their short descriptions, the sources filed in it, backlinks, related discussions.
3. **Knowledge item**: statement (target in bold), sources (with location), flashcards and their mastery, origin (source or discussion); **flashcard**: question, expected answer, tested knowledge, mastery curve.
3a. **Library**: list of sources filterable by category, kind, tag and text, sorting, knowledge that needs a source; **source**: the category it is filed in (changeable), bibliographic record, personal file, content, its index (state, generation in the background, summary, sections as cards, knowledge to extract), knowledge that cites it; **section** of an index: a page of its own, browsed like a category (§8.6); **Eugenia's tasks**: the tasks in progress, the descriptions to re-evaluate, the state of the index of every source and their indexing in the background with a chosen model (§11.4). Every indexed page and section gives access to its embedding vector. In the public part, a private source shows its bibliographic record only, with a "Record only" badge.
3b. **Discussions**: list of all the exchanges, filterable by kind and by branch of the wiki, direct access to the quick note, the question, the quiz.
4. **Extraction**: source text with highlights, panel of proposed knowledge and of the new categories proposed for the document (§8.1).
5. **Quiz**: conversation with Eugenia, score and feedback after each answer, session progress.
6. **Discussion**: chronological messages, Eugenia's answer streamed; quick note; quiz read-only.
7. **Graph**: visualization of the tree (zoom, focus on a branch).
8. **Dashboard**: indicators and progress curves.
9. **Search**: full text (client-side index) with filters by type, tag, visibility and mastery; for the owner, search by meaning across the pages, the discussions and the sections of the source indexes.
10. **Editor**: Markdown, metadata as a form (the raw frontmatter is never shown).
11. **Settings**: GitHub token, AI provider, API key, model, local AI for private content, offline data.

### 9.3 Editing operations
- Create a child or sibling node, change its type.
- Rename (the folder is renamed, §5.2) or move by drag and drop: the `id` is kept and incoming links are rewritten.
- Delete, with confirmation (recursive deletion is explicit).
- Change the visibility, with the proposals described in §6.2.
- **Saving**: changes are grouped locally then committed in a single commit (generated, editable message).

## 10. Git synchronization and offline mode

### 10.1 Reading
- Owner: complete tree of the private repository fetched through the Git Trees API (`recursive=1`); one call gives all the paths and SHAs.
- Anonymous: `index.json`, then Markdown files loaded from `raw.githubusercontent.com`.
- Contents loaded on demand and cached by SHA (immutable, so a permanent cache).

### 10.2 Writing
- Multi-file commit through the Git Data API (blobs → tree → commit → ref update).
- Always to the private repository (default branch); the public repository is only written by the CI.

### 10.3 Offline mode (PWA)
- The service worker caches the app: it opens without a network.
- A **local copy** of the viewed wikis (tree + contents) is kept in IndexedDB.
- Offline, one can read, edit, create and move. Quizzes remain possible if a local AI provider is reachable; otherwise, a **self-assessment mode** lets the user reveal the answer and grade their own answer (0 / 0.5 / 1).
- Changes are placed in a **queue of pending changes**, visible in the interface.
- When the network is back:
  1. the remote state is fetched;
  2. if no locally changed file changed remotely → direct commit;
  3. otherwise → node-by-node conflict resolution (local version, remote version, or side-by-side manual merge). No silent automatic resolution.
- Quizzes being separate timestamped files, they never conflict between devices.

## 11. Artificial intelligence (Eugenia)

### 11.1 Providers
Common `AIProvider` interface (`complete`, `stream`, `countTokens`, and `embed` for semantic search, with OpenAI-compatible providers: Mistral `mistral-embed` by default) with adapters:
- **Anthropic (Claude)**: direct call from the browser with the user's key.
- **Ollama / local server**: requires allowing the `openeugenia.github.io` origin in CORS.
- **OpenAI-compatible**: any other provider.

**Indexing of sources** (§8.6): a separate provider, a preset of Mistral models (Mistral Small without reasoning by default), with the Mistral key of the semantic search unless another one is given. The reasoning of a model that supports it is set by `reasoning_effort` (`none` for Mistral Small 4; Mistral Large 4 always reasons). Reasoning models answer with chunks of reasoning and text: only the text is kept; an answer cut off by the length limit is reported at once.

**Local AI for private content**: on first setup (then in the settings), the app **asks the user** whether they want to keep private nodes for a local AI.
- If so: any task involving a private node (description, extraction, categorization, quiz, discussion, question about the tree) must go through the local provider. Otherwise, the action is blocked with an explanation.
- If not: a warning is shown the first time private content is sent to a remote provider.

API keys are never committed; they are only stored in the browser.

### 11.2 Sub-wiki descriptions
1. **Detection**: `core` compares the `sources` of each summary with the current SHAs of the children. A difference → the description is **stale**, which propagates to the ancestors.
2. **Reporting**: badge in the tree and global counter "N stale descriptions".
3. **Re-evaluation in the background**: once the user's changes are saved, Eugenia's tasks (§11.4) regenerate the stale or missing descriptions (both scopes), one at a time from the deepest node to the root — a parent is described from the new descriptions of its children — and commit each one right away, **without asking node by node** (option in the settings, on by default). They can also be started from Eugenia's tasks. A locked description is never regenerated; a failed one is not retried automatically.
4. **Review** (on demand): in the "Descriptions" view, each regenerated description is shown as a diff before entering the commit; it can be edited then locked (`locked`).
5. **Batch**: `cli summarize --stale`, locally or in CI.

### 11.3 Prompts
Eugenia's prompts are versioned in the app's repository, written in English, and can be overridden in the wiki (`.notes/prompts/`); Eugenia answers in the language of the content or of the user:
- `extract.md`: highlighting and proposal of atomic knowledge;
- `categorize.md`: categories of all the knowledge of a document, Wikipedia-style (§8.1);
- `categories.md`: subcategory suggestions for a category;
- `flashcards.md`: new flashcards on a knowledge item;
- `summarize.md`: description of a sub-wiki (variant for discussions: decisions + open questions);
- `evaluate.md`: comparison of the answer with the expected answer, with feedback and a score in [0, 1] as **structured output** (validated JSON);
- `discuss.md`: Eugenia's role in a discussion, answering from the knowledge found in the wiki only;
- `note.md`: answer to a quick note, compared with what the wiki says;
- `ask.md`: questions about the tree (exploration of the common hierarchy, answer from what was read only);
- `index-source.md`: index of a source as a knowledge tree, and gathering of the parts of a long source.

### 11.4 Eugenia's tasks
What Eugenia does in the background is queued and run while the user keeps browsing: the **indexing of sources** (two at a time, each reading its parts in parallel) and the **re-evaluation of descriptions** (one at a time, deepest first). Each result is committed as soon as it is done; the saving of results is serialized so that concurrent tasks never overwrite each other's pending changes. The app bar shows the progress; the **"Eugenia's tasks"** view lists the tasks in progress (with their stop button), the descriptions to re-evaluate and the state of the index of every source, from which a batch is started with a chosen model.

## 12. Security and privacy
- Data held by the user in their own repositories, without a central server.
- Nodes private by default; blocking CI validation before publication (§6).
- The source repository must be private: the app refuses to write to it if it is public.
- No private content in the public repository: neither in its history, nor in the descriptions, nor through the personal files of sources. Of a private source, only the bibliographic record (an allow-list of fields) is published: the user must not put in it anything they want to keep private.
- Tokens and keys stored locally, never sent anywhere other than their own service.
- Offline copy erasable from the settings ("forget this wiki on this device").
- Strict CSP; sanitized Markdown rendering (no arbitrary HTML/JS executed).
- Shared instance: no user's data is accessible to another beyond what GitHub allows.

## 13. Project hosting and repositories
- Source code: public repository **`openEugenia/eugenia`**, under the **MIT** license (for now).
- App: deployed to **`https://openeugenia.github.io/eugenia/`** by a GitHub Action on every version tag.
- Publication GitHub Action (§6.4): published on the Marketplace by openEugenia, to be used in users' private repositories.
- The functional documentation (`functional_doc/`) stays in the repository and may be published with Quarto.

## 14. Planned evolutions (beyond v1)

The git format remains the basis of these evolutions: a public wiki is already open, indexable data.
- **Social network** ([§4](functional_doc/4_toward_social_network.qmd)): (opt-in) registry of public wikis, embedding vectors per wiki, semantic similarity between users, connection suggestions.
- **Automatic scope according to mastery**: offer to make private a public knowledge item whose mastery drops below a threshold, then to republish it when it rises again.
- **Adding other people's knowledge**: copy a public flashcard from another wiki into one's own (with its original source).
- **Public discussions** with several participants (e.g. through GitHub Discussions or issues of the public repository).
- **News feed, capsules, gamification** (badges, trophies) ([§6](functional_doc/6_other_sn_tools.qmd)).
- **Notifications**, push and e-mail.
- **Audio/video transcription** for extraction.
- **Hidden private sources**: an option to leave a private source out of the public part entirely, record included.

## 15. Roadmap

| Milestone | Content |
|---|---|
| **M0 — Foundations** | Monorepo, `core` (parsing, tree, naming, links, visibility), documented format, tests. |
| **M1 — Public reader** | React app, anonymous reading of a public wiki, tree, rendering, search, deployment on openEugenia. |
| **M2 — Owner** | Fine-grained token, private repository, editing, renaming, moving, commit, `cli init` with default categories. |
| **M3 — Publication** | CLI + GitHub Action private repository → public repository, validations, `index.json`. |
| **M4 — Offline** | PWA, IndexedDB copy, change queue, conflict resolution. |
| **M5 — Eugenia: descriptions** | Provider abstraction, local AI choice for private content, stale descriptions, regeneration and review. |
| **M6 — Extraction** | Flow §8.1 from a note or a pasted text, PDF import, document-level categorization. |
| **M7 — Quiz** | Conversational quiz, evaluation by Eugenia, mastery algorithm by replay, gauges, reminders, offline self-assessment. |
| **M8 — Discussions & questions** | Discussions from a node, extraction from a discussion, questions about the tree. |
| **M9 — Comfort** | Graph view, dashboard, GitHub App sign-in, audio/video transcription. |

## 16. Open questions
None for now. Recent decisions:
- two repositories (private + public) to stay compatible with a free GitHub account;
- default categories of the functional documentation kept as they are;
- the whole project (interface, prompts, documentation, demo wiki) is in English, for an English-speaking audience; Eugenia answers in the language of the content or of the user;
- the bibliographic record of a private source (title, kind, authors, date, URL) is public, so that public knowledge can cite it;
- the knowledge extracted from a document is categorized together, Wikipedia-style, possibly in new categories reviewed by the user;
- the common hierarchy of the wiki, the library and the discussions is computed from identifiers (`category` of a source, `about` of a discussion), without moving files: the library and the discussions stay flat folders, and moving a category touches nothing else;
- the knowledge proposed by an index is never added to the wiki on its own: the user adds it (one item or all, without review, or reviewed), and it stays in the category of its source or below it;
- what an index model writes is checked against the source: unbacked knowledge, sentences and sections are dropped;
- stale descriptions are re-evaluated in the background, deepest first, without asking node by node;
- the index of a source is a knowledge tree stored like the wiki (one Markdown page per node, in the `_index/` folder of the source), with the knowledge worth extracting, generated by a Mistral model chosen by the user (Mistral Small without reasoning by default: about nine times faster than Mistral Large, with as much knowledge proposed); it is read by tree search and by exhaustive search (embeddings of its sections);
- Eugenia's answers (questions, discussions, quick notes) are based on the elements of the tree only, cited, with no knowledge of her own.
