# Storage format of an Eugenia wiki

An Eugenia wiki is an ordinary git repository: folders and Markdown files with a YAML
frontmatter. The app never shows these files, but they stay readable and editable by hand.
`eugenia validate` checks a repository edited outside the app.

This document describes version 2 of the format (specification §5): three spaces (wiki,
library, discussions), atomic knowledge and separate flashcards, with the common hierarchy of
the three spaces and the indexes of sources (optional additions: a wiki without them stays
valid). A format-1 wiki (everything under `wiki/`, discussions in `_discussions/` and
`_quizzes/` folders) is not migrated automatically; `validate` reports its old-format files.

## Tree

A wiki has three spaces, each in its own folder (configurable, §Configuration):

```
.notes/
  config.yml                 wiki configuration
  prompts/<name>.md          optional overrides of Eugenia's prompts
wiki/                        the wiki: categories, atomic knowledge, flashcards
  index.md                   the root page: the global wiki
  _summary.md                description of the global wiki (private scope)
  _summary.public.md         description of the global wiki (public scope)
  _embedding.json            embedding of the page (semantic search, never published)
  religion-and-beliefs/
    index.md                 a category
    _summary.md
    lilith/
      index.md               an atomic knowledge item
      what-is-the-name-of-the-female/
        index.md             a flashcard on this knowledge item
library/                     the library: the sources, flat
  article-on-lilith/
    index.md                 a source (filed in a category of the wiki)
    article.pdf              its personal file (never published)
    _index/                  its index: a knowledge tree of its content, one page per node
      index.md               root of the index: summary of the source
      origins/index.md       a section (and its subsections, in subfolders)
      _embeddings.json       embeddings of the sections (never published)
discussions/                 discussions, questions, quizzes and quick notes
  2026-11-10-1030-quiz-religion-and-beliefs.md
  2026-11-14-0830-51-pegasi-b.md
  _embeddings/               embeddings of the discussions (never published)
    2026-11-14-0830-51-pegasi-b.json
```

- **Every page is a folder containing an `index.md`**, whether it has children or not.
  Subpages are subfolders.
- **Wiki**: a category contains subcategories and knowledge items; a knowledge item only contains
  flashcards; a flashcard has no subpage. `validate` reports misplaced pages.
- **Library**: a flat list of sources, directly under `library/`. The folder itself does not
  need an `index.md`. Each source is **filed** in a category of the wiki by its `category` field
  (§Common hierarchy): the files do not move.
- **Discussions**: one Markdown file per discussion, directly under `discussions/`.
- Names starting with `_` or `.` are reserved for the app and are not pages.
- A folder without `index.md` that contains pages is shown as a category (reported by
  `validate`).
- The other files of a folder are **attached files** of its page.
- Order of children: `order` field, then title (alphabetical order).
- No maximum depth or width in the wiki.

### Folder names

Derived from the title: lowercase, without accents, non-alphanumeric characters replaced with
`-`, truncated to 32 characters (`folder_name_max_length`) without cutting a word when possible,
`-2`, `-3`… suffix on collision. When the title changes, the app renames the folder and rewrites
the incoming links (in all three spaces) in the same commit; the `id` never changes.

## Pages (`index.md`)

```yaml
---
id: 01M6DP0H707WPFZNQATGBZG5SB   # ULID, stable
type: knowledge                  # category | knowledge | flashcard | source
title: Lilith
visibility: public               # public | private; inherited from the parent if absent
created: 2026-11-02T08:29:00Z
updated: 2026-11-02T08:29:00Z
tags: [mythology]
order: 10                        # optional
---
```

Without `type`, a wiki page is a category and a library page is a source (`note`, the old type,
is read the same way). An unknown `type` is reported. Unknown keys are kept.

### Categories

The body is a free introduction text (CommonMark and GFM), optional. A category with children is
a **sub-wiki**, described by Eugenia (§Descriptions).

When knowledge is extracted from a document, Eugenia looks at the existing categories and at
all the items of the document together, and proposes the categories that group them best, as
Wikipedia would: existing categories when they fit exactly, otherwise new categories (possibly
nested) under the most specific existing one. The user reviews them before the single commit
that creates the categories and the knowledge.

### Atomic knowledge

```yaml
type: knowledge
extracted_from: 01M6BK4140P9T3R69AH4Y8K1PA   # originating source or discussion (optional)
sources:
  - ref: 01M6BK4140P9T3R69AH4Y8K1PA        # a library source
    locator: p. 12                         # optional: page, chapter, timestamp…
  - description: Lecture at the Royal Institution   # free reference, outside the library
    url: https://example.org
```

```markdown
**Lilith** is a female demon of Jewish tradition, inspired by a deity of Mesopotamian origin.

## Notes
See also [the Black Moon](../../science/astronomy/black-moon/index.md).
```

The body starts with the **statement**: a simple, precise text, understandable without context.
The **bold** part is the learning target. Free sections (`## Notes`…) may follow. The category of
a knowledge item is its position in the tree. A knowledge item without any source is marked
**"needs a source"**.

### Flashcards

A flashcard is a subpage of a knowledge item, which it tests. A knowledge item can have several.

```markdown
---
id: 01M6BC89W0J04TZ0V9ZXT186H6
type: flashcard
title: What is the name of the female demon of Jewish tradition, inspired by a deity…
created: 2026-11-02T08:30:00Z
updated: 2026-11-02T08:30:00Z
---

## Question
What is the name of the female demon of Jewish tradition, inspired by a deity of Mesopotamian origin?

## Expected answer
Lilith
```

The title is taken from the question. A flashcard does not write a `visibility`: it follows its
knowledge item's. Unknown sections are kept. The headings of wikis written in French
(`## Réponse attendue`, `## Connaissance`) are also read. Mastery is not stored: it is
recomputed, flashcard by flashcard, from the quizzes.

### Sources

```yaml
---
id: 01M6BK4140P9T3R69AH4Y8K1PA
type: source
kind: article          # book | article | web | video | audio | document | other
title: Article on Lilith
authors: [Jane Doe]
published: "2019"      # date or year, free text
url: https://example.org/lilith
file: article.pdf      # attached personal file, never published
category: 01M6B8TE80FWZWZ9A13320JP2Z   # wiki category it is filed in (optional)
visibility: private
---
```

The body (excerpts, summary, reading notes, or the text of an imported PDF) is the text Eugenia
indexes and extracts knowledge from. The page of a source lists the knowledge items that cite it
(`sources[].ref`) or were extracted from it (`extracted_from`), and shows its index.

`category` is the identifier of the wiki category the source deals with. Without it, or if it
does not name a category (reported by `validate`), the source is at the root of the wiki.

A private source is published as its **bibliographic record** only: `id`, `type`, `kind`,
`title`, `authors`, `published`, `url` and `visibility: private`, without body, personal file,
tags or other keys (§Generated public repository).

## Common hierarchy

The three spaces form a single tree, the **common hierarchy**: the wiki gives the structure, and
the library and the discussions are placed in it, by identifier.

- A **source** is filed in the category named by its `category` field (the root by default).
- A **discussion** is placed under the page it was started from (`about`), otherwise under its
  scope (`scope_node`), otherwise at the root. A discussion started from a flashcard is placed
  under its knowledge item.

The files never move: renaming or moving a category does not touch its sources or discussions.
Deleting a page moves up what was placed in it: its sources are filed in its parent category,
its discussions are attached to its parent (or, for a source, to its category).

Eugenia searches every element of the hierarchy together (categories, knowledge items, sources
and the sections of their index, discussions); quizzes are left out, since they hold the user's
attempts, right or wrong.

## Index of a source

The `_index/` folder of a source holds its **index**: a knowledge tree that describes the whole
content of the source, generated once by a model, then read at low cost to answer questions. It
is stored like the wiki: **one folder per node, each with an `index.md`**, subsections in
subfolders. The root (`_index/index.md`) sums up the source; the other nodes are its
**sections**. Each node can also propose **knowledge to extract**, ready for the extraction.

```markdown
---
type: source-index
title: Black Moon Lilith
model: mistral-small-latest
text_sha: 4c1d2e9
generated: 2026-11-23T16:40:12Z
---

An article about the astrological concept of the Black Moon, defined as the apogee of the Moon's
orbit around the Earth…

## Knowledge to extract

### Black Moon as the apogee of the Moon's orbit
The **Black Moon** is a point in the Moon's orbit around the Earth: its apogee.

- Question: What is the Black Moon in astronomical terms?
- Answer: The apogee of the Moon's orbit around the Earth.
```

A section, `_index/mean-and-true-black-moon/index.md`:

```markdown
---
type: section
title: Mean and true Black Moon
order: 2
---

Astrologers compute the Black Moon in two ways: the mean Black Moon (averaged orbit) and the
true Black Moon (actual orbit).
```

- The body of a node is its self-contained **description**, then an optional `## Knowledge to
  extract` section: one `###` heading per knowledge item (its title), its statement (the learning
  target in bold), then its first flashcard (`- Question:` and `- Answer:`).
- The children of a node are ordered by `order`. A section is addressed by its folder path
  (`mean-and-true-black-moon`, `origins/lilitu`); in the hierarchy, its identifier is
  `<source id>#<path>`. Folder names follow the rule of the wiki (§Folder names).
- Text sent to the model: `# <title>`, the authors and the publication date, then the body in
  Markdown (its headings show the plan of the source, which the tree follows); the URL is left
  out, so that the model reads the text instead of recalling the page. `text_sha`: SHA (git
  blob, 7 characters) of this text; the index is **stale** when it differs. The model only writes
  what the source says. A long source is read in parts, whose main topics are then gathered.
- Generated by the app (automatically for a new or changed source, on its page, or in the
  background from the "Indexes" view) or by `eugenia index`, with a Mistral model of your choice
  (Mistral Small without reasoning by default; Mistral Large, Mistral Small with reasoning,
  Ministral 14B and 8B). A new index replaces the previous one: its pages that no longer exist
  are deleted.
- The pages of an index are not pages of the library: they are read on demand (the source page,
  a question), not when the wiki is opened. They can be edited by hand, like any file.
- The index of a public source is published with it; the index of a private source never is.

## Sub-wiki descriptions

`_summary.md` (private scope: all children) and `_summary.public.md` (public scope: public
children only), in the folder of the described page:

```yaml
---
id: 01M6CWACM0CXSNMC6T29E31548
type: summary
scope: public
model: claude-opus-5-5
generated: 2026-11-15T09:00:00Z
locked: false        # true: no longer offer regeneration
sources:             # fingerprint of the sources at generation time
  01M6B5CJM0EDQQYQ3XR5ZN1ACK: f05eda9    # the page itself: SHA of its index.md
  01M6B8TE80FWZWZ9A13320JP2Z: 14afef8    # a child: SHA of its description or of its index.md
---
Text of the description…
```

- The fingerprint of a child is the SHA (git blob, 7 characters) of its description of the same
  scope if it has children itself and a description, otherwise of its `index.md`.
- A description is **stale** when the set of sources or one of their SHAs differs; staleness
  goes up to the ancestors, except through a locked description.
- Regeneration goes from the deepest nodes to the root.

## Embeddings (semantic search)

`_embedding.json`, in the folder of the page, sums up the meaning of its `index.md` as a vector,
for the app's search "by meaning" and for Eugenia's search across the hierarchy. It is computed
by the app or by `eugenia embed` (Mistral `mistral-embed` by default, or any OpenAI-compatible
provider). Discussions and the sections of the source indexes have embeddings too (below).

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

- Indexed pages: categories, knowledge items and sources. Flashcards are not: they repeat their
  knowledge item.
- Text sent to the model: title, authors (sources), tags, then content as plain text. Neither
  frontmatter nor link URLs: moving a page or changing its visibility does not make its
  embedding stale.
- `text_sha`: SHA (git blob, 7 characters) of this text. The embedding is **stale** when this SHA
  or the model differs; an embedding from another model is never compared with the query.
- `vector`: components quantized to signed 8 bits (base64), to multiply by `scale`.
- The file follows the page when it is renamed or moved, and disappears with it. It is **never
  published**, not even for a public page: it is computed on the content of the private
  repository.
- **Discussions** (except quizzes): `discussions/_embeddings/<name of the discussion>.json`, same
  format; text: the title, then each message as plain text, with its author.
- **Sections of a source index**: `_index/_embeddings.json`, one vector per section (by its
  path); text: where the section is (`Article on Lilith › Origins › Lilitu`), its description and
  the statements of its knowledge to extract. A section whose text changed is recomputed alone.

```json
{
  "format": "eugenia-embeddings",
  "version": 1,
  "model": "mistral-embed",
  "generated": "2026-11-23T16:02:10Z",
  "dimensions": 1024,
  "encoding": "int8",
  "items": [{ "key": "origins/lilitu", "text_sha": "9b2e1c4", "scale": 0.00081, "vector": "…" }]
}
```

## Discussions

One file per discussion in `discussions/`, named `<date>-<time>-<title>.md` (UTC). One section
per message (`## <role> · <timestamp>`), roles `user` and `eugenia`. The metadata of a message is
carried by an invisible HTML comment.

```markdown
---
id: 01M6CJ0SR0BVVET7CEJVMHZCXF
type: discussion
kind: quiz                         # discussion (default) | question | quiz | note
title: Quiz — Religion and beliefs
scope_node: 01M6B8TE80FWZWZ9A13320JP2Z   # scope: quizzed category, branch of a question
about: 01M6DP0H707WPFZNQATGBZG5SB        # page the discussion was opened from (optional)
visibility: private
---

## eugenia · 2026-11-10T10:30:00Z
<!-- eugenia: {"card": "01M6BC89W0J04TZ0V9ZXT186H6", "role": "question"} -->
What is the name of the female demon…?

## user · 2026-11-10T10:30:20Z
I think it is Lilita the Pita

## eugenia · 2026-11-10T10:30:24Z
<!-- eugenia: {"card": "01M6BC89W0J04TZ0V9ZXT186H6", "role": "feedback", "score": 0.3} -->
The answer is incorrect: Lilith was expected.
```

| `kind` | Use |
|---|---|
| `discussion` (or absent) | Free discussion with Eugenia, from a page (`about`) or not. |
| `question` | Saved question about the tree, with its scope (`scope_node`). |
| `quiz` | Review session: the trace mastery is recomputed from. |
| `note` | Quick note: Eugenia answers it with candidate knowledge and source leads. |

- A discussion is attached to the `about` and `scope_node` pages: it appears on their page, and
  is placed under the first of them in the common hierarchy.
- An answer of Eugenia based on elements of the wiki lists them in its metadata:
  `<!-- eugenia: {"based_on": ["01M6DP0H707WPFZNQATGBZG5SB", "01M6G9KPP03D31H8CGR4EZWQ50#mean-and-true-black-moon"]} -->`.
- A feedback message (`role: feedback`) of a quiz carries the **score** in [0, 1] of the
  flashcard `card` (`"self": true` for a self-assessment). Only quizzes count for mastery.
- A knowledge item extracted from a discussion refers to it by its `id` in `extracted_from`.
- A discussion is private by default; a quiz is never published.

### Mastery

Mastery is computed per flashcard; the mastery of a knowledge item or a category is the average
of its flashcards. For each flashcard, starting from its creation date (day `e` = `f`, m = 0.5,
β = 0.95), the quiz scores x are replayed in chronological order, on day d:

1. m ← m · β^(d − e) (decay);
2. m ← (1 − α) · m + α · x (α = 0.5);
3. if x > 0.5: β ← 1 − 0.05 / (1 + d − f); otherwise f ← d and β ← 0.95;
4. e ← d.

The current mastery is m · β^(today − e). The parameters are in the configuration; changing them
applies retroactively.

## Links

**Relative** Markdown links to the `index.md` of the target page:
`[Lilith](../lilith/index.md)`, including from one space to another (`../wiki/…` from a
discussion). The app rewrites them when a page is renamed, moved or deleted (the link then
becomes text). Deleting a source turns its citations into free references (its title). On
publication, a link to something that is not published becomes text.

## Configuration (`.notes/config.yml`)

```yaml
title: My wiki
root: wiki/                         # the wiki
library: library/                   # the source library
discussions: discussions/           # the discussions
private_repo: alice/eugenia-wiki    # copied to the public repository (owner detection)
default_visibility: private
folder_name_max_length: 32
mastery:
  initial: 0.5
  alpha: 0.5
  decay_rate: 0.05
  success_threshold: 0.5            # success if score > 0.5
  reminder_threshold: 0.4           # review reminder below this threshold
```

Personal settings (token, API keys, AI provider) are never in the repository.

## Visibility

1. A new page is private.
2. Without `visibility`, a page inherits from its parent (the root: `default_visibility`).
3. A public page cannot have a private ancestor (`validate` and the publication refuse it).
4. Making a page public does not make its descendants public (the app offers to include them).
5. Making a page private makes all its descendants private.
6. Each library source has its own visibility (private by default). A private source is published
   as its bibliographic record only (title, kind, authors, date, URL), so that public knowledge
   can still cite it; its content, personal file, index and tags stay private. The category of a
   source is only published if the category is public.

## Generated public repository

The public repository, written by the publication only, contains the public pages of the wiki
and the library (without personal files of sources, nor links or references to anything
unpublished), the indexes of public sources (`_index/`), the bibliographic records of private
sources, their attached files (public pages
only), the public descriptions renamed `_summary.md`, the discussions marked public (never
quizzes), a reduced configuration, a `README.md` and `.notes/index.json`:

```json
{
  "format": "eugenia-index",
  "version": 4,
  "generated": "2026-11-17T16:28:24.202Z",
  "title": "Demo wiki",
  "root": "wiki",
  "library": "library",
  "discussions": "discussions",
  "rootId": "01M6B5CJM0EDQQYQ3XR5ZN1ACK",
  "files": [{ "path": "wiki/index.md", "sha": "a2d07f6…", "size": 540 }],
  "nodes": [
    { "id": "01M6B5CJM0EDQQYQ3XR5ZN1ACK", "path": "wiki", "type": "category", "title": "Demo wiki",
      "visibility": "public", "parent": null, "description": "This is my wiki: I gather…" },
    { "id": "01M6DKS4209DK53G50GBPV3WD6", "path": "library/wikipedia-lilith", "type": "source",
      "kind": "web", "url": "https://en.wikipedia.org/wiki/Lilith", "parent": "virtual:library",
      "category": "01M6B8TE80FWZWZ9A13320JP2Z", "…": "…" },
    { "id": "01M6BK4140P9T3R69AH4Y8K1PA", "path": "library/article-on-lilith", "type": "source",
      "title": "Article on Lilith", "visibility": "private", "kind": "article",
      "authors": ["Jane Doe"], "url": "https://example.org/lilith", "published": "2019",
      "parent": "virtual:library" }
  ],
  "discussionList": []
}
```

Version 3 of the index adds the bibliographic records of private sources (`"visibility":
"private"`, without description, tags or dates). Version 4 adds the published category of the
sources (`category`). The app reads this file without the GitHub API
(raw.githubusercontent.com), then the files on demand, cached by SHA.
