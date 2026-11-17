/** Page d'un nœud : description, contenu, enfants, rétroliens, discussions (§9.2, vues 2 et 3). */
import { useMemo, useState } from "react";
import {
  Brain,
  Eye,
  FilePlus2,
  GraduationCap,
  Highlighter,
  Link2,
  MessageCircleQuestion,
  MessageSquare,
  MoveRight,
  Paperclip,
  Pencil,
  RefreshCw,
  Shield,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  basename,
  buildBacklinks,
  dayNumber,
  dayToDate,
  flashcardsUnder,
  masteryCurve,
  parseFlashcardBody,
  parsePage,
  parseSummary,
  reminders,
  type WikiNode,
} from "@openeugenia/core";
import { CategorySuggestions } from "../components/CategorySuggestions.tsx";
import { LineChart, MasteryMeter } from "../components/charts.tsx";
import {
  Breadcrumb,
  EmptyState,
  ErrorBox,
  SummaryStatusBadge,
  TypeIcon,
  typeLabel,
  VisibilityBadge,
} from "../components/common.tsx";
import { Markdown } from "../components/Markdown.tsx";
import { NodePicker } from "../components/NodePicker.tsx";
import {
  DeleteDialog,
  moveWithConfirmation,
  VisibilityDialog,
} from "../components/NodeActions.tsx";
import {
  formatDate,
  formatDateTime,
  formatPercent,
  formatShortDate,
  plural,
} from "../lib/format.ts";
import { openAttachment, useCanEdit, useDerived, useIsOwner, useText } from "../lib/hooks.ts";
import { branchMasteryMap } from "../lib/mastery.ts";
import { href } from "../lib/router.ts";
import { toast } from "../store/ui.ts";
import { hasAI } from "../lib/settings.ts";
import { useSettings } from "../store/settings.ts";
import { useWiki } from "../store/wiki.ts";

function DiscussionTitle({ path }: { path: string }) {
  const { data } = useText(path);
  const title = useMemo(() => {
    if (!data) return basename(path).replace(/\.md$/, "");
    const match = /^title:\s*(.+)$/m.exec(data);
    return match?.[1]?.replace(/^["']|["']$/g, "") ?? basename(path);
  }, [data, path]);
  return <>{title}</>;
}

function Description({ node }: { node: WikiNode }) {
  const derived = useDerived();
  const owner = useIsOwner();
  const editable = useCanEdit();
  // En lecture publique, `_summary.md` contient la description publique.
  const file = owner
    ? (node.summaries.private ?? node.summaries.public)
    : (node.summaries.private ?? node.summaries.public);
  const { data, loading } = useText(file?.path);
  const state = owner ? derived.summaryStates.private.get(node.id) : undefined;
  if (!file && !(owner && state?.status === "missing")) return null;
  const summary = data ? parseSummary(data) : undefined;
  return (
    <section className="description oe-frame" aria-label="Description du sous-wiki">
      <div className="description__head">
        <span className="oe-eyebrow" style={{ fontSize: "var(--oe-font-size-xs)" }}>
          Description
        </span>
        <SummaryStatusBadge state={state} />
        {editable && (state?.status === "stale" || state?.status === "missing") && (
          <a
            className="oe-button oe-button--ghost oe-button--sm"
            href={href({ name: "summaries", id: node.id })}
          >
            <RefreshCw aria-hidden="true" /> {state.status === "missing" ? "Générer" : "Régénérer"}
          </a>
        )}
      </div>
      {loading && <p className="muted">Chargement…</p>}
      {summary && <Markdown text={summary.body} path={file!.path} />}
      {!file && <p className="muted">Ce sous-wiki n'a pas encore de description.</p>}
      {summary?.fields.generated && (
        <p className="muted small" style={{ marginTop: "0.5rem" }}>
          Générée le {formatDate(summary.fields.generated)}
          {summary.fields.model ? ` par ${summary.fields.model}` : ""}
        </p>
      )}
    </section>
  );
}

function FlashcardBody({ node, body }: { node: WikiNode; body: string }) {
  const derived = useDerived();
  const owner = useIsOwner();
  const [revealed, setRevealed] = useState(false);
  const card = parseFlashcardBody(body);
  const state = derived.mastery.get(node.id);
  const events = useMemo(
    () =>
      derived.quizEvents.filter((e) => e.card === node.id).sort((a, b) => a.at.localeCompare(b.at)),
    [derived.quizEvents, node.id],
  );
  const curve = useMemo(() => {
    const today = dayNumber(Date.now());
    const points = masteryCurve(
      node.created ? { id: node.id, created: node.created } : { id: node.id },
      events,
      derived.config.mastery,
      today,
    );
    return points.slice(-120).map((p) => ({ x: p.day, y: p.mastery }));
  }, [node, events, derived.config.mastery]);
  const current = curve[curve.length - 1]?.y;
  return (
    <div className="card-face">
      <div className="card-face__block oe-card">
        <span className="card-face__label">Connaissance</span>
        <Markdown
          className="prose knowledge"
          text={card.knowledge || "_(énoncé manquant)_"}
          path={node.indexPath}
        />
      </div>
      <div className="card-face__block oe-card">
        <span className="card-face__label">Question</span>
        <Markdown text={card.question || "_(question manquante)_"} path={node.indexPath} />
        <div style={{ marginTop: "0.75rem" }}>
          {revealed ? (
            <>
              <span className="card-face__label">Réponse attendue</span>
              <Markdown text={card.answer || "_(réponse manquante)_"} path={node.indexPath} />
            </>
          ) : (
            <button
              type="button"
              className="oe-button oe-button--secondary oe-button--sm"
              onClick={() => setRevealed(true)}
            >
              <Eye aria-hidden="true" /> Révéler la réponse
            </button>
          )}
        </div>
      </div>
      {(card.preamble || card.others) && (
        <Markdown
          text={[card.preamble, card.others].filter(Boolean).join("\n\n")}
          path={node.indexPath}
        />
      )}
      {owner && state && (
        <section className="oe-card" aria-label="Maîtrise">
          <div className="section__head" style={{ marginBottom: 0 }}>
            <h2 style={{ fontSize: "var(--oe-font-size-lg)" }}>Maîtrise</h2>
            <MasteryMeter value={current} threshold={derived.config.mastery.reminder_threshold} />
          </div>
          <p className="muted small">
            {state.evaluations === 0
              ? "Jamais évaluée : la maîtrise décroît depuis la création de la connaissance."
              : `${plural(state.evaluations, "évaluation")}, la dernière le ${formatDate(state.lastEvalAt)} (score ${formatPercent(state.lastScore)}). Déclin quotidien actuel : ${formatPercent(1 - state.decay, 1)}.`}
          </p>
          {curve.length > 1 && (
            <LineChart
              title="Maîtrise dans le temps"
              series={[
                { id: node.id, label: node.title, color: "var(--viz-series-1)", points: curve },
              ]}
              xFormat={(day) => formatShortDate(dayToDate(day))}
              threshold={{
                value: derived.config.mastery.reminder_threshold,
                label: "Seuil de rappel",
              }}
              height={200}
            />
          )}
          {events.length > 0 && (
            <details>
              <summary className="small">Historique des évaluations</summary>
              <table className="chart-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {[...events].reverse().map((e, i) => (
                    <tr key={`${e.at}-${i}`}>
                      <td>
                        {formatDateTime(e.at)}{" "}
                        {e.self ? <span className="muted">(auto-évaluation)</span> : null}
                      </td>
                      <td>{formatPercent(e.score)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </section>
      )}
    </div>
  );
}

export function NodeView({ id }: { id: string }) {
  const derived = useDerived();
  const owner = useIsOwner();
  const editable = useCanEdit();
  const workspace = useWiki((s) => s.workspace);
  const version = useWiki((s) => s.version);
  const node = derived.tree.nodes.get(id);
  const content = useText(node && !node.virtual ? node.indexPath : undefined);
  const settings = useSettings((s) => s.settings);
  const [dialog, setDialog] = useState<"visibility" | "delete" | "move" | null>(null);
  const branch = useMemo(
    () => branchMasteryMap(derived.tree, derived.mastery),
    [derived.tree, derived.mastery],
  );

  const backlinks = useMemo(() => {
    if (!workspace || !node) return [];
    const contents = new Map<string, string>();
    for (const n of derived.tree.nodes.values()) {
      const text = workspace.peekText(n.indexPath);
      if (text !== undefined) contents.set(n.indexPath, text);
    }
    return (buildBacklinks(derived.tree, contents).get(node.id) ?? []).map((bid) =>
      derived.tree.nodes.get(bid)!,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, node?.id, derived.tree, version]);

  if (!node) {
    return (
      <div className="page">
        <ErrorBox title="Page introuvable">Cette page n'existe pas ou plus dans ce wiki.</ErrorBox>
      </div>
    );
  }
  const doc = content.data ? parsePage(content.data) : undefined;
  const children = node.childIds.map((cid) => derived.tree.nodes.get(cid)!);
  const cards = flashcardsUnder(derived.tree, node.id);
  const extracted = [...derived.tree.nodes.values()].filter((n) => n.extractedFrom === node.id);
  const extractedFrom = node.extractedFrom ? derived.tree.nodes.get(node.extractedFrom) : undefined;
  const isRoot = node.id === derived.tree.rootId;
  const threshold = derived.config.mastery.reminder_threshold;
  const reminderGroups = isRoot && owner ? reminders(derived.tree, derived.mastery, threshold) : [];
  const quizzes = owner
    ? node.quizzes.map((file) => {
        const events = derived.quizEvents.filter((e) => e.source === file.path);
        const mean = events.length
          ? events.reduce((s, e) => s + e.score, 0) / events.length
          : undefined;
        return { file, events, mean };
      })
    : [];
  const personalFiles = new Set((doc?.fields.sources ?? []).map((s) => s.file).filter(Boolean));

  return (
    <article className="page">
      <Breadcrumb tree={derived.tree} node={node} />
      <header className="node-head">
        <div className="node-head__title">
          <h1>{node.title}</h1>
          <div className="node-head__meta">
            <span style={{ display: "inline-flex", gap: "0.35rem", alignItems: "center" }}>
              <TypeIcon node={node} tree={derived.tree} /> {typeLabel(node)}
            </span>
            {owner && <VisibilityBadge visibility={node.isPublic ? "public" : "private"} />}
            {node.tags.map((tag) => (
              <a key={tag} className="oe-badge" href={href({ name: "search", q: `#${tag}` })}>
                #{tag}
              </a>
            ))}
            {owner && branch.get(node.id)?.value !== undefined && node.type !== "flashcard" && (
              <MasteryMeter
                value={branch.get(node.id)!.value}
                threshold={threshold}
                label={`Maîtrise moyenne (${plural(branch.get(node.id)!.count, "connaissance")})`}
              />
            )}
            {node.updated && <span>Modifiée le {formatDate(node.updated)}</span>}
            {derived.pendingNodes.has(node.id) && (
              <span className="oe-badge oe-badge--warning">Non enregistrée</span>
            )}
          </div>
        </div>
      </header>

      <div className="toolbar" style={{ marginTop: "1rem" }}>
        {editable && (
          <a
            className="oe-button oe-button--secondary oe-button--sm"
            href={href({ name: "edit", id: node.id })}
          >
            <Pencil aria-hidden="true" /> Modifier
          </a>
        )}
        {editable && node.type !== "flashcard" && (
          <>
            <a
              className="oe-button oe-button--ghost oe-button--sm"
              href={href({ name: "new", parentId: node.id, type: "note" })}
            >
              <FilePlus2 aria-hidden="true" /> Page
            </a>
            <a
              className="oe-button oe-button--ghost oe-button--sm"
              href={href({ name: "new", parentId: node.id, type: "flashcard" })}
            >
              <Sparkles aria-hidden="true" /> Connaissance
            </a>
          </>
        )}
        {editable && node.parentId && (
          <a
            className="oe-button oe-button--ghost oe-button--sm"
            href={href({ name: "new", parentId: node.parentId, type: node.type })}
            title="Nouvelle page au même niveau"
          >
            <FilePlus2 aria-hidden="true" /> Page sœur
          </a>
        )}
        {editable && node.type === "note" && (
          <a
            className="oe-button oe-button--ghost oe-button--sm"
            href={href({ name: "extract", id: node.id })}
          >
            <Highlighter aria-hidden="true" /> Extraire
          </a>
        )}
        {owner && cards.length > 0 && (
          <a
            className="oe-button oe-button--ghost oe-button--sm"
            href={href({ name: "quiz", id: node.id })}
          >
            <GraduationCap aria-hidden="true" /> Quiz
          </a>
        )}
        {editable && (
          <a
            className="oe-button oe-button--ghost oe-button--sm"
            href={href({ name: "discussion", id: node.id })}
          >
            <MessageSquare aria-hidden="true" /> Discuter
          </a>
        )}
        {(node.childIds.length > 0 || isRoot) && (
          <a
            className="oe-button oe-button--ghost oe-button--sm"
            href={href({ name: "ask", id: node.id })}
          >
            <MessageCircleQuestion aria-hidden="true" /> Questions
          </a>
        )}
        {editable && (
          <>
            <button
              type="button"
              className="oe-button oe-button--ghost oe-button--sm"
              onClick={() => setDialog("visibility")}
            >
              <Shield aria-hidden="true" /> {node.isPublic ? "Rendre privé" : "Rendre public"}
            </button>
            {!isRoot && (
              <>
                <button
                  type="button"
                  className="oe-button oe-button--ghost oe-button--sm"
                  onClick={() => setDialog("move")}
                >
                  <MoveRight aria-hidden="true" /> Déplacer
                </button>
                <button
                  type="button"
                  className="oe-button oe-button--ghost oe-button--sm"
                  onClick={() => setDialog("delete")}
                >
                  <Trash2 aria-hidden="true" /> Supprimer
                </button>
              </>
            )}
          </>
        )}
      </div>

      {reminderGroups.length > 0 && (
        <div className="oe-alert oe-alert--warning" style={{ marginTop: "1.5rem" }}>
          <strong className="oe-alert__title">À réviser</strong>
          <ul className="link-list">
            {reminderGroups.slice(0, 5).map((group) => (
              <li key={group.category.id}>
                <span>
                  {plural(group.cards.length, "connaissance")} de <em>{group.category.title}</em>{" "}
                  {group.cards.length > 1 ? "risquent" : "risque"} d'être oubliée
                  {group.cards.length > 1 ? "s" : ""}.
                </span>
                <a
                  className="oe-button oe-button--ghost oe-button--sm"
                  href={href({ name: "quiz", id: group.category.id })}
                >
                  <Brain aria-hidden="true" /> Réviser
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Description node={node} />

      {extractedFrom && (
        <p className="muted small" style={{ marginTop: "1rem" }}>
          Extraite de{" "}
          <a href={href({ name: "node", id: extractedFrom.id })}>{extractedFrom.title}</a>
        </p>
      )}

      <section className="section">
        {content.loading && <p className="muted">Chargement du contenu…</p>}
        {content.error && <ErrorBox title="Contenu indisponible">{content.error}</ErrorBox>}
        {doc && node.type === "flashcard" && <FlashcardBody node={node} body={doc.body} />}
        {doc && node.type !== "flashcard" && doc.body.trim() !== "" && (
          <Markdown text={doc.body} path={node.indexPath} />
        )}
        {doc && node.type !== "flashcard" && doc.body.trim() === "" && children.length === 0 && (
          <EmptyState title="Page vide">
            {editable
              ? "Modifiez cette page, ajoutez-y des connaissances ou extrayez-en d'un texte."
              : "Cette page n'a pas encore de contenu."}
          </EmptyState>
        )}
      </section>

      {doc?.fields.sources && doc.fields.sources.length > 0 && (
        <section className="section">
          <h2>Sources</h2>
          <ul className="link-list">
            {doc.fields.sources.map((source, i) => (
              <li key={i}>
                <Link2 aria-hidden="true" />
                {source.url ? (
                  <a href={source.url} target="_blank" rel="noopener noreferrer">
                    {source.description || source.url}
                  </a>
                ) : (
                  <span>{source.description}</span>
                )}
                {source.file && owner && (
                  <button
                    type="button"
                    className="oe-button oe-button--ghost oe-button--sm"
                    onClick={() =>
                      void openAttachment(`${node.path}/${source.file}`).catch((e: unknown) =>
                        toast(String(e), "error"),
                      )
                    }
                    title="Fichier personnel (jamais publié)"
                  >
                    <Paperclip aria-hidden="true" /> {source.file}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {children.length > 0 && (
        <section className="section">
          <div className="section__head">
            <h2>{node.type === "flashcard" ? "Sous-pages" : "Contenu du sous-wiki"}</h2>
            <span className="muted small">{plural(children.length, "page")}</span>
          </div>
          <div className="children-grid">
            {children.map((child) => {
              const m = branch.get(child.id);
              return (
                <a
                  key={child.id}
                  className="child-card"
                  href={href({ name: "node", id: child.id })}
                >
                  <span className="child-card__title">
                    <TypeIcon node={child} tree={derived.tree} /> {child.title}
                  </span>
                  {child.description && (
                    <span className="child-card__text">{child.description}</span>
                  )}
                  <span className="badges">
                    {owner && m?.value !== undefined && (
                      <MasteryMeter value={m.value} threshold={threshold} />
                    )}
                    {owner && (
                      <VisibilityBadge visibility={child.isPublic ? "public" : "private"} compact />
                    )}
                    {child.childIds.length > 0 && (
                      <span className="muted small">{plural(child.childIds.length, "page")}</span>
                    )}
                  </span>
                </a>
              );
            })}
          </div>
        </section>
      )}

      {editable && node.type !== "flashcard" && hasAI(settings) && (
        <section className="section">
          <CategorySuggestions node={node} />
        </section>
      )}

      {extracted.length > 0 && (
        <section className="section">
          <h2>Connaissances extraites</h2>
          <ul className="link-list">
            {extracted.map((n) => (
              <li key={n.id}>
                <TypeIcon node={n} /> <a href={href({ name: "node", id: n.id })}>{n.title}</a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {node.attachments.length > 0 && (
        <section className="section">
          <h2>Fichiers joints</h2>
          <ul className="link-list">
            {node.attachments.map((file) => {
              const relative = file.path.slice(node.path.length + 1);
              return (
                <li key={file.path}>
                  <Paperclip aria-hidden="true" />
                  <a
                    href="#"
                    onClick={(e) => {
                      e.preventDefault();
                      openAttachment(file.path).catch((error: unknown) =>
                        toast(String(error), "error"),
                      );
                    }}
                  >
                    {relative}
                  </a>
                  {personalFiles.has(relative) && (
                    <span className="oe-badge">Fichier personnel</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {backlinks.length > 0 && (
        <section className="section">
          <h2>Rétroliens</h2>
          <ul className="link-list">
            {backlinks.map((b) => (
              <li key={b.id}>
                <TypeIcon node={b} /> <a href={href({ name: "node", id: b.id })}>{b.title}</a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {owner && (node.discussions.length > 0 || editable) && (
        <section className="section">
          <div className="section__head">
            <h2>Discussions</h2>
            {editable && (
              <a
                className="oe-button oe-button--ghost oe-button--sm"
                href={href({ name: "discussion", id: node.id })}
              >
                <MessageSquare aria-hidden="true" /> Nouvelle discussion
              </a>
            )}
          </div>
          {node.discussions.length === 0 ? (
            <p className="muted small">Aucune discussion sur cette page.</p>
          ) : (
            <ul className="link-list">
              {node.discussions.map((file) => (
                <li key={file.path}>
                  <MessageSquare aria-hidden="true" />
                  <a href={href({ name: "discussion", id: node.id, path: file.path })}>
                    <DiscussionTitle path={file.path} />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {quizzes.length > 0 && (
        <section className="section">
          <h2>Quiz</h2>
          <ul className="link-list">
            {quizzes.map(({ file, events, mean }) => (
              <li key={file.path}>
                <GraduationCap aria-hidden="true" />
                <span>
                  {basename(file.path).replace(/\.md$/, "")} — {plural(events.length, "réponse")},
                  score moyen {formatPercent(mean)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {dialog === "visibility" && (
        <VisibilityDialog node={node} open onClose={() => setDialog(null)} />
      )}
      {dialog === "delete" && <DeleteDialog node={node} open onClose={() => setDialog(null)} />}
      {dialog === "move" && (
        <NodePicker
          open
          title={`Déplacer « ${node.title} » sous…`}
          tree={derived.tree}
          filter={(n) =>
            n.id !== node.id &&
            n.type !== "flashcard" &&
            !n.path.startsWith(`${node.path}/`) &&
            n.id !== node.parentId
          }
          onClose={() => setDialog(null)}
          onSelect={(target) => {
            setDialog(null);
            void moveWithConfirmation(node.id, target.id);
          }}
        />
      )}
    </article>
  );
}
