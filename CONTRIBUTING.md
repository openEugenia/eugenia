# Contributing to Eugenia

## Setup

```sh
pnpm install
pnpm --filter @openeugenia/web exec playwright install chromium   # for the end-to-end tests
```

## Conventions

- **Strict TypeScript** everywhere (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`), relative
  imports with the `.ts` extension.
- **`core` depends on neither the browser nor Node**: POSIX paths, WebCrypto, no I/O. File access
  goes through a reader (`readText`) provided by the caller.
- **Interface, messages, comments and documentation in English.** User-facing texts explain the
  rule being applied (visibility, conflict, local AI…). Eugenia answers in the language of the
  content or of the user.
- **Written files stay readable by hand**: stable key order, no empty value, Markdown content
  preserved (links are rewritten without reformatting the rest).
- **No private content must ever reach the public repository**: any change to publication comes
  with a test in `packages/core/test/publish.test.ts`. Private sources only publish their
  bibliographic record (an allow-list of fields).
- Formatting: `pnpm format` (Prettier).

## Tests

| Command | Scope |
|---|---|
| `pnpm test` | Vitest: `core`, `ai` (simulated providers), `cli` (temporary git repositories), `web` (synchronization logic). |
| `pnpm test:e2e` | Playwright on the built app; GitHub (REST, GraphQL, raw, commits) and the Claude API are simulated in memory (`packages/web/e2e/fakes.ts`). |
| `pnpm test:live` | Vitest against real AI APIs (`packages/ai/test/live/`): OpenAI-compatible provider and quiz evaluation, with Mistral. `MISTRAL_API_KEY` key read from the `.env` file at the root (ignored by git); without a key, the tests are skipped. Outside CI: slow and subject to the free quota (2 requests per minute and per model). |

## Prompts

The prompts are in `packages/ai/prompts/*.md` and embedded in
`packages/ai/src/prompts/defaults.generated.ts`. After a change:

```sh
pnpm --filter @openeugenia/ai prompts
```

A test and the CI check that the embedded module is up to date.

## Demo wiki

`examples/demo-wiki` is used by the CLI and end-to-end tests. Its sub-wiki descriptions store the
fingerprints of their sources: after changing a page, regenerate them (`eugenia summarize
examples/demo-wiki`) or update their `sources`, so that `eugenia validate` and the tests keep
seeing them as fresh.

## Versions

A version is released by a `vX.Y.Z` tag: the CI builds and deploys the app to GitHub Pages. The
`v1` major tag of the publication action follows the latest compatible version.
