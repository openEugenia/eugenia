/**
 * Full-text search with filters by type, tag, visibility and mastery (§9.2, view 9), and, for
 * the owner, search by meaning across the common hierarchy (§14): pages, discussions and the
 * sections of the source indexes.
 */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ListTree, Sparkles } from "lucide-react";
import { ancestors, pageIndexPaths, type SimilarityHit } from "@openeugenia/core";
import { MasteryMeter } from "../components/charts.tsx";
import {
  DiscussionKindIcon,
  InfoBox,
  Spinner,
  TypeIcon,
  VisibilityBadge,
} from "../components/common.tsx";
import { currentMastery, dayNumber } from "@openeugenia/core";
import { formatPercent, plural } from "../lib/format.ts";
import { useCanEdit, useDerived, useIsOwner } from "../lib/hooks.ts";
import { href, navigate } from "../lib/router.ts";
import {
  indexEmbeddings,
  loadSemanticIndex,
  pendingItems,
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

  // When reading the public part, contents are loaded in the background for the index.
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

  // Search by meaning: embeddings of the wiki, reloaded after each change.
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

  const pending = semantic ? pendingItems(semantic) : [];
  const indexed = semantic ? semantic.items.filter((e) => e.vector).length : 0;
  // The query is sent to the embedding provider once typing is over.
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

  // By meaning, the closest elements also include sections of source indexes and discussions.
  const elements = useMemo(() => {
    if (!meaning || !text || !hits || !semantic) return [];
    const byId = new Map(semantic.items.map((i) => [i.id, i]));
    return hits.flatMap((h) => {
      const item = byId.get(h.id);
      return item && item.kind !== "page" ? [{ ...h, item }] : [];
    });
  }, [meaning, text, hits, semantic]);

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
      const result = await indexEmbeddings(semantic, {
        onProgress: (done, total) => setIndexing({ done, total }),
      });
      toast(
        `${plural(result.indexed, "element")} indexed${
          result.skippedPrivate
            ? `; ${plural(result.skippedPrivate, "private element")} skipped (kept for a local AI)`
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
      <h1>Search</h1>
      <form className="form-grid" onSubmit={submit} role="search">
        <input
          className="oe-input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={meaning ? "A question, an idea… (search by meaning)" : "Words, or #tag"}
          aria-label="Search"
          autoFocus
        />
        {owner && (
          <fieldset className="search-mode">
            <legend className="sr-only">Kind of search</legend>
            <label className="check">
              <input
                type="radio"
                name="search-mode"
                checked={!meaning}
                onChange={() => setMode("words")}
              />
              <span>By keywords</span>
            </label>
            <label className="check">
              <input
                type="radio"
                name="search-mode"
                checked={meaning}
                onChange={() => setMode("meaning")}
              />
              <span>By meaning</span>
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
            <option value="">All types</option>
            <option value="category">Categories</option>
            <option value="knowledge">Atomic knowledge</option>
            <option value="flashcard">Flashcards</option>
            <option value="source">Sources</option>
          </select>
          <select
            className="oe-select"
            value={filters.tag ?? ""}
            onChange={(e) => setFilters((f) => ({ ...f, tag: e.target.value }))}
            aria-label="Tag"
          >
            <option value="">All tags</option>
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
              aria-label="Visibility"
            >
              <option value="">Public and private</option>
              <option value="public">Public</option>
              <option value="private">Private</option>
            </select>
          )}
          {owner && (
            <select
              className="oe-select"
              value={filters.mastery ?? ""}
              onChange={(e) =>
                setFilters((f) => ({ ...f, mastery: e.target.value as SearchFilters["mastery"] }))
              }
              aria-label="Mastery"
            >
              <option value="">Any mastery</option>
              <option value="low">To review</option>
              <option value="mid">Medium</option>
              <option value="high">Solid (≥ 70%)</option>
            </select>
          )}
        </div>
      </form>
      {meaning && !embeddingModel && (
        <InfoBox>
          Search by meaning compares your query with the meaning of your pages, thanks to their
          embeddings. Add a Mistral key in the <a href={href({ name: "settings" })}>settings</a>{" "}
          ("Semantic search") to turn it on.
        </InfoBox>
      )}
      {meaning && embeddingModel && (
        <div className="semantic-status small">
          {!semantic ? (
            <Spinner small label="Loading the semantic index" />
          ) : (
            <span className="muted">
              {indexed} / {plural(semantic.items.length, "element")} indexed (pages, discussions,
              sections of the source indexes)
              {pending.length > 0 && ` · ${plural(pending.length, "element")} to index`}
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
                ? `Indexing… ${indexing.done}/${indexing.total}`
                : `Index ${plural(pending.length, "element")}`}
            </button>
          )}
        </div>
      )}
      <section className="section">
        {!text && !anyFilter ? (
          <p className="muted">
            {meaning
              ? "Describe what you are looking for, in your own words: a question, an idea, a memory."
              : "Type words or choose a filter."}
          </p>
        ) : meaning && text && semantic && indexed === 0 ? (
          <p className="muted">No page is indexed yet: start indexing to search by meaning.</p>
        ) : meaning && text && (searching || hits === null) ? (
          <Spinner label="Searching by meaning" />
        ) : (
          <>
            <p className="muted small">{plural(results.length + elements.length, "result")}</p>

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
                        <span className="muted small" title="Closeness of meaning to the query">
                          closeness {formatPercent(score)}
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
            {elements.length > 0 && (
              <>
                <h2 className="small">In your sources and discussions</h2>
                <ul className="link-list">
                  {elements.map(({ id, score, item }) => {
                    const discussion = derived.hierarchy.discussionById.get(id);
                    const link =
                      item.kind === "section" && item.node
                        ? href({ name: "node", id: item.node.id, section: item.sectionKey! })
                        : discussion
                          ? href({ name: "discussion", path: discussion.path })
                          : undefined;
                    return (
                      <li
                        key={id}
                        style={{ flexDirection: "column", alignItems: "flex-start", gap: "0.2rem" }}
                      >
                        <span
                          style={{ display: "inline-flex", gap: "0.5rem", alignItems: "center" }}
                        >
                          {item.kind === "section" ? (
                            <ListTree aria-hidden="true" />
                          ) : (
                            <DiscussionKindIcon kind={discussion?.meta.kind ?? "discussion"} />
                          )}
                          {link ? (
                            <a href={link}>
                              <strong>{item.title}</strong>
                            </a>
                          ) : (
                            <strong>{item.title}</strong>
                          )}
                          <span className="muted small" title="Closeness of meaning to the query">
                            closeness {formatPercent(score)}
                          </span>
                        </span>
                        <span className="muted small">
                          {item.kind === "section"
                            ? `Section of the index · ${item.text.split("\n")[0]}`
                            : "Discussion"}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
