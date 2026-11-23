/** Pending changes, saving (commit), offline queue and conflicts (§9.3, §10.3). */
import { useEffect, useMemo, useRef, useState } from "react";
import { CloudOff, GitCommitHorizontal, RefreshCw, RotateCcw, Upload } from "lucide-react";
import { MergeView } from "@codemirror/merge";
import { EditorView } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { nodeForPath, dirname } from "@openeugenia/core";
import { EmptyState, InfoBox } from "../components/common.tsx";
import { formatDateTime, formatRelative } from "../lib/format.ts";
import { useDerived, useIsOwner } from "../lib/hooks.ts";
import {
  generatedMessage,
  uncommittedPaths,
  type Conflict,
  type PendingChange,
} from "../lib/pending.ts";
import { confirmDialog } from "../store/ui.ts";
import { useWiki } from "../store/wiki.ts";

function changeLabel(change: PendingChange): string {
  if (change.kind === "delete") return "deletion";
  if (change.kind === "copy") return "move";
  return change.baseSha === null ? "addition" : "change";
}

function ConflictPanel({ conflict }: { conflict: Conflict }) {
  const resolve = useWiki((s) => s.resolveConflict);
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<MergeView | null>(null);
  useEffect(() => {
    if (!host.current || conflict.binary || conflict.local === null || conflict.remote === null)
      return;
    view.current = new MergeView({
      a: { doc: conflict.local, extensions: [markdown(), EditorView.lineWrapping] },
      b: {
        doc: conflict.remote,
        extensions: [markdown(), EditorView.lineWrapping, EditorView.editable.of(false)],
      },
      parent: host.current,
    });
    return () => view.current?.destroy();
  }, [conflict]);
  const mergeable = !conflict.binary && conflict.local !== null && conflict.remote !== null;
  return (
    <div className="oe-card">
      <strong>{conflict.path}</strong>
      <p className="muted small">
        This file was changed here and remotely.{" "}
        {conflict.local === null
          ? "You deleted it locally."
          : conflict.remote === null
            ? "It was deleted remotely."
            : "Compare the two versions: yours on the left (editable), the repository's on the right."}
      </p>
      {mergeable && <div className="merge-host cm-host" ref={host} />}
      <div className="actions actions--start">
        <button
          type="button"
          className="oe-button oe-button--secondary oe-button--sm"
          onClick={() => void resolve(conflict.path, { kind: "local" })}
        >
          Keep my version
        </button>
        <button
          type="button"
          className="oe-button oe-button--secondary oe-button--sm"
          onClick={() => void resolve(conflict.path, { kind: "remote" })}
        >
          Keep the repository's version
        </button>
        {mergeable && (
          <button
            type="button"
            className="oe-button oe-button--sm"
            onClick={() => {
              const content = view.current?.a.state.doc.toString();
              if (content !== undefined) void resolve(conflict.path, { kind: "merged", content });
            }}
          >
            Save the merge (left)
          </button>
        )}
      </div>
    </div>
  );
}

export function ChangesView() {
  const derived = useDerived();
  const owner = useIsOwner();
  const pending = useWiki((s) => s.pending);
  const online = useWiki((s) => s.online);
  const syncing = useWiki((s) => s.syncing);
  const resolved = useWiki((s) => s.resolved);
  const { commit, flush, discard, refresh } = useWiki.getState();
  const uncommitted = uncommittedPaths(pending);
  const [message, setMessage] = useState(() => generatedMessage(pending, uncommitted));
  const [touched, setTouched] = useState(false);
  const generated = useMemo(() => generatedMessage(pending, uncommittedPaths(pending)), [pending]);
  useEffect(() => {
    if (!touched) setMessage(generated);
  }, [generated, touched]);

  if (!owner) {
    return (
      <div className="page">
        <h1>Changes</h1>
        <InfoBox>
          You are viewing the public part of this wiki: reading it does not produce any change.
        </InfoBox>
      </div>
    );
  }

  const labelFor = (path: string): string => {
    const node =
      nodeForPath(derived.tree, path) ?? nodeForPath(derived.tree, `${dirname(path)}/index.md`);
    return node ? node.title : path;
  };

  const discardAll = async (): Promise<void> => {
    const ok = await confirmDialog({
      title: "Discard all the changes",
      body: "All the changes not saved to the repository will be lost.",
      confirmLabel: "Discard all",
      danger: true,
    });
    if (ok) await discard(uncommitted);
  };

  return (
    <div className="page">
      <h1>Changes</h1>
      <p className="muted">
        {online ? (
          "Online."
        ) : (
          <>
            <CloudOff aria-hidden="true" style={{ display: "inline", verticalAlign: "-0.15em" }} />{" "}
            Offline: your changes are kept on this device and will be sent when the network is back.
          </>
        )}{" "}
        {pending.lastSyncAt && `Last synchronization ${formatRelative(pending.lastSyncAt)}.`}
      </p>
      {!resolved?.canWrite && (
        <InfoBox kind="warning">
          {resolved?.readOnlyReason ?? "Cannot write to this repository."}
        </InfoBox>
      )}
      {pending.lastError && (
        <InfoBox kind="warning" title="Last synchronization error">
          {pending.lastError}
        </InfoBox>
      )}

      {pending.conflicts.length > 0 && (
        <section className="section">
          <h2>Conflicts to resolve</h2>
          <p className="muted small">
            Nothing is resolved automatically: choose, node by node, the version to keep.
          </p>
          <div className="form-grid">
            {pending.conflicts.map((c) => (
              <ConflictPanel key={c.path} conflict={c} />
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <div className="section__head">
          <h2>To save</h2>
          {uncommitted.length > 0 && (
            <button
              type="button"
              className="oe-button oe-button--ghost oe-button--sm"
              onClick={() => void discardAll()}
            >
              <RotateCcw aria-hidden="true" /> Discard all
            </button>
          )}
        </div>
        {uncommitted.length === 0 ? (
          <EmptyState title="No pending change">
            The pages you change appear here before being saved to the repository, in a single
            commit.
          </EmptyState>
        ) : (
          <>
            <ul className="link-list">
              {pending.log
                .filter((entry) => entry.paths.some((p) => uncommitted.includes(p)))
                .map((entry) => (
                  <li key={entry.id} style={{ flexDirection: "column", alignItems: "flex-start" }}>
                    <strong>{entry.description}</strong>
                    <span className="muted small">{formatDateTime(entry.at)}</span>
                    <details>
                      <summary className="small">{entry.paths.length} file(s)</summary>
                      <ul className="small">
                        {entry.paths
                          .filter((p) => pending.changes[p])
                          .map((p) => (
                            <li key={p}>
                              {changeLabel(pending.changes[p]!)} — {labelFor(p)}{" "}
                              <span className="muted">({p})</span>{" "}
                              <button
                                type="button"
                                className="oe-button oe-button--ghost oe-button--sm"
                                onClick={() => void discard([p])}
                              >
                                Discard
                              </button>
                            </li>
                          ))}
                      </ul>
                    </details>
                  </li>
                ))}
            </ul>
            <div className="oe-field section">
              <label className="oe-label" htmlFor="message">
                Commit message
              </label>
              <textarea
                id="message"
                className="oe-textarea"
                value={message}
                onChange={(e) => {
                  setMessage(e.target.value);
                  setTouched(true);
                }}
              />
            </div>
            <div className="actions">
              <button
                type="button"
                className="oe-button"
                disabled={syncing || !resolved?.canWrite}
                onClick={() => {
                  setTouched(false);
                  void commit(message, uncommitted);
                }}
              >
                <GitCommitHorizontal aria-hidden="true" />{" "}
                {online ? "Save to the repository" : "Queue (offline)"}
              </button>
            </div>
          </>
        )}
      </section>

      {pending.queue.length > 0 && (
        <section className="section">
          <div className="section__head">
            <h2>Queued</h2>
            <button
              type="button"
              className="oe-button oe-button--ghost oe-button--sm"
              disabled={!online || syncing}
              onClick={() => void flush()}
            >
              <Upload aria-hidden="true" /> Send now
            </button>
          </div>
          <ul className="link-list">
            {pending.queue.map((c) => (
              <li key={c.id}>
                <GitCommitHorizontal aria-hidden="true" /> {c.message.split("\n")[0]}{" "}
                <span className="muted small">
                  ({c.paths.length} file(s), {formatRelative(c.createdAt)})
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="section">
        <button
          type="button"
          className="oe-button oe-button--ghost oe-button--sm"
          disabled={!online}
          onClick={() => void refresh()}
        >
          <RefreshCw aria-hidden="true" /> Fetch the repository state
        </button>
      </section>
    </div>
  );
}
