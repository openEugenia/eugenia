/** Recherche plein texte avec filtres par type, étiquette, visibilité et maîtrise (§9.2, vue 9). */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ancestors, pageIndexPaths } from "@openeugenia/core";
import { MasteryMeter } from "../components/charts.tsx";
import { TypeIcon, VisibilityBadge } from "../components/common.tsx";
import { currentMastery, dayNumber } from "@openeugenia/core";
import { plural } from "../lib/format.ts";
import { useDerived, useIsOwner } from "../lib/hooks.ts";
import { href, navigate } from "../lib/router.ts";
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
  const results = useMemo(() => {
    const threshold = derived.config.mastery.reminder_threshold;
    const candidates = text
      ? index.idx.search(text).map((r) => ({ id: r.id as string, terms: r.terms }))
      : [...derived.tree.nodes.values()].map((n) => ({ id: n.id, terms: [] as string[] }));
    return candidates
      .map((r) => ({ ...r, node: derived.tree.nodes.get(r.id)! }))
      .filter((r) => r.node && matchesFilters(r.node, effective, derived.mastery, threshold))
      .slice(0, 80);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, text, JSON.stringify(effective), derived]);

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
          placeholder="Mots, ou #étiquette"
          aria-label="Recherche"
          autoFocus
        />
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
            <option value="note">Notes</option>
            <option value="flashcard">Connaissances atomiques</option>
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
      <section className="section">
        {!text && !anyFilter ? (
          <p className="muted">Saisissez des mots ou choisissez un filtre.</p>
        ) : (
          <>
            <p className="muted small">{plural(results.length, "résultat")}</p>
            <ul className="link-list">
              {results.map(({ node, terms }) => {
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
