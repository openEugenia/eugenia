/**
 * Indexes of the sources (§8.6): the state of the index of each source of the library, and their
 * indexing in the background, with the model of the settings or another preset. The user keeps
 * browsing while the sources are indexed; the progress shows in the app bar.
 */
import { useEffect, useMemo, useState } from "react";
import { ListTree, Play, RefreshCw, Square } from "lucide-react";
import {
  hierarchyAncestors,
  librarySources,
  sourceIndexState,
  type SourceIndexState,
} from "@openeugenia/core";
import { DEFAULT_INDEX_PRESET, INDEX_MODEL_PRESETS } from "@openeugenia/ai/constants";
import {
  EmptyState,
  InfoBox,
  SourceKindIcon,
  Spinner,
  VisibilityBadge,
} from "../components/common.tsx";
import { INDEX_STATUS_LABELS, IndexingProgress } from "../components/SourcePanels.tsx";
import { formatDate, plural } from "../lib/format.ts";
import { useCanEdit, useDerived, useIsOwner } from "../lib/hooks.ts";
import { cancelIndexing, queueIndexing, useIndexing } from "../lib/indexing.ts";
import { href } from "../lib/router.ts";
import { CUSTOM_INDEX_PRESET, hasIndexing } from "../lib/settings.ts";
import { useSettings } from "../store/settings.ts";
import { useWiki } from "../store/wiki.ts";

export function IndexesView() {
  const derived = useDerived();
  const owner = useIsOwner();
  const editable = useCanEdit();
  const workspace = useWiki((s) => s.workspace);
  const version = useWiki((s) => s.version);
  const settings = useSettings((s) => s.settings);
  const jobs = useIndexing((s) => s.jobs);
  const finished = useIndexing((s) => s.finished);
  const [preset, setPreset] = useState(settings.ai.indexingPreset ?? DEFAULT_INDEX_PRESET);
  const [states, setStates] = useState<Map<string, SourceIndexState> | null>(null);
  const sources = useMemo(
    () =>
      librarySources(derived.tree)
        .filter((s) => !s.virtual)
        .sort((a, b) => a.title.localeCompare(b.title, "en")),
    [derived.tree],
  );

  useEffect(() => {
    if (!workspace) return;
    let cancelled = false;
    const files = sources.flatMap((s) => {
      const page = derived.files.get(s.indexPath);
      return [...(page ? [page] : []), ...(s.sourceIndex?.root ? [s.sourceIndex.root] : [])];
    });
    void workspace
      .prefetch(files)
      .then(() => Promise.all(sources.map((s) => sourceIndexState(workspace, s))))
      .then(
        (list) => !cancelled && setStates(new Map(list.map((st) => [st.node.id, st]))),
        () => !cancelled && setStates(new Map()),
      );
    return () => {
      cancelled = true;
    };
  }, [workspace, sources, derived.files, version]);

  if (!owner) {
    return (
      <div className="page">
        <InfoBox>The indexes are managed in your own wiki, opened with your token.</InfoBox>
      </div>
    );
  }
  const configured = hasIndexing(settings);
  const todo = states
    ? sources.filter((s) => states.get(s.id)?.status !== "current" && !jobs[s.id])
    : [];
  const pending = Object.values(jobs);
  const presets = [
    ...INDEX_MODEL_PRESETS.map((p) => ({ id: p.id, label: p.label, description: p.description })),
    ...(settings.ai.indexingPreset === CUSTOM_INDEX_PRESET
      ? [
          {
            id: CUSTOM_INDEX_PRESET,
            label: `${settings.ai.indexing?.model ?? "Another model"}`,
            description: "",
          },
        ]
      : []),
  ];
  const chosen = presets.find((p) => p.id === preset);

  return (
    <div className="page page--wide">
      <header className="section__head">
        <div>
          <h1>Indexes of the sources</h1>
          <p className="muted">
            Each source is read once by a model and described as a tree of knowledge, browsed like
            your wiki, with the knowledge worth extracting. Eugenia answers your questions from
            these indexes. Indexing runs in the background: you can keep browsing.
          </p>
        </div>
      </header>

      {!configured ? (
        <InfoBox>
          Add a Mistral key in the <a href={href({ name: "settings" })}>settings</a> to index your
          sources.
        </InfoBox>
      ) : (
        editable && (
          <div className="filters section">
            <div className="filters__row">
              <label className="oe-field" style={{ minWidth: "18rem" }}>
                <span className="oe-label">Model</span>
                <select
                  className="oe-select"
                  value={preset}
                  onChange={(e) => setPreset(e.target.value)}
                  aria-label="Indexing model"
                >
                  {presets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                {chosen?.description && <span className="oe-help">{chosen.description}</span>}
              </label>
              <div className="actions actions--start">
                <button
                  type="button"
                  className="oe-button"
                  disabled={todo.length === 0}
                  onClick={() =>
                    queueIndexing(
                      todo.map((s) => s.id),
                      preset,
                    )
                  }
                >
                  <Play aria-hidden="true" /> Index {plural(todo.length, "source")}
                </button>
                {pending.length > 0 && (
                  <button
                    type="button"
                    className="oe-button oe-button--secondary"
                    onClick={() => cancelIndexing()}
                  >
                    <Square aria-hidden="true" /> Stop
                  </button>
                )}
              </div>
            </div>
            {pending.length > 0 && (
              <p className="small" style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                <Spinner small label="Indexing" /> {finished} of {finished + pending.length} sources
                indexed — keep browsing, the indexing goes on.
              </p>
            )}
          </div>
        )
      )}

      {sources.length === 0 ? (
        <EmptyState icon={<ListTree aria-hidden="true" />} title="No source to index">
          Add the books, articles and websites your knowledge comes from to your library.
        </EmptyState>
      ) : !states ? (
        <Spinner label="Reading the indexes" />
      ) : (
        <ul className="library-list">
          {sources.map((s) => {
            const state = states.get(s.id);
            const filed = s.filedIn ? derived.tree.nodes.get(s.filedIn) : undefined;
            const place =
              filed && filed.id !== derived.tree.rootId
                ? [...hierarchyAncestors(derived.tree, filed).slice(1), filed]
                    .map((c) => c.title)
                    .join(" › ")
                : "Not filed yet";
            return (
              <li key={s.id}>
                <div className="library-item oe-card">
                  <span className="library-item__icon">
                    <SourceKindIcon kind={s.sourceKind} />
                  </span>
                  <span className="library-item__main">
                    <a className="library-item__title" href={href({ name: "node", id: s.id })}>
                      {s.title}
                    </a>
                    <span className="library-item__meta">{place}</span>
                    <span className="library-item__meta">
                      {jobs[s.id] ? (
                        <IndexingProgress sourceId={s.id} />
                      ) : state ? (
                        <>
                          <span className={`index-status index-status--${state.status}`}>
                            {INDEX_STATUS_LABELS[state.status]}
                          </span>
                          {state.meta?.generated
                            ? ` · ${formatDate(state.meta.generated)}, ${state.meta.model}`
                            : ""}
                          {` · ${plural(state.text.length, "character")}`}
                        </>
                      ) : null}
                    </span>
                  </span>
                  <span className="library-item__side">
                    <VisibilityBadge visibility={s.isPublic ? "public" : "private"} compact />
                    {editable && configured && !jobs[s.id] && (
                      <button
                        type="button"
                        className="oe-button oe-button--ghost oe-button--sm"
                        onClick={() => queueIndexing([s.id], preset)}
                      >
                        <RefreshCw aria-hidden="true" />{" "}
                        {state?.status === "current" ? "Index again" : "Index"}
                      </button>
                    )}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
