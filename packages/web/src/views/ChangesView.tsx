/** Modifications en attente, enregistrement (commit), file hors ligne et conflits (§9.3, §10.3). */
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
  if (change.kind === "delete") return "suppression";
  if (change.kind === "copy") return "déplacement";
  return change.baseSha === null ? "ajout" : "modification";
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
        Ce fichier a été modifié ici et à distance.{" "}
        {conflict.local === null
          ? "Vous l'avez supprimé localement."
          : conflict.remote === null
            ? "Il a été supprimé à distance."
            : "Comparez les deux versions : à gauche la vôtre (modifiable), à droite celle du dépôt."}
      </p>
      {mergeable && <div className="merge-host cm-host" ref={host} />}
      <div className="actions actions--start">
        <button
          type="button"
          className="oe-button oe-button--secondary oe-button--sm"
          onClick={() => void resolve(conflict.path, { kind: "local" })}
        >
          Garder ma version
        </button>
        <button
          type="button"
          className="oe-button oe-button--secondary oe-button--sm"
          onClick={() => void resolve(conflict.path, { kind: "remote" })}
        >
          Garder la version du dépôt
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
            Enregistrer la fusion (à gauche)
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
        <h1>Modifications</h1>
        <InfoBox>
          Vous consultez la partie publique de ce wiki : la lecture seule ne produit pas de
          modification.
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
      title: "Annuler toutes les modifications",
      body: "Toutes les modifications non enregistrées dans le dépôt seront perdues.",
      confirmLabel: "Tout annuler",
      danger: true,
    });
    if (ok) await discard(uncommitted);
  };

  return (
    <div className="page">
      <h1>Modifications</h1>
      <p className="muted">
        {online ? (
          "En ligne."
        ) : (
          <>
            <CloudOff aria-hidden="true" style={{ display: "inline", verticalAlign: "-0.15em" }} />{" "}
            Hors ligne : vos modifications sont conservées sur cet appareil et seront envoyées au
            retour du réseau.
          </>
        )}{" "}
        {pending.lastSyncAt && `Dernière synchronisation ${formatRelative(pending.lastSyncAt)}.`}
      </p>
      {!resolved?.canWrite && (
        <InfoBox kind="warning">
          {resolved?.readOnlyReason ?? "Écriture impossible dans ce dépôt."}
        </InfoBox>
      )}
      {pending.lastError && (
        <InfoBox kind="warning" title="Dernière erreur de synchronisation">
          {pending.lastError}
        </InfoBox>
      )}

      {pending.conflicts.length > 0 && (
        <section className="section">
          <h2>Conflits à résoudre</h2>
          <p className="muted small">
            Rien n'est résolu automatiquement : choisissez, nœud par nœud, la version à garder.
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
          <h2>À enregistrer</h2>
          {uncommitted.length > 0 && (
            <button
              type="button"
              className="oe-button oe-button--ghost oe-button--sm"
              onClick={() => void discardAll()}
            >
              <RotateCcw aria-hidden="true" /> Tout annuler
            </button>
          )}
        </div>
        {uncommitted.length === 0 ? (
          <EmptyState title="Aucune modification en attente">
            Les pages que vous modifiez apparaissent ici avant d'être enregistrées dans le dépôt, en
            un seul commit.
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
                      <summary className="small">{entry.paths.length} fichier(s)</summary>
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
                                Annuler
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
                Message du commit
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
                {online ? "Enregistrer dans le dépôt" : "Mettre en file (hors ligne)"}
              </button>
            </div>
          </>
        )}
      </section>

      {pending.queue.length > 0 && (
        <section className="section">
          <div className="section__head">
            <h2>En file d'attente</h2>
            <button
              type="button"
              className="oe-button oe-button--ghost oe-button--sm"
              disabled={!online || syncing}
              onClick={() => void flush()}
            >
              <Upload aria-hidden="true" /> Envoyer maintenant
            </button>
          </div>
          <ul className="link-list">
            {pending.queue.map((c) => (
              <li key={c.id}>
                <GitCommitHorizontal aria-hidden="true" /> {c.message.split("\n")[0]}{" "}
                <span className="muted small">
                  ({c.paths.length} fichier(s), {formatRelative(c.createdAt)})
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
          <RefreshCw aria-hidden="true" /> Récupérer l'état du dépôt
        </button>
      </section>
    </div>
  );
}
