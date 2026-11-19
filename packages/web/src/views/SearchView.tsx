/**
 * Recherche plein texte avec filtres par type, étiquette, visibilité et maîtrise (§9.2, vue 9),
 * et, pour le propriétaire, recherche par le sens grâce aux embeddings des pages (§14).
 */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Sparkles } from "lucide-react";
import { ancestors, pageIndexPaths, type SimilarityHit } from "@openeugenia/core";
import { MasteryMeter } from "../components/charts.tsx";
import { InfoBox, Spinner, TypeIcon, VisibilityBadge } from "../components/common.tsx";
import { currentMastery, dayNumber } from "@openeugenia/core";
import { formatPercent, plural } from "../lib/format.ts";
import { useCanEdit, useDerived, useIsOwner } from "../lib/hooks.ts";
import { href, navigate } from "../lib/router.ts";
import {
  indexPages,
  loadSemanticIndex,
  pendingEntries,
  semanticSearch,
  type SemanticIndex,
} from "../lib/semantic.ts";
import { hasEmbeddings } from "../lib/settings.ts";
import { useSettings } from "../store/settings.ts";
import { errorMessage, toast } from "../store/ui.ts";
import {
  createIndex,
  documentFor,
  matchesFilters,
  snippet,
  type SearchFilters,
} from "../lib/search.ts";
import { useWiki } from "../store/wiki.ts";

export function SearchView({ q }: { q?: string }) {
  const derived = useDerived();
  const owner = useIsOwner();
  const workspace = useWiki((s) => s.workspace);
  const version = useWiki((s) => s.version);
  const [query, setQuery] = useState(q ?? "");
  const [filters, setFilters] = useState<SearchFilters>({});
  const [loadedContents, setLoadedContents] = useState(0);
  const editable = useCanEdit();
  const settings = useSettings((s) => s.settings);
  const embeddingModel =
    owner && hasEmbeddings(settings) ? settings.ai.embeddings!.model : undefined;
  const [mode, setMode] = useState<"words" | "meaning">("words");
  const [semantic, setSemantic] = useState<SemanticIndex | null>(null);
  const [hits, setHits] = useState<SimilarityHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [indexing, setIndexing] = useState<{ done: number; total: number } | null>(null);
  useEffect(() => setQuery(q ?? ""), [q]);

  // En lecture publique, les contenus sont chargés en arrière-plan pour l'index.
  useEffect(() => {
    if (!workspace || workspace.mode === "owner") return;
    const files = pageIndexPaths(derived.config, derived.files.keys()).map((p) =>
      derived.files.get(p)!,
    );
    let cancelled = false;
    void workspace.prefetch(files).then(
      () => !cancelled && setLoadedContents((n) => n + 1),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [workspace, derived]);

  const index = useMemo(() => {
    const idx = createIndex();
    const docs = [...derived.tree.nodes.values()].map((n) =>
      documentFor(derived.tree, n, workspace?.peekText(n.indexPath)),
    );
    idx.addAll(docs);
    return { idx, docs: new Map(docs.map((d) => [d.id, d])) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derived.tree, workspace, version, loadedContents]);

  const tags = useMemo(
    () => [...new Set([...derived.tree.nodes.values()].flatMap((n) => n.tags))].sort(),
    [derived.tree],
  );
  const tagQuery = /^#(\S+)$/.exec(query.trim());
  const effective: SearchFilters = tagQuery ? { ...filters, tag: tagQuery[1] } : filters;
  const text = tagQuery ? "" : query.trim();
  const meaning = mode === "meaning";

  // Recherche par le sens : embeddings du wiki, rechargés après chaque modification.
  useEffect(() => {
    if (!meaning || !embeddingModel) return;
    let cancelled = false;
    loadSemanticIndex(embeddingModel).then(
      (loaded) => !cancelled && setSemantic(loaded),
      (error: unknown) => !cancelled && toast(errorMessage(error), "error"),
    );
    return () => {
      cancelled = true;
    };
  }, [meaning, embeddingModel, derived]);

  const pending = semantic ? pendingEntries(semantic) : [];
  const indexed = semantic ? semantic.entries.filter((e) => e.vector).length : 0;
  // La requête est envoyée au fournisseur d'embeddings une fois la frappe terminée.
  const semanticQuery = meaning && semantic && indexed > 0 ? text : "";
  useEffect(() => {
    setHits(null);
    if (!semantic || !semanticQuery) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      semanticSearch(semantic, semanticQuery, controller.signal)
        .then(
          (found) => !controller.signal.aborted && setHits(found),
          (error: unknown) => !controller.signal.aborted && toast(errorMessage(error), "error"),
        )
        .finally(() => !controller.signal.aborted && setSearching(false));
    }, 500);
    return () => {
      clearTimeout(timer);
      controller.abort();
      setSearching(false);
    };
  }, [semantic, semanticQuery]);

  const results = useMemo(() => {
    const threshold = derived.config.mastery.reminder_threshold;
    const candidates: { id: string; terms: string[]; score?: number }[] =
      meaning && text
        ? (hits ?? []).map((h) => ({ id: h.id, terms: [], score: h.score }))
        : text
          ? index.idx.search(text).map((r) => ({ id: r.id as string, terms: r.terms }))
          : [...derived.tree.nodes.values()].map((n) => ({ id: n.id, terms: [] as string[] }));
    return candidates
      .map((r) => ({ ...r, node: derived.tree.nodes.get(r.id)! }))
      .filter((r) => r.node && matchesFilters(r.node, effective, derived.mastery, threshold))
      .slice(0, 80);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, text, JSON.stringify(effective), derived, meaning, hits]);

  const runIndexing = async (): Promise<void> => {
    if (!semantic) return;
    setIndexing({ done: 0, total: pending.length });
    try {
      const result = await indexPages(semantic, {
        onProgress: (done, total) => setIndexing({ done, total }),
      });
      toast(
        `${plural(result.indexed, "page indexée", "pages indexées")}${
          result.skippedPrivate
            ? ` ; ${plural(result.skippedPrivate, "page privée ignorée", "pages privées ignorées")} (réservées à une IA locale)`
            : ""
        }.`,
        "success",
      );
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setIndexing(null);
    }
  };

  const submit = (e: FormEvent): void => {
    e.preventDefault();
    navigate({ name: "search", ...(query.trim() ? { q: query.trim() } : {}) }, { replace: true });
  };
  const today = dayNumber(Date.now());
  const anyFilter = Object.values(effective).some(Boolean);

  return (
    <div className="page">
      <h1>Recherche</h1>
      <form className="form-grid" onSubmit={submit} role="search">
        <input
          className="oe-input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            meaning ? "Une question, une idée… (recherche par le sens)" : "Mots, ou #étiquette"
          }
          aria-label="Recherche"
          autoFocus
        />
        {owner && (
          <fieldset className="search-mode">
            <legend className="sr-only">Type de recherche</legend>
            <label className="check">
              <input
                type="radio"
                name="search-mode"
                checked={!meaning}
                onChange={() => setMode("words")}
              />
              <span>Par mots-clés</span>
            </label>
            <label className="check">
              <input
                type="radio"
                name="search-mode"
                checked={meaning}
                onChange={() => setMode("meaning")}
              />
              <span>Par le sens</span>
            </label>
          </fieldset>
        )}
        <div className="form-row">
          <select
            className="oe-select"
            value={filters.type ?? ""}
            onChange={(e) =>
              setFilters((f) => ({ ...f, type: e.target.value as SearchFilters["type"] }))
            }
            aria-label="Type"
          >
            <option value="">Tous les types</option>
            <option value="category">Catégories</option>
            <option value="knowledge">Connaissances atomiques</option>
            <option value="flashcard">Flashcards</option>
            <option value="source">Sources</option>
          </select>
          <select
            className="oe-select"
            value={filters.tag ?? ""}
            onChange={(e) => setFilters((f) => ({ ...f, tag: e.target.value }))}
            aria-label="Étiquette"
          >
            <option value="">Toutes les étiquettes</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                #{t}
              </option>
            ))}
          </select>
          {owner && (
            <select
              className="oe-select"
              value={filters.visibility ?? ""}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  visibility: e.target.value as SearchFilters["visibility"],
                }))
              }
              aria-label="Visibilité"
            >
              <option value="">Publiques et privées</option>
              <option value="public">Publiques</option>
              <option value="private">Privées</option>
            </select>
          )}
          {owner && (
            <select
              className="oe-select"
              value={filters.mastery ?? ""}
              onChange={(e) =>
                setFilters((f) => ({ ...f, mastery: e.target.value as SearchFilters["mastery"] }))
              }
              aria-label="Maîtrise"
            >
              <option value="">Toute maîtrise</option>
              <option value="low">À réviser</option>
              <option value="mid">Moyenne</option>
              <option value="high">Solide (≥ 70 %)</option>
            </select>
          )}
        </div>
      </form>
      {meaning && !embeddingModel && (
        <InfoBox>
          La recherche par le sens compare votre requête au sens de vos pages, grâce à leurs
          embeddings. Ajoutez une clé Mistral dans les{" "}
          <a href={href({ name: "settings" })}>paramètres</a> (« Recherche sémantique ») pour
          l'activer.
        </InfoBox>
      )}
      {meaning && embeddingModel && (
        <div className="semantic-status small">
          {!semantic ? (
            <Spinner small label="Chargement de l'index sémantique" />
          ) : (
            <span className="muted">
              {indexed} / {plural(semantic.entries.length, "page indexée", "pages indexées")}
              {pending.length > 0 && ` · ${plural(pending.length, "page")} à indexer`}
            </span>
          )}
          {semantic && pending.length > 0 && editable && (
            <button
              type="button"
              className="oe-button oe-button--secondary oe-button--sm"
              disabled={indexing !== null}
              onClick={() => void runIndexing()}
            >
              <Sparkles aria-hidden="true" />{" "}
              {indexing
                ? `Indexation… ${indexing.done}/${indexing.total}`
                : `Indexer ${plural(pending.length, "page")}`}
            </button>
          )}
        </div>
      )}
      <section className="section">
        {!text && !anyFilter ? (
          <p className="muted">
            {meaning
              ? "Décrivez ce que vous cherchez, avec vos mots : une question, une idée, un souvenir."
              : "Saisissez des mots ou choisissez un filtre."}
          </p>
        ) : meaning && text && semantic && indexed === 0 ? (
          <p className="muted">
            Aucune page n'est encore indexée : lancez l'indexation pour chercher par le sens.
          </p>
        ) : meaning && text && (searching || hits === null) ? (
          <Spinner label="Recherche par le sens" />
        ) : (
          <>
            <p className="muted small">{plural(results.length, "résultat")}</p>
            <ul className="link-list">
              {results.map(({ node, terms, score }) => {
                const state = derived.mastery.get(node.id);
                const doc = index.docs.get(node.id);
                return (
                  <li
                    key={node.id}
                    style={{ flexDirection: "column", alignItems: "flex-start", gap: "0.2rem" }}
                  >
                    <span
                      style={{
                        display: "inline-flex",
                        gap: "0.5rem",
                        alignItems: "center",
                        flexWrap: "wrap",
                      }}
                    >
                      <TypeIcon node={node} tree={derived.tree} />
                      <a href={href({ name: "node", id: node.id })}>
                        <strong>{node.title}</strong>
                      </a>
                      {owner && (
                        <VisibilityBadge
                          visibility={node.isPublic ? "public" : "private"}
                          compact
                        />
                      )}
                      {score !== undefined && (
                        <span className="muted small" title="Proximité de sens avec la requête">
                          proximité {formatPercent(score)}
                        </span>
                      )}
                      {owner && state && (
                        <MasteryMeter
                          value={currentMastery(state, today)}
                          threshold={derived.config.mastery.reminder_threshold}
                          compact
                        />
                      )}
                    </span>
                    <span className="muted small">
                      {ancestors(derived.tree, node.id)
                        .map((a) => a.title)
                        .join(" › ")}
                    </span>
                    {doc && text && (
                      <span className="small">{snippet(doc.text || doc.title, terms)}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
