/** Settings: GitHub token, AI providers, local AI for private content, offline data (§9.2, view 11). */
import { useEffect, useState } from "react";
import { CheckCircle2, KeyRound, Trash2 } from "lucide-react";
import type { ProviderConfig, ProviderKind } from "@openeugenia/ai";
import {
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_INDEX_MODEL,
  DEFAULT_MISTRAL_URL,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OLLAMA_URL,
} from "@openeugenia/ai/constants";
import { forgetRepo, listRecents, localSize, type RecentWiki } from "../lib/db.ts";
import { formatBytes } from "../lib/format.ts";
import { GitHubClient } from "../lib/github.ts";
import { indexingConfig, type Settings, type Theme } from "../lib/settings.ts";
import { useSettings } from "../store/settings.ts";
import { confirmDialog, errorMessage, toast } from "../store/ui.ts";
import { useWiki } from "../store/wiki.ts";

const MODELS = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-2"];

function ProviderEditor({
  id,
  value,
  onChange,
  allowLocalOnly,
}: {
  id: string;
  value: ProviderConfig | undefined;
  onChange(value: ProviderConfig | undefined): void;
  allowLocalOnly: boolean;
}) {
  const kind: ProviderKind | "" = value?.kind ?? "";
  const [testing, setTesting] = useState(false);
  const set = (patch: Partial<ProviderConfig>): void =>
    onChange({ ...(value ?? { kind: "anthropic" }), ...patch } as ProviderConfig);
  const test = async (): Promise<void> => {
    if (!value) return;
    setTesting(true);
    try {
      const { createProvider } = await import("@openeugenia/ai");
      const provider = createProvider(value);
      const text = await provider.complete({
        system: "You are a connection test.",
        messages: [{ role: "user", content: "Only answer: OK" }],
        effort: "low",
      });
      toast(
        `${provider.info.label} answers (${provider.info.model}): "${text.slice(0, 40)}"`,
        "success",
      );
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setTesting(false);
    }
  };
  return (
    <div className="form-grid">
      <div className="form-row">
        <div className="oe-field">
          <label className="oe-label" htmlFor={`${id}-kind`}>
            Provider
          </label>
          <select
            id={`${id}-kind`}
            className="oe-select"
            value={kind}
            onChange={(e) => {
              const k = e.target.value as ProviderKind | "";
              if (!k) onChange(undefined);
              else if (k === "ollama")
                onChange({ kind: k, baseUrl: DEFAULT_OLLAMA_URL, model: DEFAULT_OLLAMA_MODEL });
              else if (k === "anthropic") onChange({ kind: k, model: DEFAULT_ANTHROPIC_MODEL });
              else onChange({ kind: k });
            }}
          >
            <option value="">None</option>
            {!allowLocalOnly && <option value="anthropic">Claude (Anthropic)</option>}
            {!allowLocalOnly && <option value="openai">OpenAI-compatible</option>}
            <option value="ollama">Ollama / local server</option>
          </select>
        </div>
        {value && (
          <div className="oe-field">
            <label className="oe-label" htmlFor={`${id}-model`}>
              Model
            </label>
            <input
              id={`${id}-model`}
              className="oe-input"
              list={value.kind === "anthropic" ? "claude-models" : undefined}
              value={value.model ?? ""}
              placeholder={
                value.kind === "anthropic"
                  ? DEFAULT_ANTHROPIC_MODEL
                  : value.kind === "ollama"
                    ? DEFAULT_OLLAMA_MODEL
                    : "model name"
              }
              onChange={(e) => set({ model: e.target.value })}
            />
          </div>
        )}
      </div>
      {value && value.kind !== "anthropic" && (
        <div className="oe-field">
          <label className="oe-label" htmlFor={`${id}-url`}>
            Server URL
          </label>
          <input
            id={`${id}-url`}
            className="oe-input"
            value={value.baseUrl ?? ""}
            placeholder={value.kind === "ollama" ? DEFAULT_OLLAMA_URL : "https://…/v1"}
            onChange={(e) => set({ baseUrl: e.target.value })}
          />
          {value.kind === "ollama" && (
            <span className="oe-help">
              Ollama must allow the app's origin: start it with{" "}
              <code>OLLAMA_ORIGINS={location.origin}</code>.
            </span>
          )}
        </div>
      )}
      {value && value.kind !== "ollama" && (
        <div className="oe-field">
          <label className="oe-label" htmlFor={`${id}-key`}>
            API key
          </label>
          <input
            id={`${id}-key`}
            className="oe-input"
            type="password"
            autoComplete="off"
            value={value.apiKey ?? ""}
            onChange={(e) => set({ apiKey: e.target.value })}
            placeholder={value.kind === "anthropic" ? "sk-ant-…" : "provider key"}
          />
          <span className="oe-help">Kept in this browser only, sent only to the provider.</span>
        </div>
      )}
      {value && (
        <div className="actions actions--start">
          <button
            type="button"
            className="oe-button oe-button--secondary oe-button--sm"
            disabled={testing}
            onClick={() => void test()}
          >
            {testing ? "Testing…" : "Test"}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Embedding provider of the semantic search: Mistral by default, or any OpenAI-compatible
 * server (including Ollama, without a key).
 */
function EmbeddingEditor({
  value,
  onChange,
}: {
  value: ProviderConfig | undefined;
  onChange(value: ProviderConfig | undefined): void;
}) {
  const [fields, setFields] = useState({
    baseUrl: value?.baseUrl ?? DEFAULT_MISTRAL_URL,
    model: value?.model ?? DEFAULT_EMBEDDING_MODEL,
    apiKey: value?.apiKey ?? "",
  });
  const [testing, setTesting] = useState(false);
  const set = (patch: Partial<typeof fields>): void => {
    const next = { ...fields, ...patch };
    setFields(next);
    const baseUrl = next.baseUrl.trim() || DEFAULT_MISTRAL_URL;
    const apiKey = next.apiKey.trim();
    // Without a key, only another server (a local one, for example) makes sense.
    onChange(
      apiKey || baseUrl !== DEFAULT_MISTRAL_URL
        ? {
            kind: "openai",
            baseUrl,
            model: next.model.trim() || DEFAULT_EMBEDDING_MODEL,
            ...(apiKey ? { apiKey } : {}),
          }
        : undefined,
    );
  };
  const test = async (): Promise<void> => {
    if (!value) return;
    setTesting(true);
    try {
      const { createProvider, embedTexts } = await import("@openeugenia/ai");
      const provider = createProvider(value);
      const [vector] = await embedTexts(provider, ["Connection test"]);
      toast(
        `${provider.info.label} answers (${provider.info.model}): vectors of ${vector!.length} dimensions.`,
        "success",
      );
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setTesting(false);
    }
  };
  return (
    <div className="form-grid">
      <div className="oe-field">
        <label className="oe-label" htmlFor="embeddings-key">
          Mistral API key
        </label>
        <input
          id="embeddings-key"
          className="oe-input"
          type="password"
          autoComplete="off"
          value={fields.apiKey}
          onChange={(e) => set({ apiKey: e.target.value })}
          placeholder="key from console.mistral.ai"
        />
        <span className="oe-help">
          Mistral offers free, rate-limited access: create a key on{" "}
          <a href="https://console.mistral.ai/api-keys" target="_blank" rel="noopener noreferrer">
            console.mistral.ai
          </a>
          . Kept in this browser only.
        </span>
      </div>
      <div className="form-row">
        <div className="oe-field">
          <label className="oe-label" htmlFor="embeddings-model">
            Embedding model
          </label>
          <input
            id="embeddings-model"
            className="oe-input"
            value={fields.model}
            placeholder={DEFAULT_EMBEDDING_MODEL}
            onChange={(e) => set({ model: e.target.value })}
          />
        </div>
        <div className="oe-field">
          <label className="oe-label" htmlFor="embeddings-url">
            Server URL
          </label>
          <input
            id="embeddings-url"
            className="oe-input"
            value={fields.baseUrl}
            placeholder={DEFAULT_MISTRAL_URL}
            onChange={(e) => set({ baseUrl: e.target.value })}
          />
        </div>
      </div>
      {value && (
        <div className="actions actions--start">
          <button
            type="button"
            className="oe-button oe-button--secondary oe-button--sm"
            disabled={testing}
            onClick={() => void test()}
          >
            {testing ? "Testing…" : "Test"}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Model of the indexing of sources: a large Mistral model by default, with the key of the
 * semantic search unless another one is given.
 */
function IndexingEditor({ draft, onChange }: { draft: Settings; onChange(next: Settings): void }) {
  const indexing = draft.ai.indexing;
  const [fields, setFields] = useState({
    model: indexing?.model ?? DEFAULT_INDEX_MODEL,
    apiKey: indexing?.apiKey ?? "",
    baseUrl: indexing?.baseUrl ?? DEFAULT_MISTRAL_URL,
  });
  const [testing, setTesting] = useState(false);
  const set = (patch: Partial<typeof fields>): void => {
    const next = { ...fields, ...patch };
    setFields(next);
    const baseUrl = next.baseUrl.trim() || DEFAULT_MISTRAL_URL;
    const apiKey = next.apiKey.trim();
    onChange({
      ...draft,
      ai: {
        ...draft.ai,
        indexing: {
          kind: "openai",
          baseUrl,
          model: next.model.trim() || DEFAULT_INDEX_MODEL,
          ...(apiKey ? { apiKey } : {}),
          ...(baseUrl === DEFAULT_MISTRAL_URL ? { label: "Mistral" } : {}),
        },
      },
    });
  };
  const effective = indexingConfig(draft);
  const test = async (): Promise<void> => {
    if (!effective) return;
    setTesting(true);
    try {
      const { createProvider } = await import("@openeugenia/ai");
      const provider = createProvider(effective);
      const text = await provider.complete({
        system: "Answer with one word.",
        messages: [{ role: "user", content: "Say OK." }],
        maxTokens: 2000,
      });
      toast(
        `${provider.info.label} answers (${provider.info.model}): ${text.slice(0, 40)}`,
        "success",
      );
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setTesting(false);
    }
  };
  return (
    <div className="form-grid">
      <div className="form-row">
        <div className="oe-field">
          <label className="oe-label" htmlFor="indexing-model">
            Indexing model
          </label>
          <input
            id="indexing-model"
            className="oe-input"
            value={fields.model}
            placeholder={DEFAULT_INDEX_MODEL}
            onChange={(e) => set({ model: e.target.value })}
          />
          <span className="oe-help">A large model: it reads each source once.</span>
        </div>
        <div className="oe-field">
          <label className="oe-label" htmlFor="indexing-key">
            API key
          </label>
          <input
            id="indexing-key"
            className="oe-input"
            type="password"
            autoComplete="off"
            value={fields.apiKey}
            placeholder="the Mistral key above, by default"
            onChange={(e) => set({ apiKey: e.target.value })}
          />
        </div>
        <div className="oe-field">
          <label className="oe-label" htmlFor="indexing-url">
            Server URL
          </label>
          <input
            id="indexing-url"
            className="oe-input"
            value={fields.baseUrl}
            placeholder={DEFAULT_MISTRAL_URL}
            onChange={(e) => set({ baseUrl: e.target.value })}
          />
        </div>
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={draft.ai.autoIndex !== false}
          onChange={(e) => onChange({ ...draft, ai: { ...draft.ai, autoIndex: e.target.checked } })}
        />
        <span>Index each new source automatically (and again when its content changes).</span>
      </label>
      {effective ? (
        <div className="actions actions--start">
          <span className="muted small">
            Indexing with {effective.model}
            {effective.apiKey ? "" : " (no key)"}.
          </span>
          <button
            type="button"
            className="oe-button oe-button--secondary oe-button--sm"
            disabled={testing}
            onClick={() => void test()}
          >
            {testing ? "Testing…" : "Test"}
          </button>
        </div>
      ) : (
        <p className="muted small">Add a Mistral key (above or here) to index your sources.</p>
      )}
    </div>
  );
}

export function SettingsView() {
  const { settings, update } = useSettings();
  const [draft, setDraft] = useState<Settings>(settings);
  const [login, setLogin] = useState<string | null>(null);
  const [recents, setRecents] = useState<(RecentWiki & { size: number })[]>([]);
  const forgetCurrent = useWiki((s) => s.forget);
  const currentKey = useWiki((s) => s.workspace?.key);

  useEffect(() => setDraft(settings), [settings]);
  useEffect(() => {
    void (async () => {
      const list = await listRecents().catch(() => []);
      setRecents(
        await Promise.all(
          list.map(async (r) => ({ ...r, size: await localSize(r.key).catch(() => 0) })),
        ),
      );
    })();
  }, []);

  const save = async (): Promise<void> => {
    await update(() => draft);
    // First AI configuration: ask right away how private nodes should be processed (§11.1).
    if ((draft.ai.main || draft.ai.local) && draft.ai.localOnlyForPrivate === null) {
      const { ensurePrivacyChoice } = await import("../lib/ai.ts");
      await ensurePrivacyChoice();
    }
    toast("Settings saved.", "success");
  };

  const testToken = async (): Promise<void> => {
    try {
      const user = await new GitHubClient(draft.githubToken).getUser();
      setLogin(user.login);
      toast(`Valid token: signed in as ${user.login}.`, "success");
    } catch (error) {
      setLogin(null);
      toast(errorMessage(error), "error");
    }
  };

  const forget = async (wiki: RecentWiki): Promise<void> => {
    const ok = await confirmDialog({
      title: "Forget this wiki on this device",
      body: `The local copy of ${wiki.repo} and its unsaved changes will be erased from this browser. The GitHub repository is not modified.`,
      confirmLabel: "Forget",
      danger: true,
    });
    if (!ok) return;
    if (wiki.key === currentKey) await forgetCurrent();
    else await forgetRepo(wiki.key);
    setRecents((list) => list.filter((r) => r.key !== wiki.key));
    toast("Local copy erased.", "success");
  };

  const ai = draft.ai;
  return (
    <div className="page">
      <h1>Settings</h1>
      <p className="muted">
        These settings stay in this browser: they are never written to your repositories.
      </p>

      <section className="section oe-card">
        <h2 className="oe-card__title">
          <KeyRound aria-hidden="true" style={{ display: "inline", verticalAlign: "-0.15em" }} />{" "}
          GitHub access
        </h2>
        <div className="oe-field">
          <label className="oe-label" htmlFor="token">
            Personal access token (fine-grained)
          </label>
          <input
            id="token"
            className="oe-input"
            type="password"
            autoComplete="off"
            value={draft.githubToken ?? ""}
            onChange={(e) => {
              const githubToken = e.target.value.trim();
              setDraft((d) => {
                const next = { ...d };
                if (githubToken) next.githubToken = githubToken;
                else delete next.githubToken;
                return next;
              });
            }}
            placeholder="github_pat_…"
          />
          <span className="oe-help">
            Create it on{" "}
            <a
              href="https://github.com/settings/personal-access-tokens/new"
              target="_blank"
              rel="noopener noreferrer"
            >
              github.com/settings/personal-access-tokens
            </a>{" "}
            : access to the <strong>private repository</strong> of your wiki only, with the
            "Contents: read and write" permission (and "Workflows" to set up automatic publication
            from the app).
          </span>
        </div>
        <div className="actions actions--start">
          <button
            type="button"
            className="oe-button oe-button--secondary oe-button--sm"
            disabled={!draft.githubToken}
            onClick={() => void testToken()}
          >
            Check the token
          </button>
          {login && (
            <span
              className="small"
              style={{ display: "inline-flex", gap: "0.35rem", alignItems: "center" }}
            >
              <CheckCircle2 aria-hidden="true" style={{ color: "var(--oe-color-success)" }} />{" "}
              {login}
            </span>
          )}
        </div>
      </section>

      <section className="section oe-card">
        <h2 className="oe-card__title">Eugenia (AI)</h2>
        <p className="muted small">
          Calls go directly from your browser to the chosen provider, with your key. By default,
          Claude uses the model {DEFAULT_ANTHROPIC_MODEL}.
        </p>
        <datalist id="claude-models">
          {MODELS.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <h3 style={{ fontSize: "var(--oe-font-size-md)" }}>Main provider</h3>
        <ProviderEditor
          id="main"
          value={ai.main}
          allowLocalOnly={false}
          onChange={(main) =>
            setDraft((d) => ({ ...d, ai: { ...d.ai, ...(main ? { main } : { main: undefined }) } }))
          }
        />
        <h3 style={{ fontSize: "var(--oe-font-size-md)" }}>Local AI</h3>
        <ProviderEditor
          id="local"
          value={ai.local}
          allowLocalOnly
          onChange={(local) =>
            setDraft((d) => ({
              ...d,
              ai: { ...d.ai, ...(local ? { local } : { local: undefined }) },
            }))
          }
        />
        <label className="check">
          <input
            type="checkbox"
            checked={ai.localOnlyForPrivate === true}
            onChange={(e) =>
              setDraft((d) => ({ ...d, ai: { ...d.ai, localOnlyForPrivate: e.target.checked } }))
            }
          />
          <span>
            <strong>Keep my private knowledge for the local AI.</strong> Any task involving a
            private node (description, extraction, quiz, discussion, question) must go through the
            local AI; otherwise, the action is blocked.
          </span>
        </label>
        {ai.localOnlyForPrivate === null && (
          <p className="muted small">You will be asked this before Eugenia is first used.</p>
        )}
      </section>

      <section className="section oe-card">
        <h2 className="oe-card__title">Semantic search</h2>
        <p className="muted small">
          Search "by meaning" finds your pages from a question or an idea, even with no word in
          common. Each page gets an embedding (a vector that sums up its meaning), computed by the
          provider below and saved next to the page in your private repository; it is never
          published. The content of the pages is sent to it: private pages follow the "local AI for
          private content" rule above.
        </p>
        <EmbeddingEditor
          value={ai.embeddings}
          onChange={(embeddings) =>
            setDraft((d) => ({
              ...d,
              ai: { ...d.ai, ...(embeddings ? { embeddings } : { embeddings: undefined }) },
            }))
          }
        />
      </section>

      <section className="section oe-card">
        <h2 className="oe-card__title">Indexing of sources</h2>
        <p className="muted small">
          Each source of your library is read once by a large model and described as a tree of
          knowledge (topics, ideas, arguments, examples, conclusions), saved next to the source in
          your private repository. Eugenia then answers your questions from this index, at low cost,
          without reading the whole source again; with search by meaning, each part of the index is
          also found by its meaning. The content of the sources is sent to this model: private
          sources follow the "local AI for private content" rule above. The index of a public source
          is published with it.
        </p>
        <IndexingEditor draft={draft} onChange={setDraft} />
      </section>

      <section className="section oe-card">
        <h2 className="oe-card__title">Appearance</h2>
        <div className="oe-field" style={{ maxWidth: "16rem" }}>
          <label className="oe-label" htmlFor="theme">
            Theme
          </label>
          <select
            id="theme"
            className="oe-select"
            value={draft.theme}
            onChange={(e) => setDraft((d) => ({ ...d, theme: e.target.value as Theme }))}
          >
            <option value="auto">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
      </section>

      <div className="actions" style={{ marginTop: "1.5rem" }}>
        <button type="button" className="oe-button" onClick={() => void save()}>
          Save the settings
        </button>
      </div>

      <section className="section oe-card">
        <h2 className="oe-card__title">Offline data</h2>
        <p className="muted small">
          Each wiki you view is copied into this browser to work without a network. You can erase
          this copy ("forget this wiki on this device").
        </p>
        {recents.length === 0 ? (
          <p className="muted">No local copy.</p>
        ) : (
          <ul className="link-list">
            {recents.map((r) => (
              <li key={r.key}>
                <span>
                  <strong>{r.title}</strong>{" "}
                  <span className="muted small">
                    ({r.repo}, {formatBytes(r.size)})
                  </span>
                </span>
                <button
                  type="button"
                  className="oe-button oe-button--ghost oe-button--sm"
                  onClick={() => void forget(r)}
                >
                  <Trash2 aria-hidden="true" /> Forget
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
