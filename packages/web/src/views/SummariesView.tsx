/**
 * Sub-wiki descriptions in semi-automatic mode (§11.2): detection of stale descriptions,
 * regeneration from the deepest to the root, review as a diff before entering the commit,
 * editing and locking.
 */
import { useMemo, useState } from "react";
import { Check, Lock, RefreshCw, SkipForward, Square } from "lucide-react";
import {
  newSummaryDocument,
  parseSummary,
  regenerationOrder,
  serializeSummary,
  summaryInvolvesPrivate,
  summaryPath,
  summarySources,
  ulid,
  type SummaryScope,
  type WikiNode,
} from "@openeugenia/core";
import { summarizeNode, summaryInputFor } from "@openeugenia/ai";
import { EmptyState, InfoBox, nodePath, SummaryStatusBadge } from "../components/common.tsx";
import { taskContext } from "../lib/ai.ts";
import { wordDiff } from "../lib/diff.ts";
import { useCanEdit, useDerived } from "../lib/hooks.ts";
import { href } from "../lib/router.ts";
import { errorMessage, toast } from "../store/ui.ts";
import { useWiki } from "../store/wiki.ts";

interface Draft {
  node: WikiNode;
  scope: SummaryScope;
  before: string;
  text: string;
  locked: boolean;
  model: string;
}

export function SummariesView({ rootId }: { rootId?: string }) {
  const derived = useDerived();
  const editable = useCanEdit();
  const [scope, setScope] = useState<SummaryScope>("private");
  const [running, setRunning] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [queue, setQueue] = useState<string[]>([]);
  const [accepted, setAccepted] = useState<string[]>([]);
  const branchId = rootId && derived.tree.nodes.has(rootId) ? rootId : derived.tree.rootId;
  const branch = derived.tree.nodes.get(branchId)!;
  const states = scope === "private" ? derived.summaryStates.private : derived.summaryStates.public;
  const plan = useMemo(
    () => regenerationOrder(derived.tree, states, branchId),
    [derived.tree, states, branchId],
  );
  const locked = [...states.entries()]
    .filter(([, s]) => s.status === "locked")
    .map(([id]) => derived.tree.nodes.get(id)!);

  /** Generates the description of the next node in the queue, with the up-to-date wiki. */
  const generate = async (ids: string[]): Promise<void> => {
    const [nextId, ...rest] = ids;
    setQueue(rest);
    if (!nextId) {
      setDraft(null);
      setRunning(false);
      return;
    }
    const { workspace, derived: current } = useWiki.getState();
    const node = current?.tree.nodes.get(nextId);
    if (!workspace || !current || !node) return generate(rest);
    setRunning(true);
    try {
      const context = await taskContext(summaryInvolvesPrivate(current.tree, node, scope));
      const input = await summaryInputFor(workspace, node.id, scope, current.summaries);
      const text = await summarizeNode(context, input);
      const file = scope === "public" ? node.summaries.public : node.summaries.private;
      const before = file ? (current.summaries.get(file.path)?.body ?? "") : "";
      setDraft({
        node,
        scope,
        before: before.trim(),
        text,
        locked: false,
        model: context.provider.info.model,
      });
    } catch (error) {
      toast(errorMessage(error), "error");
      setDraft(null);
      setQueue([]);
      setRunning(false);
    }
  };

  const start = (ids: string[]): void => {
    setAccepted([]);
    void generate(ids);
  };

  const accept = async (): Promise<void> => {
    if (!draft) return;
    const { workspace, derived: current, stage } = useWiki.getState();
    if (!workspace || !current) return;
    const node = current.tree.nodes.get(draft.node.id) ?? draft.node;
    const path = summaryPath(node, draft.scope);
    const existing = current.summaries.get(path);
    const doc = newSummaryDocument({
      id: existing?.fields.id || ulid(),
      scope: draft.scope,
      body: draft.text,
      sources: summarySources(current.tree, node, draft.scope),
      model: draft.model,
      locked: draft.locked,
    });
    await stage(
      [{ op: "write", path, content: serializeSummary(doc) }],
      `Description of "${node.title}"`,
    );
    setAccepted((list) => [...list, path]);
    // The queue is already ordered from the deepest to the root: the next parents will be
    // generated with the fingerprint of this new description.
    void generate(queue);
  };

  const commitAccepted = async (): Promise<void> => {
    await useWiki
      .getState()
      .commit(`Regenerated sub-wiki descriptions (${accepted.length})`, accepted);
    setAccepted([]);
  };

  return (
    <div className="page">
      <h1>Sub-wiki descriptions</h1>
      <p className="muted">
        Eugenia describes each sub-wiki from what it contains, from the most specific to the most
        general. A description becomes stale when one of its sources changes; it is then offered for
        regeneration, reviewed before being saved, and can be locked.
      </p>
      <div className="toolbar">
        <div role="tablist" aria-label="Scope" className="toolbar">
          {(["private", "public"] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={scope === s}
              className={`oe-button oe-button--sm ${scope === s ? "" : "oe-button--ghost"}`}
              onClick={() => setScope(s)}
              disabled={running}
            >
              {s === "private" ? "Private scope (everything)" : "Public scope"}
            </button>
          ))}
        </div>
        {branchId !== derived.tree.rootId && (
          <span className="small muted">
            Branch: {nodePath(derived.tree, branch)} ·{" "}
            <a href={href({ name: "summaries" })}>the whole wiki</a>
          </span>
        )}
      </div>
      {scope === "public" && (
        <InfoBox>
          Public descriptions are generated from the public children only: they are the only ones
          published (§6.3).
        </InfoBox>
      )}

      {draft ? (
        <section className="section oe-card oe-card--featured">
          <span className="oe-eyebrow" style={{ fontSize: "var(--oe-font-size-xs)" }}>
            Review · {queue.length} remaining
          </span>
          <h2 style={{ margin: 0 }}>{draft.node.title}</h2>
          <p className="muted small">{nodePath(derived.tree, draft.node)}</p>
          {draft.before && (
            <div>
              <span className="oe-label">Proposed changes</span>
              <p className="diff">
                {wordDiff(draft.before, draft.text).map((part, i) =>
                  part.kind === "added" ? (
                    <ins key={i}>{part.text}</ins>
                  ) : part.kind === "removed" ? (
                    <del key={i}>{part.text}</del>
                  ) : (
                    <span key={i}>{part.text}</span>
                  ),
                )}
              </p>
            </div>
          )}
          <div className="oe-field">
            <label className="oe-label" htmlFor="draft">
              New description
            </label>
            <textarea
              id="draft"
              className="oe-textarea"
              style={{ minHeight: "9rem" }}
              value={draft.text}
              onChange={(e) => setDraft({ ...draft, text: e.target.value })}
            />
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={draft.locked}
              onChange={(e) => setDraft({ ...draft, locked: e.target.checked })}
            />
            <span>
              <Lock aria-hidden="true" style={{ display: "inline", verticalAlign: "-0.15em" }} />{" "}
              Lock: no longer offer regeneration
            </span>
          </label>
          <div className="actions">
            <button
              type="button"
              className="oe-button oe-button--ghost"
              onClick={() => {
                setDraft(null);
                setQueue([]);
                setRunning(false);
              }}
            >
              <Square aria-hidden="true" /> Stop
            </button>
            <button
              type="button"
              className="oe-button oe-button--ghost"
              onClick={() => void generate(queue)}
            >
              <SkipForward aria-hidden="true" /> Skip
            </button>
            <button type="button" className="oe-button" onClick={() => void accept()}>
              <Check aria-hidden="true" /> Accept
            </button>
          </div>
        </section>
      ) : running ? (
        <section className="section oe-card">
          <p>Eugenia is writing the description…</p>
        </section>
      ) : null}

      {accepted.length > 0 && !running && (
        <section className="section oe-alert oe-alert--success">
          <strong className="oe-alert__title">{accepted.length} description(s) accepted</strong>
          <div className="actions actions--start">
            <button
              type="button"
              className="oe-button oe-button--sm"
              onClick={() => void commitAccepted()}
            >
              Save to the repository
            </button>
          </div>
        </section>
      )}

      <section className="section">
        <div className="section__head">
          <h2>
            {plan.length === 0
              ? "Everything is up to date"
              : `${plan.length} description(s) to regenerate`}
          </h2>
          {editable && plan.length > 0 && !running && (
            <button
              type="button"
              className="oe-button oe-button--sm"
              onClick={() => start(plan.map((n) => n.id))}
            >
              <RefreshCw aria-hidden="true" /> Regenerate{" "}
              {branchId === derived.tree.rootId ? "the whole wiki" : "the branch"}
            </button>
          )}
        </div>
        {plan.length === 0 ? (
          <EmptyState title="No stale description">
            The descriptions of this scope match the current content.
          </EmptyState>
        ) : (
          <ul className="link-list">
            {plan.map((node) => (
              <li key={node.id}>
                <a href={href({ name: "node", id: node.id })}>{node.title}</a>
                <SummaryStatusBadge state={states.get(node.id)} />
                <span className="muted small">{nodePath(derived.tree, node)}</span>
                {editable && !running && (
                  <button
                    type="button"
                    className="oe-button oe-button--ghost oe-button--sm"
                    onClick={() => start([node.id])}
                  >
                    Regenerate
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {locked.length > 0 && (
        <section className="section">
          <h2>Locked descriptions</h2>
          <ul className="link-list">
            {locked.map((node) => {
              const file = scope === "public" ? node.summaries.public : node.summaries.private;
              return (
                <li key={node.id}>
                  <Lock aria-hidden="true" />{" "}
                  <a href={href({ name: "node", id: node.id })}>{node.title}</a>
                  {editable && file && (
                    <button
                      type="button"
                      className="oe-button oe-button--ghost oe-button--sm"
                      onClick={() => {
                        const { workspace, stage } = useWiki.getState();
                        if (!workspace) return;
                        void workspace.readText(file.path).then((text) => {
                          const doc = parseSummary(text);
                          doc.fields.locked = false;
                          return stage(
                            [{ op: "write", path: file.path, content: serializeSummary(doc) }],
                            `Unlock the description of "${node.title}"`,
                          );
                        });
                      }}
                    >
                      Unlock
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
