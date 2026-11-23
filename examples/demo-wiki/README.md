# Demo wiki

Example of the **private** repository of an [Eugenia](https://github.com/openEugenia/eugenia)
wiki, used by the documentation and the tests. It takes up the examples of the functional
documentation (Lilith, the Black Moon) and shows the three spaces of a wiki:

- **the wiki** (`wiki/`): categories, atomic knowledge items (`type: knowledge`) that cite their
  sources, and the flashcards (`type: flashcard`) that test them, including a knowledge item with
  two flashcards and a knowledge item that "needs a source";
- **the library** (`library/`): sources (`type: source`), public or private, including an article
  with its personal file (never published; as a private source, only its bibliographic record is
  published);
- **the discussions** (`discussions/`): a free discussion, a question about the tree, a quick note
  a knowledge item was extracted from, and a quiz, the review trace mastery is recomputed from;
- public and private pages (`visibility`), and the sub-wiki descriptions, in private
  (`_summary.md`) and public (`_summary.public.md`) scope.

Validate it and build its public part:

```sh
pnpm eugenia validate examples/demo-wiki
pnpm eugenia publish examples/demo-wiki --out /tmp/demo-public
```
