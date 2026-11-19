/**
 * Bibliothèque : les sources d'où viennent les connaissances (livres, articles, sites, PDF…),
 * en liste plate avec filtres. Chaque source indique les connaissances qui la citent.
 */
import { useMemo, useState } from "react";
import { FileUp, Library, Plus, Search } from "lucide-react";
import { librarySources, SOURCE_KINDS, type SourceKind, type WikiNode } from "@openeugenia/core";
import {
  EmptyState,
  SOURCE_KIND_LABELS,
  SourceKindIcon,
  UnsourcedBadge,
  VisibilityBadge,
} from "../components/common.tsx";
import { formatDate, plural } from "../lib/format.ts";
import { useCanEdit, useDerived, useIsOwner } from "../lib/hooks.ts";
import { href, navigate } from "../lib/router.ts";
import { normalizeTerm } from "../lib/text.ts";

type Sort = "recent" | "title" | "used";

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

export function LibraryView({ kind, q }: { kind?: SourceKind; q?: string }) {
  const derived = useDerived();
  const owner = useIsOwner();
  const editable = useCanEdit();
  const [query, setQuery] = useState(q ?? "");
  const [tag, setTag] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("recent");
  const sources = useMemo(() => librarySources(derived.tree), [derived.tree]);
  const uses = (n: WikiNode): number => derived.knowledgeBySource.get(n.id)?.length ?? 0;
  const unsourced = useMemo(
    () => [...derived.tree.nodes.values()].filter((n) => n.type === "knowledge" && !n.sourced),
    [derived.tree],
  );

  const counts = useMemo(() => {
    const out = new Map<SourceKind | "all", number>([["all", sources.length]]);
    for (const s of sources) {
      const k = s.sourceKind ?? "other";
      out.set(k, (out.get(k) ?? 0) + 1);
    }
    return out;
  }, [sources]);
  const tags = useMemo(
    () => [...new Set(sources.flatMap((s) => s.tags))].sort((a, b) => a.localeCompare(b, "fr")),
    [sources],
  );

  const visible = useMemo(() => {
    const words = normalizeTerm(query.trim()).split(/\s+/).filter(Boolean);
    const list = sources.filter((s) => {
      if (kind && (s.sourceKind ?? "other") !== kind) return false;
      if (tag && !s.tags.includes(tag)) return false;
      if (words.length === 0) return true;
      const haystack = normalizeTerm(
        [s.title, s.authors.join(" "), s.description ?? "", s.url ?? "", s.tags.join(" ")].join(
          " ",
        ),
      );
      return words.every((w) => haystack.includes(w));
    });
    const recent = (n: WikiNode): string => n.created ?? n.updated ?? "";
    return list.sort((a, b) =>
      sort === "title"
        ? a.title.localeCompare(b.title, "fr")
        : sort === "used"
          ? uses(b) - uses(a) || a.title.localeCompare(b.title, "fr")
          : recent(b).localeCompare(recent(a)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources, kind, tag, query, sort, derived.knowledgeBySource]);

  const setKind = (next: SourceKind | undefined): void =>
    navigate(
      { name: "library", ...(next ? { kind: next } : {}), ...(query ? { q: query } : {}) },
      { replace: true },
    );

  return (
    <div className="page page--wide">
      <header className="section__head">
        <div>
          <h1>Bibliothèque</h1>
          <p className="muted">
            Les sources de vos connaissances : livres, articles, sites, vidéos, documents. Chaque
            connaissance atomique du wiki y renvoie.
          </p>
        </div>
        {editable && (
          <div className="actions">
            <a
              className="oe-button"
              href={href({ name: "new", parentId: derived.tree.libraryId, type: "source" })}
            >
              <Plus aria-hidden="true" /> Ajouter une source
            </a>
            <a className="oe-button oe-button--secondary" href={href({ name: "extract" })}>
              <FileUp aria-hidden="true" /> Importer un texte ou un PDF
            </a>
          </div>
        )}
      </header>

      {owner && unsourced.length > 0 && (
        <div className="oe-alert oe-alert--warning section">
          <strong className="oe-alert__title">
            {plural(unsourced.length, "connaissance")} à sourcer
          </strong>
          <ul className="link-list">
            {unsourced.slice(0, 6).map((k) => (
              <li key={k.id}>
                <UnsourcedBadge compact />
                <a href={href({ name: "node", id: k.id })}>{k.title}</a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="filters section">
        <label className="search-field">
          <Search aria-hidden="true" />
          <input
            className="oe-input"
            type="search"
            placeholder="Titre, auteur, adresse, étiquette…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Rechercher dans la bibliothèque"
          />
        </label>
        <div className="chips" role="group" aria-label="Nature">
          <button
            type="button"
            className={`chip${kind ? "" : " is-active"}`}
            aria-pressed={!kind}
            onClick={() => setKind(undefined)}
          >
            Toutes <span className="chip__count">{counts.get("all") ?? 0}</span>
          </button>
          {SOURCE_KINDS.filter((k) => counts.get(k)).map((k) => (
            <button
              key={k}
              type="button"
              className={`chip${kind === k ? " is-active" : ""}`}
              aria-pressed={kind === k}
              onClick={() => setKind(kind === k ? undefined : k)}
            >
              <SourceKindIcon kind={k} /> {SOURCE_KIND_LABELS[k]}{" "}
              <span className="chip__count">{counts.get(k)}</span>
            </button>
          ))}
        </div>
        <div className="filters__row">
          {tags.length > 0 && (
            <select
              className="oe-select"
              value={tag ?? ""}
              onChange={(e) => setTag(e.target.value || null)}
              aria-label="Étiquette"
            >
              <option value="">Toutes les étiquettes</option>
              {tags.map((t) => (
                <option key={t} value={t}>
                  #{t}
                </option>
              ))}
            </select>
          )}
          <select
            className="oe-select"
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            aria-label="Tri"
          >
            <option value="recent">Ajoutées récemment</option>
            <option value="title">Par titre</option>
            <option value="used">Les plus citées</option>
          </select>
        </div>
      </div>

      {sources.length === 0 ? (
        <EmptyState icon={<Library aria-hidden="true" />} title="Votre bibliothèque est vide">
          Ajoutez les livres, articles et sites d'où viennent vos connaissances, ou importez un
          texte ou un PDF pour en extraire directement.
        </EmptyState>
      ) : visible.length === 0 ? (
        <p className="muted">Aucune source ne correspond à ces filtres.</p>
      ) : (
        <ul className="library-list">
          {visible.map((s) => {
            const host = hostOf(s.url);
            const count = uses(s);
            return (
              <li key={s.id}>
                <a className="library-item oe-card" href={href({ name: "node", id: s.id })}>
                  <span className="library-item__icon">
                    <SourceKindIcon kind={s.sourceKind} />
                  </span>
                  <span className="library-item__main">
                    <span className="library-item__title">{s.title}</span>
                    <span className="library-item__meta">
                      {[
                        SOURCE_KIND_LABELS[s.sourceKind ?? "other"],
                        s.authors.join(", "),
                        s.published,
                        host,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {s.description && <span className="library-item__text">{s.description}</span>}
                  </span>
                  <span className="library-item__side">
                    <span className={count > 0 ? "" : "muted"}>
                      {plural(count, "connaissance")}
                    </span>
                    {owner && (
                      <VisibilityBadge visibility={s.isPublic ? "public" : "private"} compact />
                    )}
                    {s.created && <span className="muted small">{formatDate(s.created)}</span>}
                  </span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
