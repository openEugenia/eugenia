# Eugenia's prompts

These files define Eugenia's role for each task. They are **versioned** here so that anyone
can check what the AI is asked, and they can be **overridden** in a wiki: a
`.notes/prompts/<name>.md` file in the user's repository replaces the prompt of the same name.

| File | Task |
|---|---|
| `extract.md` | Highlighting atomic knowledge in a text, then proposing a knowledge item and its first flashcard (§8.1). |
| `categorize.md` | Filing the knowledge extracted from one document in the category tree, creating the categories that group it best, as Wikipedia would (§8.1). |
| `flashcards.md` | New flashcards on an existing atomic knowledge item (§8.1). |
| `summarize.md` | Description of a sub-wiki, or summary of a discussion (§11.2). |
| `evaluate.md` | Comparing a quiz answer with the expected answer: feedback and score in [0, 1] (§8.3). |
| `discuss.md` | Eugenia's role in a discussion opened from a page (§8.4). |
| `note.md` | Answer to a quick note: candidate knowledge, points to check, source leads (§8.4). |
| `ask.md` | Questions about the tree: exploring the descriptions, then answering with citations (§8.5). |
| `categories.md` | Suggesting subcategories for a category (§8.1). |

An optional YAML frontmatter is ignored. Available variables: `{{wiki_title}}`, `{{today}}`.

The answer format (JSON schema) and the data sent (the `<...>` tags of the message) are defined
in `src/tasks/`. The prompts are written in English; Eugenia answers in the language of the
content or of the user. After changing a prompt, regenerate the embedded module:

```sh
pnpm --filter @openeugenia/ai prompts
```
