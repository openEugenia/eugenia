/**
 * Descriptions des sous-wikis en mode semi-automatique (§11.2) : détection des
 * descriptions périmées, régénération des plus profondes vers la racine, relecture en
 * différence avant d'entrer dans le commit, modification et verrouillage.
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

  /** Génère la description du prochain nœud de la file, avec l'état à jour du wiki. */
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
      `Description de « ${node.title} »`,
    );
    setAccepted((list) => [...list, path]);
    // La file est déjà ordonnée des plus profonds vers la racine : les parents suivants
    // seront générés avec l'empreinte de cette nouvelle description.
    void generate(queue);
  };

  const commitAccepted = async (): Promise<void> => {
    await useWiki
      .getState()
      .commit(`Descriptions des sous-wikis régénérées (${accepted.length})`, accepted);
    setAccepted([]);
  };

  return (
    <div className="page">
      <h1>Descriptions des sous-wikis</h1>
      <p className="muted">
        Chaque sous-wiki est décrit par Eugenia à partir de ce qu'il contient, du plus fin au plus
        global. Une description devient périmée quand une de ses sources change ; elle est alors
        proposée à la régénération, relue avant d'être enregistrée, et peut être verrouillée.
      </p>
      <div className="toolbar">
        <div role="tablist" aria-label="Portée" className="toolbar">
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
              {s === "private" ? "Portée privée (tout)" : "Portée publique"}
            </button>
          ))}
        </div>
        {branchId !== derived.tree.rootId && (
          <span className="small muted">
            Branche : {nodePath(derived.tree, branch)} ·{" "}
            <a href={href({ name: "summaries" })}>tout le wiki</a>
          </span>
        )}
      </div>
      {scope === "public" && (
        <InfoBox>
          Les descriptions publiques sont générées à partir des seuls enfants publics : elles seules
          sont publiées (§6.3).
        </InfoBox>
      )}

      {draft ? (
        <section className="section oe-card oe-card--featured">
          <span className="oe-eyebrow" style={{ fontSize: "var(--oe-font-size-xs)" }}>
            Relecture · {queue.length} restante(s)
          </span>
          <h2 style={{ margin: 0 }}>{draft.node.title}</h2>
          <p className="muted small">{nodePath(derived.tree, draft.node)}</p>
          {draft.before && (
            <div>
              <span className="oe-label">Modifications proposées</span>
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
              Nouvelle description
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
              Verrouiller : ne plus proposer de régénération
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
              <Square aria-hidden="true" /> Arrêter
            </button>
            <button
              type="button"
              className="oe-button oe-button--ghost"
              onClick={() => void generate(queue)}
            >
              <SkipForward aria-hidden="true" /> Ignorer
            </button>
            <button type="button" className="oe-button" onClick={() => void accept()}>
              <Check aria-hidden="true" /> Accepter
            </button>
          </div>
        </section>
      ) : running ? (
        <section className="section oe-card">
          <p>Eugenia rédige la description…</p>
        </section>
      ) : null}

      {accepted.length > 0 && !running && (
        <section className="section oe-alert oe-alert--success">
          <strong className="oe-alert__title">{accepted.length} description(s) acceptée(s)</strong>
          <div className="actions actions--start">
            <button
              type="button"
              className="oe-button oe-button--sm"
              onClick={() => void commitAccepted()}
            >
              Enregistrer dans le dépôt
            </button>
          </div>
        </section>
      )}

      <section className="section">
        <div className="section__head">
          <h2>
            {plan.length === 0 ? "Tout est à jour" : `${plan.length} description(s) à régénérer`}
          </h2>
          {editable && plan.length > 0 && !running && (
            <button
              type="button"
              className="oe-button oe-button--sm"
              onClick={() => start(plan.map((n) => n.id))}
            >
              <RefreshCw aria-hidden="true" /> Régénérer{" "}
              {branchId === derived.tree.rootId ? "tout le wiki" : "la branche"}
            </button>
          )}
        </div>
        {plan.length === 0 ? (
          <EmptyState title="Aucune description périmée">
            Les descriptions de cette portée correspondent au contenu actuel.
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
                    Régénérer
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {locked.length > 0 && (
        <section className="section">
          <h2>Descriptions verrouillées</h2>
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
                            `Déverrouiller la description de « ${node.title} »`,
                          );
                        });
                      }}
                    >
                      Déverrouiller
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
