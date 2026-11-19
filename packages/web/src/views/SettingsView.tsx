/** Paramètres : jeton GitHub, fournisseurs d'IA, IA locale pour le privé, données hors ligne (§9.2, vue 11). */
import { useEffect, useState } from "react";
import { CheckCircle2, KeyRound, Trash2 } from "lucide-react";
import type { ProviderConfig, ProviderKind } from "@openeugenia/ai";
import {
  DEFAULT_ANTHROPIC_MODEL,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_MISTRAL_URL,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OLLAMA_URL,
} from "@openeugenia/ai/constants";
import { forgetRepo, listRecents, localSize, type RecentWiki } from "../lib/db.ts";
import { formatBytes } from "../lib/format.ts";
import { GitHubClient } from "../lib/github.ts";
import type { Settings, Theme } from "../lib/settings.ts";
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
        system: "Tu es un test de connexion.",
        messages: [{ role: "user", content: "Réponds seulement : OK" }],
        effort: "low",
      });
      toast(
        `${provider.info.label} répond (${provider.info.model}) : « ${text.slice(0, 40)} »`,
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
            Fournisseur
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
            <option value="">Aucun</option>
            {!allowLocalOnly && <option value="anthropic">Claude (Anthropic)</option>}
            {!allowLocalOnly && <option value="openai">Compatible OpenAI</option>}
            <option value="ollama">Ollama / serveur local</option>
          </select>
        </div>
        {value && (
          <div className="oe-field">
            <label className="oe-label" htmlFor={`${id}-model`}>
              Modèle
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
                    : "nom du modèle"
              }
              onChange={(e) => set({ model: e.target.value })}
            />
          </div>
        )}
      </div>
      {value && value.kind !== "anthropic" && (
        <div className="oe-field">
          <label className="oe-label" htmlFor={`${id}-url`}>
            Adresse du serveur
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
              Ollama doit autoriser l'origine de l'application : lancez-le avec{" "}
              <code>OLLAMA_ORIGINS={location.origin}</code>.
            </span>
          )}
        </div>
      )}
      {value && value.kind !== "ollama" && (
        <div className="oe-field">
          <label className="oe-label" htmlFor={`${id}-key`}>
            Clé API
          </label>
          <input
            id={`${id}-key`}
            className="oe-input"
            type="password"
            autoComplete="off"
            value={value.apiKey ?? ""}
            onChange={(e) => set({ apiKey: e.target.value })}
            placeholder={value.kind === "anthropic" ? "sk-ant-…" : "clé du fournisseur"}
          />
          <span className="oe-help">
            Conservée dans ce navigateur seulement, envoyée uniquement au fournisseur.
          </span>
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
            {testing ? "Test en cours…" : "Tester"}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Fournisseur d'embeddings de la recherche sémantique : Mistral par défaut, ou tout serveur
 * compatible OpenAI (dont Ollama, sans clé).
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
    // Sans clé, seul un autre serveur (local, par exemple) a un sens.
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
      const [vector] = await embedTexts(provider, ["Test de connexion"]);
      toast(
        `${provider.info.label} répond (${provider.info.model}) : vecteurs de ${vector!.length} dimensions.`,
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
          Clé API Mistral
        </label>
        <input
          id="embeddings-key"
          className="oe-input"
          type="password"
          autoComplete="off"
          value={fields.apiKey}
          onChange={(e) => set({ apiKey: e.target.value })}
          placeholder="clé de console.mistral.ai"
        />
        <span className="oe-help">
          Mistral propose un accès gratuit, limité en débit : créez une clé sur{" "}
          <a href="https://console.mistral.ai/api-keys" target="_blank" rel="noopener noreferrer">
            console.mistral.ai
          </a>
          . Conservée dans ce navigateur seulement.
        </span>
      </div>
      <div className="form-row">
        <div className="oe-field">
          <label className="oe-label" htmlFor="embeddings-model">
            Modèle d'embeddings
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
            Adresse du serveur
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
            {testing ? "Test en cours…" : "Tester"}
          </button>
        </div>
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
    // Première configuration d'une IA : on demande aussitôt le traitement des nœuds privés (§11.1).
    if ((draft.ai.main || draft.ai.local) && draft.ai.localOnlyForPrivate === null) {
      const { ensurePrivacyChoice } = await import("../lib/ai.ts");
      await ensurePrivacyChoice();
    }
    toast("Paramètres enregistrés.", "success");
  };

  const testToken = async (): Promise<void> => {
    try {
      const user = await new GitHubClient(draft.githubToken).getUser();
      setLogin(user.login);
      toast(`Jeton valide : connecté en tant que ${user.login}.`, "success");
    } catch (error) {
      setLogin(null);
      toast(errorMessage(error), "error");
    }
  };

  const forget = async (wiki: RecentWiki): Promise<void> => {
    const ok = await confirmDialog({
      title: "Oublier ce wiki sur cet appareil",
      body: `La copie locale de ${wiki.repo} et ses modifications non enregistrées seront effacées de ce navigateur. Le dépôt GitHub n'est pas modifié.`,
      confirmLabel: "Oublier",
      danger: true,
    });
    if (!ok) return;
    if (wiki.key === currentKey) await forgetCurrent();
    else await forgetRepo(wiki.key);
    setRecents((list) => list.filter((r) => r.key !== wiki.key));
    toast("Copie locale effacée.", "success");
  };

  const ai = draft.ai;
  return (
    <div className="page">
      <h1>Paramètres</h1>
      <p className="muted">
        Ces réglages restent dans ce navigateur : ils ne sont jamais écrits dans vos dépôts.
      </p>

      <section className="section oe-card">
        <h2 className="oe-card__title">
          <KeyRound aria-hidden="true" style={{ display: "inline", verticalAlign: "-0.15em" }} />{" "}
          Accès GitHub
        </h2>
        <div className="oe-field">
          <label className="oe-label" htmlFor="token">
            Jeton d'accès personnel (fine-grained)
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
            Créez-le sur{" "}
            <a
              href="https://github.com/settings/personal-access-tokens/new"
              target="_blank"
              rel="noopener noreferrer"
            >
              github.com/settings/personal-access-tokens
            </a>{" "}
            : accès au <strong>seul dépôt privé</strong> de votre wiki, permissions « Contents :
            lecture et écriture » (et « Workflows » pour créer la publication automatique depuis
            l'application).
          </span>
        </div>
        <div className="actions actions--start">
          <button
            type="button"
            className="oe-button oe-button--secondary oe-button--sm"
            disabled={!draft.githubToken}
            onClick={() => void testToken()}
          >
            Vérifier le jeton
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
        <h2 className="oe-card__title">Eugenia (IA)</h2>
        <p className="muted small">
          Les appels partent directement de votre navigateur vers le fournisseur choisi, avec votre
          clé. Par défaut, Claude utilise le modèle {DEFAULT_ANTHROPIC_MODEL}.
        </p>
        <datalist id="claude-models">
          {MODELS.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <h3 style={{ fontSize: "var(--oe-font-size-md)" }}>Fournisseur principal</h3>
        <ProviderEditor
          id="main"
          value={ai.main}
          allowLocalOnly={false}
          onChange={(main) =>
            setDraft((d) => ({ ...d, ai: { ...d.ai, ...(main ? { main } : { main: undefined }) } }))
          }
        />
        <h3 style={{ fontSize: "var(--oe-font-size-md)" }}>IA locale</h3>
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
            <strong>Réserver mes connaissances privées à l'IA locale.</strong> Tout traitement qui
            implique un nœud privé (description, extraction, quiz, discussion, question) passe
            obligatoirement par l'IA locale ; à défaut, l'action est bloquée.
          </span>
        </label>
        {ai.localOnlyForPrivate === null && (
          <p className="muted small">
            Cette question vous sera posée avant la première utilisation d'Eugenia.
          </p>
        )}
      </section>

      <section className="section oe-card">
        <h2 className="oe-card__title">Recherche sémantique</h2>
        <p className="muted small">
          La recherche « par le sens » retrouve vos pages à partir d'une question ou d'une idée,
          même sans mot en commun. Chaque page reçoit un embedding (un vecteur qui résume son sens),
          calculé par le fournisseur ci-dessous et enregistré à côté de la page dans votre dépôt
          privé ; il n'est jamais publié. Le contenu des pages lui est envoyé : les pages privées
          suivent la règle « IA locale pour le privé » ci-dessus.
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
        <h2 className="oe-card__title">Apparence</h2>
        <div className="oe-field" style={{ maxWidth: "16rem" }}>
          <label className="oe-label" htmlFor="theme">
            Thème
          </label>
          <select
            id="theme"
            className="oe-select"
            value={draft.theme}
            onChange={(e) => setDraft((d) => ({ ...d, theme: e.target.value as Theme }))}
          >
            <option value="auto">Selon le système</option>
            <option value="light">Clair</option>
            <option value="dark">Sombre</option>
          </select>
        </div>
      </section>

      <div className="actions" style={{ marginTop: "1.5rem" }}>
        <button type="button" className="oe-button" onClick={() => void save()}>
          Enregistrer les paramètres
        </button>
      </div>

      <section className="section oe-card">
        <h2 className="oe-card__title">Données hors ligne</h2>
        <p className="muted small">
          Chaque wiki consulté est copié dans ce navigateur pour fonctionner sans réseau. Vous
          pouvez effacer cette copie (« oublier ce wiki sur cet appareil »).
        </p>
        {recents.length === 0 ? (
          <p className="muted">Aucune copie locale.</p>
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
                  <Trash2 aria-hidden="true" /> Oublier
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
