/**
 * Eugenia's tasks (§8.6, §11.2): what she does in the background while the user keeps browsing
 * — the indexing of the sources and the re-evaluation of the stale sub-wiki descriptions —, the
 * tasks waiting or running, and the work there is to do. Each task is saved as soon as it is
 * done, without asking node by node.
 */
import { useEffect, useMemo, useState } from "react";
import { FileText, ListTree, Play, RefreshCw, Square } from "lucide-react";
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
import { queueIndexing } from "../lib/indexing.ts";
import { href } from "../lib/router.ts";
import { CUSTOM_INDEX_PRESET, hasAI, hasIndexing } from "../lib/settings.ts";
import {
  cancelTasks,
  queueDescriptions,
  staleDescriptions,
  useTasks,
  type Task,
} from "../lib/tasks.ts";
import { useSettings } from "../store/settings.ts";
import { useWiki } from "../store/wiki.ts";

function TaskLine({ task }: { task: Task }) {
  return (
    <li>
      {task.kind === "index" ? <ListTree aria-hidden="true" /> : <FileText aria-hidden="true" />}
      <span>
        {task.kind === "index" ? "Index of " : "Description of "}
        <a href={href({ name: "node", id: task.nodeId })}>{task.title}</a>
        {task.scope === "public" ? " (public)" : ""}
      </span>
      {task.kind === "index" ? (
        <IndexingProgress sourceId={task.nodeId} />
      ) : (
        <span className="indexing-progress small">
          {task.status === "running" ? (
            <>
              <Spinner small label="Writing" /> Eugenia is writing it…
            </>
          ) : (
            "Waiting…"
          )}
          <button
            type="button"
            className="oe-button oe-button--ghost oe-button--sm"
            onClick={() => cancelTasks({ key: task.key })}
          >
            <Square aria-hidden="true" /> Stop
          </button>
        </span>
      )}
    </li>
  );
}

export function TasksView() {
  const derived = useDerived();
  const owner = useIsOwner();
  const editable = useCanEdit();
  const workspace = useWiki((s) => s.workspace);
  const version = useWiki((s) => s.version);
  const settings = useSettings((s) => s.settings);
  const tasks = useTasks((s) => s.tasks);
  const finished = useTasks((s) => s.finished);
  const [preset, setPreset] = useState(settings.ai.indexingPreset ?? DEFAULT_INDEX_PRESET);
  const [states, setStates] = useState<Map<string, SourceIndexState> | null>(null);
  const sources = useMemo(
    () =>
      librarySources(derived.tree)
        .filter((s) => !s.virtual)
        .sort((a, b) => a.title.localeCompare(b.title, "en")),
    [derived.tree],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const descriptions = useMemo(() => staleDescriptions(), [derived]);

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
        <InfoBox>Eugenia's tasks run in your own wiki, opened with your token.</InfoBox>
      </div>
    );
  }
  const configured = hasIndexing(settings);
  const list = Object.values(tasks);
  const todo = states
    ? sources.filter((s) => states.get(s.id)?.status !== "current" && !tasks[s.id])
    : [];
  const presets = [
    ...INDEX_MODEL_PRESETS.map((p) => ({ id: p.id, label: p.label, description: p.description })),
    ...(settings.ai.indexingPreset === CUSTOM_INDEX_PRESET
      ? [
          {
            id: CUSTOM_INDEX_PRESET,
            label: settings.ai.indexing?.model ?? "Another model",
            description: "",
          },
        ]
      : []),
  ];
  const chosen = presets.find((p) => p.id === preset);
  const waitingDescriptions = descriptions.filter((d) => !tasks[`summary:${d.nodeId}:${d.scope}`]);

  return (
    <div className="page page--wide">
      <header className="section__head">
        <div>
          <h1>Eugenia's tasks</h1>
          <p className="muted">
            Eugenia works in the background while you browse: she indexes your sources and keeps the
            descriptions of your sub-wikis up to date. Each result is saved as soon as it is done,
            without asking you for each one.
          </p>
        </div>
      </header>

      <section className="section">
        <div className="section__head">
          <h2>In progress</h2>
          {list.length > 0 && (
            <button
              type="button"
              className="oe-button oe-button--secondary oe-button--sm"
              onClick={() => cancelTasks()}
            >
              <Square aria-hidden="true" /> Stop everything
            </button>
          )}
        </div>
        {list.length === 0 ? (
          <p className="muted small">Nothing running: Eugenia is waiting.</p>
        ) : (
          <>
            <p className="small">
              {finished} of {finished + list.length} task(s) done — keep browsing, the work goes on.
            </p>
            <ul className="link-list task-list">
              {list.map((task) => (
                <TaskLine key={task.key} task={task} />
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="section">
        <div className="section__head">
          <h2>Descriptions to re-evaluate</h2>
          {editable && hasAI(settings) && waitingDescriptions.length > 0 && (
            <button
              type="button"
              className="oe-button oe-button--sm"
              onClick={() => queueDescriptions()}
            >
              <Play aria-hidden="true" /> Re-evaluate{" "}
              {plural(waitingDescriptions.length, "description")}
            </button>
          )}
        </div>
        {descriptions.length === 0 ? (
          <p className="muted small">Every description of your sub-wikis is up to date.</p>
        ) : (
          <>
            <p className="muted small">
              The content of these sub-wikis changed since they were described. Eugenia describes
              them again from the deepest one to the root, and saves each description right away.
              {settings.ai.autoSummarize === false
                ? " Automatic re-evaluation is off in the settings."
                : " She does it on her own when your changes are saved."}
              {!hasAI(settings) && " Set up an AI provider in the settings first."}
            </p>
            <ul className="link-list">
              {descriptions.slice(0, 20).map((d) => (
                <li key={`${d.nodeId}-${d.scope}`}>
                  <FileText aria-hidden="true" />
                  <a href={href({ name: "node", id: d.nodeId })}>{d.title}</a>
                  <span className="muted small">
                    {d.scope === "public" ? "public description" : "private description"}
                  </span>
                </li>
              ))}
            </ul>
            {descriptions.length > 20 && (
              <p className="muted small">And {plural(descriptions.length - 20, "other")}.</p>
            )}
          </>
        )}
      </section>

      <section className="section">
        <div className="section__head">
          <h2>Indexes of the sources</h2>
        </div>
        <p className="muted small">
          Each source is read once by a model and described as a tree of knowledge, browsed like
          your wiki, with the knowledge worth extracting, which you add to your wiki when you wish.
          Eugenia answers your questions from these indexes.
        </p>
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
                </div>
              </div>
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
                        {tasks[s.id] ? (
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
                      {editable && configured && !tasks[s.id] && (
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
      </section>
    </div>
  );
}
