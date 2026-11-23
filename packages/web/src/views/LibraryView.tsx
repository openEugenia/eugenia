/**
 * Library: the sources the knowledge comes from (books, articles, websites, PDFs…), with
 * filters. Each source is filed in a category of the wiki (common hierarchy) and shows the
 * knowledge items that cite it.
 */
import { useMemo, useState } from "react";
import { FileUp, Library, ListTree, Plus, Search } from "lucide-react";
import {
  hierarchyAncestors,
  isCategory,
  isInBranch,
  librarySources,
  SOURCE_KINDS,
  type SourceKind,
  type WikiNode,
} from "@openeugenia/core";
import {
  EmptyState,
  RecordBadge,
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

/** Filter value of the sources not filed in a category yet. */
const UNFILED = "unfiled";

export function LibraryView({
  kind,
  q,
  category,
}: {
  kind?: SourceKind;
  q?: string;
  category?: string;
}) {
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
  const rootId = derived.tree.rootId;
  const placeOf = (s: WikiNode): WikiNode[] => {
    const filed = s.filedIn ? derived.tree.nodes.get(s.filedIn) : undefined;
    return filed && filed.id !== rootId
      ? [...hierarchyAncestors(derived.tree, filed).filter((a) => a.id !== rootId), filed]
      : [];
  };
  // Categories holding sources (in their branch), for the filter.
  const categories = useMemo(() => {
    const ids = new Set<string>();
    for (const s of sources) for (const c of placeOf(s)) ids.add(c.id);
    return [...derived.tree.nodes.values()]
      .filter((n) => ids.has(n.id) && isCategory(n))
      .map((n) => ({
        id: n.id,
        label: [...hierarchyAncestors(derived.tree, n).filter((a) => a.id !== rootId), n]
          .map((a) => a.title)
          .join(" › "),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "en"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources, derived.tree]);
  const unfiledCount = sources.filter((s) => placeOf(s).length === 0).length;

  const visible = useMemo(() => {
    const words = normalizeTerm(query.trim()).split(/\s+/).filter(Boolean);
    const list = sources.filter((s) => {
      if (kind && (s.sourceKind ?? "other") !== kind) return false;
      if (category === UNFILED && placeOf(s).length > 0) return false;
      if (category && category !== UNFILED && !isInBranch(derived.tree, category, s)) return false;
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
        ? a.title.localeCompare(b.title, "en")
        : sort === "used"
          ? uses(b) - uses(a) || a.title.localeCompare(b.title, "en")
          : recent(b).localeCompare(recent(a)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources, kind, tag, query, sort, category, derived.knowledgeBySource]);

  const setKind = (next: SourceKind | undefined): void =>
    navigate(
      {
        name: "library",
        ...(next ? { kind: next } : {}),
        ...(query ? { q: query } : {}),
        ...(category ? { category } : {}),
      },
      { replace: true },
    );
  const setCategory = (next: string): void =>
    navigate(
      {
        name: "library",
        ...(kind ? { kind } : {}),
        ...(query ? { q: query } : {}),
        ...(next ? { category: next } : {}),
      },
      { replace: true },
    );

  return (
    <div className="page page--wide">
      <header className="section__head">
        <div>
          <h1>Library</h1>
          <p className="muted">
            The sources of your knowledge: books, articles, websites, videos, documents. Each one is
            filed in a category of your wiki, and the atomic knowledge items point to them.
            {!owner &&
              " Private sources only show their bibliographic record (title, kind, authors, date, URL)."}
          </p>
        </div>
        {editable && (
          <div className="actions">
            <a
              className="oe-button"
              href={href({
                name: "new",
                parentId: derived.tree.libraryId,
                type: "source",
                ...(category && category !== UNFILED ? { category } : {}),
              })}
            >
              <Plus aria-hidden="true" /> Add a source
            </a>
            <a className="oe-button oe-button--secondary" href={href({ name: "extract" })}>
              <FileUp aria-hidden="true" /> Import a text or a PDF
            </a>
            <a className="oe-button oe-button--secondary" href={href({ name: "tasks" })}>
              <ListTree aria-hidden="true" /> Indexes
            </a>
          </div>
        )}
      </header>

      {owner && unsourced.length > 0 && (
        <div className="oe-alert oe-alert--warning section">
          <strong className="oe-alert__title">
            {plural(unsourced.length, "knowledge item")} needing a source
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
            placeholder="Title, author, URL, tag…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search the library"
          />
        </label>
        <div className="chips" role="group" aria-label="Kind">
          <button
            type="button"
            className={`chip${kind ? "" : " is-active"}`}
            aria-pressed={!kind}
            onClick={() => setKind(undefined)}
          >
            All <span className="chip__count">{counts.get("all") ?? 0}</span>
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
          {(categories.length > 0 || unfiledCount > 0) && (
            <select
              className="oe-select"
              value={category ?? ""}
              onChange={(e) => setCategory(e.target.value)}
              aria-label="Category"
            >
              <option value="">All categories</option>
              {unfiledCount > 0 && <option value={UNFILED}>Not filed yet ({unfiledCount})</option>}
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          )}
          {tags.length > 0 && (
            <select
              className="oe-select"
              value={tag ?? ""}
              onChange={(e) => setTag(e.target.value || null)}
              aria-label="Tag"
            >
              <option value="">All tags</option>
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
            aria-label="Sort"
          >
            <option value="recent">Recently added</option>
            <option value="title">By title</option>
            <option value="used">Most cited</option>
          </select>
        </div>
      </div>

      {sources.length === 0 ? (
        <EmptyState icon={<Library aria-hidden="true" />} title="Your library is empty">
          Add the books, articles and websites your knowledge comes from, or import a text or a PDF
          to extract from it directly.
        </EmptyState>
      ) : visible.length === 0 ? (
        <p className="muted">No source matches these filters.</p>
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
                    <span className="library-item__meta">
                      {placeOf(s).length > 0
                        ? `In ${placeOf(s)
                            .map((c) => c.title)
                            .join(" › ")}`
                        : "Not filed in a category yet"}
                      {s.sourceIndex?.root && (
                        <>
                          {" · "}
                          <ListTree aria-hidden="true" className="inline-icon" /> indexed
                        </>
                      )}
                    </span>
                    {s.description && <span className="library-item__text">{s.description}</span>}
                  </span>
                  <span className="library-item__side">
                    <span className={count > 0 ? "" : "muted"}>
                      {plural(count, "knowledge item")}
                    </span>
                    {owner && (
                      <VisibilityBadge visibility={s.isPublic ? "public" : "private"} compact />
                    )}
                    {!owner && !s.isPublic && <RecordBadge compact />}
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
