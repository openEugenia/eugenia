/**
 * Page d'un nœud (§9.2, vues 2 et 3) : catégorie (description, sous-catégories, connaissances),
 * connaissance atomique (énoncé, sources, flashcards), flashcard (question, réponse, maîtrise),
 * source de la bibliothèque (notice, fichier, connaissances qui en sont tirées).
 */
import { useMemo, useState, type ReactNode } from "react";
import {
  Brain,
  ExternalLink,
  Eye,
  FilePlus2,
  Folder,
  GraduationCap,
  Highlighter,
  Layers,
  Lightbulb,
  Link2,
  MessageCircleQuestion,
  MessageSquare,
  MoveRight,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Shield,
  StickyNote,
  Trash2,
} from "lucide-react";
import {
  buildBacklinks,
  currentMastery,
  dayNumber,
  dayToDate,
  flashcardsUnder,
  knowledgeOf,
  masteryCurve,
  parseFlashcardBody,
  parseKnowledgeBody,
  parsePage,
  parseSummary,
  placementProblem,
  reminders,
  sourceRefLabel,
  type SourceRef,
  type WikiNode,
} from "@openeugenia/core";
import { CategorySuggestions } from "../components/CategorySuggestions.tsx";
import { LineChart, MasteryMeter } from "../components/charts.tsx";
import {
  Breadcrumb,
  DiscussionKindIcon,
  DISCUSSION_KIND_LABELS,
  EmptyState,
  ErrorBox,
  SOURCE_KIND_LABELS,
  SourceKindIcon,
  SummaryStatusBadge,
  TypeIcon,
  typeLabel,
  UnsourcedBadge,
  VisibilityBadge,
} from "../components/common.tsx";
import { FlashcardSuggestions } from "../components/FlashcardSuggestions.tsx";
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
import { branchMasteryMap, type BranchMastery } from "../lib/mastery.ts";
import { href } from "../lib/router.ts";
import { hasAI } from "../lib/settings.ts";
import { useSettings } from "../store/settings.ts";
import { toast } from "../store/ui.ts";
import { useWiki } from "../store/wiki.ts";
import type { DiscussionEntry } from "../lib/workspace.ts";

function Description({ node }: { node: WikiNode }) {
  const derived = useDerived();
  const owner = useIsOwner();
  const editable = useCanEdit();
  // En lecture publique, `_summary.md` contient la description publique.
  const file = node.summaries.private ?? node.summaries.public;
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
  const knowledge = knowledgeOf(derived.tree, node);
  const parentText = useText(
    knowledge && knowledge.id !== node.id ? knowledge.indexPath : undefined,
  );
  const statement =
    card.knowledge ??
    (parentText.data ? parseKnowledgeBody(parsePage(parentText.data).body).statement : undefined);
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
      {statement !== undefined && (
        <div className="card-face__block oe-card">
          <span className="card-face__label">
            Connaissance testée
            {knowledge && knowledge.id !== node.id && (
              <>
                {" · "}
                <a href={href({ name: "node", id: knowledge.id })}>{knowledge.title}</a>
              </>
            )}
          </span>
          <Markdown
            className="prose knowledge"
            text={statement || "_(énoncé manquant)_"}
            path={knowledge?.indexPath ?? node.indexPath}
          />
        </div>
      )}
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
              ? "Jamais évaluée : la maîtrise décroît depuis la création de la flashcard."
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

function openFile(path: string): void {
  openAttachment(path).catch((error: unknown) => toast(String(error), "error"));
}

/** Carte d'un enfant : catégorie ou connaissance, avec description et maîtrise. */
function ChildCard({ child, mastery }: { child: WikiNode; mastery: BranchMastery | undefined }) {
  const derived = useDerived();
  const owner = useIsOwner();
  const threshold = derived.config.mastery.reminder_threshold;
  const cards = child.type === "knowledge" ? child.childIds.length : 0;
  return (
    <a className="child-card" href={href({ name: "node", id: child.id })}>
      <span className="child-card__title">
        <TypeIcon node={child} /> {child.title}
      </span>
      {child.description && <span className="child-card__text">{child.description}</span>}
      <span className="badges">
        {owner && mastery?.value !== undefined && (
          <MasteryMeter value={mastery.value} threshold={threshold} />
        )}
        {owner && <VisibilityBadge visibility={child.isPublic ? "public" : "private"} compact />}
        {child.type === "knowledge" && !child.sourced && <UnsourcedBadge compact />}
        {child.type === "knowledge" ? (
          <span className="muted small">{plural(cards, "flashcard")}</span>
        ) : (
          child.childIds.length > 0 && (
            <span className="muted small">{plural(child.childIds.length, "élément")}</span>
          )
        )}
      </span>
    </a>
  );
}

/** Sources citées par une connaissance : sources de la bibliothèque ou références libres. */
function KnowledgeSources({ node, sources }: { node: WikiNode; sources: SourceRef[] }) {
  const derived = useDerived();
  const editable = useCanEdit();
  return (
    <section className="section">
      <div className="section__head">
        <h2>Sources</h2>
        {editable && (
          <a
            className="oe-button oe-button--ghost oe-button--sm"
            href={href({ name: "edit", id: node.id })}
          >
            <Plus aria-hidden="true" />{" "}
            {sources.length > 0 ? "Modifier les sources" : "Ajouter une source"}
          </a>
        )}
      </div>
      {sources.length === 0 ? (
        <div className="oe-alert oe-alert--warning">
          <strong className="oe-alert__title">À sourcer</strong>
          Aucune source n'appuie encore cette connaissance. Rattachez-la à une source de votre{" "}
          <a href={href({ name: "library" })}>bibliothèque</a> (livre, article, site…), ou ajoutez-y
          d'abord la source qui la confirme.
        </div>
      ) : (
        <ul className="link-list">
          {sources.map((source, i) => {
            const target = source.ref ? derived.tree.nodes.get(source.ref) : undefined;
            return (
              <li key={i}>
                {target ? (
                  <>
                    <SourceKindIcon kind={target.sourceKind} />
                    <a href={href({ name: "node", id: target.id })}>{target.title}</a>
                    {target.authors.length > 0 && (
                      <span className="muted small">{target.authors.join(", ")}</span>
                    )}
                  </>
                ) : source.ref ? (
                  <>
                    <Link2 aria-hidden="true" />
                    <span className="muted">
                      {source.description || "Source indisponible (privée ou supprimée)"}
                    </span>
                  </>
                ) : (
                  <>
                    <Link2 aria-hidden="true" />
                    {source.url ? (
                      <a href={source.url} target="_blank" rel="noopener noreferrer">
                        {sourceRefLabel(source)}
                      </a>
                    ) : (
                      <span>{sourceRefLabel(source)}</span>
                    )}
                    <span className="oe-badge" title="Référence libre, hors bibliothèque">
                      Hors bibliothèque
                    </span>
                  </>
                )}
                {source.locator && <span className="muted small">{source.locator}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** Flashcards d'une connaissance : question, maîtrise, réponse à révéler. */
function KnowledgeFlashcards({ node }: { node: WikiNode }) {
  const derived = useDerived();
  const owner = useIsOwner();
  const editable = useCanEdit();
  const settings = useSettings((s) => s.settings);
  const threshold = derived.config.mastery.reminder_threshold;
  const today = dayNumber(Date.now());
  const cards = node.childIds
    .map((id) => derived.tree.nodes.get(id)!)
    .filter((c) => c.type === "flashcard");
  return (
    <section className="section">
      <div className="section__head">
        <h2>Flashcards</h2>
        <span className="muted small">{plural(cards.length, "flashcard")}</span>
        {editable && (
          <a
            className="oe-button oe-button--ghost oe-button--sm"
            href={href({ name: "new", parentId: node.id, type: "flashcard" })}
          >
            <Plus aria-hidden="true" /> Ajouter une flashcard
          </a>
        )}
      </div>
      {cards.length === 0 ? (
        <p className="muted small">
          Aucune flashcard : cette connaissance ne sera pas proposée en quiz tant qu'aucune question
          ne la teste.
        </p>
      ) : (
        <ul className="flashcard-list">
          {cards.map((card) => {
            const state = derived.mastery.get(card.id);
            return (
              <li key={card.id} className="oe-card flashcard-item">
                <a className="flashcard-item__question" href={href({ name: "node", id: card.id })}>
                  <Layers aria-hidden="true" /> {card.description ?? card.title}
                </a>
                <span className="badges">
                  {owner && state && (
                    <MasteryMeter value={currentMastery(state, today)} threshold={threshold} />
                  )}
                  {owner && state && (
                    <span className="muted small">{plural(state.evaluations, "évaluation")}</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {editable && hasAI(settings) && (
        <div style={{ marginTop: "0.75rem" }}>
          <FlashcardSuggestions node={node} />
        </div>
      )}
    </section>
  );
}

/** Notice d'une source : nature, auteurs, date, adresse, fichier personnel. */
function SourceNotice({ node, file }: { node: WikiNode; file?: string }) {
  const owner = useIsOwner();
  const rows: { label: string; value: ReactNode }[] = [];
  if (node.sourceKind) rows.push({ label: "Nature", value: SOURCE_KIND_LABELS[node.sourceKind] });
  if (node.authors.length > 0) rows.push({ label: "Auteurs", value: node.authors.join(", ") });
  if (node.published) rows.push({ label: "Publication", value: node.published });
  if (node.url)
    rows.push({
      label: "Adresse",
      value: (
        <a href={node.url} target="_blank" rel="noopener noreferrer">
          {node.url} <ExternalLink aria-hidden="true" className="inline-icon" />
        </a>
      ),
    });
  if (file && owner)
    rows.push({
      label: "Fichier",
      value: (
        <button
          type="button"
          className="oe-button oe-button--ghost oe-button--sm"
          onClick={() => openFile(`${node.path}/${file}`)}
          title="Fichier personnel (jamais publié)"
        >
          <Paperclip aria-hidden="true" /> {file}
        </button>
      ),
    });
  if (rows.length === 0) return null;
  return (
    <dl className="notice oe-card">
      {rows.map((row) => (
        <div key={row.label} className="notice__row">
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function DiscussionList({ entries }: { entries: DiscussionEntry[] }) {
  return (
    <ul className="link-list">
      {entries.map((entry) => (
        <li key={entry.path}>
          <DiscussionKindIcon kind={entry.meta.kind} />
          <a href={href({ name: "discussion", path: entry.path })}>
            {entry.meta.title || entry.path}
          </a>
          <span className="muted small">
            {DISCUSSION_KIND_LABELS[entry.meta.kind]}
            {entry.meta.created ? ` · ${formatDate(entry.meta.created)}` : ""}
          </span>
        </li>
      ))}
    </ul>
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
    return (buildBacklinks(derived.tree, contents).get(node.id) ?? [])
      .map((bid) => derived.tree.nodes.get(bid)!)
      .filter((b) => b.parentId !== node.id && node.parentId !== b.id);
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
  const isRoot = node.id === derived.tree.rootId;
  const isSource = node.type === "source";
  const threshold = derived.config.mastery.reminder_threshold;
  const reminderGroups = isRoot && owner ? reminders(derived.tree, derived.mastery, threshold) : [];
  const discussions = derived.discussionsByNode.get(node.id) ?? [];
  const origin = node.extractedFrom
    ? (derived.tree.nodes.get(node.extractedFrom) ?? derived.discussionById.get(node.extractedFrom))
    : undefined;
  const usedBy = isSource
    ? (derived.knowledgeBySource.get(node.id) ?? []).map((k) => derived.tree.nodes.get(k)!)
    : [];
  const personalFile = doc?.fields.file;
  const subcategories = children.filter((c) => c.type === "category");
  const knowledge = children.filter((c) => c.type === "knowledge");
  // Enfants contraires à la structure (signalés par `validate`) : rendus accessibles.
  const others =
    node.type === "knowledge"
      ? children.filter((c) => c.type !== "flashcard")
      : children.filter((c) => c.type !== "category" && c.type !== "knowledge");
  const mastery = branch.get(node.id);
  const movable =
    !isRoot && !isSource && node.parentId !== null && node.parentId !== derived.tree.libraryId;

  return (
    <article className="page">
      <Breadcrumb tree={derived.tree} node={node} />
      <header className="node-head">
        <div className="node-head__title">
          <h1>{node.title}</h1>
          <div className="node-head__meta">
            <span style={{ display: "inline-flex", gap: "0.35rem", alignItems: "center" }}>
              <TypeIcon node={node} /> {typeLabel(node)}
            </span>
            {owner && <VisibilityBadge visibility={node.isPublic ? "public" : "private"} />}
            {node.type === "knowledge" && !node.sourced && <UnsourcedBadge />}
            {node.tags.map((tag) => (
              <a key={tag} className="oe-badge" href={href({ name: "search", q: `#${tag}` })}>
                #{tag}
              </a>
            ))}
            {owner && mastery?.value !== undefined && node.type !== "flashcard" && (
              <MasteryMeter
                value={mastery.value}
                threshold={threshold}
                label={`Maîtrise moyenne (${plural(mastery.count, "flashcard")})`}
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
        {editable && node.type === "category" && (
          <>
            <a
              className="oe-button oe-button--ghost oe-button--sm"
              href={href({ name: "new", parentId: node.id, type: "knowledge" })}
            >
              <Lightbulb aria-hidden="true" /> Connaissance
            </a>
            <a
              className="oe-button oe-button--ghost oe-button--sm"
              href={href({ name: "new", parentId: node.id, type: "category" })}
            >
              <Folder aria-hidden="true" /> Sous-catégorie
            </a>
          </>
        )}
        {editable && node.type === "knowledge" && (
          <a
            className="oe-button oe-button--ghost oe-button--sm"
            href={href({ name: "new", parentId: node.id, type: "flashcard" })}
          >
            <Layers aria-hidden="true" /> Flashcard
          </a>
        )}
        {editable && isSource && (
          <a
            className="oe-button oe-button--ghost oe-button--sm"
            href={href({ name: "extract", id: node.id })}
          >
            <Highlighter aria-hidden="true" /> Extraire des connaissances
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
            href={href({ name: "discussion", about: node.id })}
          >
            <MessageSquare aria-hidden="true" /> Discuter
          </a>
        )}
        {node.type === "category" && (node.childIds.length > 0 || isRoot) && (
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
            {movable && (
              <button
                type="button"
                className="oe-button oe-button--ghost oe-button--sm"
                onClick={() => setDialog("move")}
              >
                <MoveRight aria-hidden="true" /> Déplacer
              </button>
            )}
            {!isRoot && (
              <button
                type="button"
                className="oe-button oe-button--ghost oe-button--sm"
                onClick={() => setDialog("delete")}
              >
                <Trash2 aria-hidden="true" /> Supprimer
              </button>
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
                  {plural(group.cards.length, "flashcard")} de <em>{group.category.title}</em>{" "}
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

      {node.type === "category" && <Description node={node} />}

      {origin && (
        <p className="muted small" style={{ marginTop: "1rem" }}>
          Extraite {"meta" in origin ? "de la discussion " : "de "}
          {"meta" in origin ? (
            <a href={href({ name: "discussion", path: origin.path })}>
              <StickyNote aria-hidden="true" className="inline-icon" /> {origin.meta.title}
            </a>
          ) : (
            <a href={href({ name: "node", id: origin.id })}>{origin.title}</a>
          )}
        </p>
      )}

      {isSource && <SourceNotice node={node} {...(personalFile ? { file: personalFile } : {})} />}

      <section className="section">
        {content.loading && <p className="muted">Chargement du contenu…</p>}
        {content.error && <ErrorBox title="Contenu indisponible">{content.error}</ErrorBox>}
        {doc && node.type === "flashcard" && <FlashcardBody node={node} body={doc.body} />}
        {doc && node.type === "knowledge" && (
          <KnowledgeBody body={doc.body} path={node.indexPath} />
        )}
        {doc && (node.type === "category" || isSource) && doc.body.trim() !== "" && (
          <Markdown text={doc.body} path={node.indexPath} />
        )}
        {doc && node.type === "category" && doc.body.trim() === "" && children.length === 0 && (
          <EmptyState title="Catégorie vide">
            {editable
              ? "Ajoutez-y des connaissances atomiques, des sous-catégories, ou extrayez des connaissances d'une source de votre bibliothèque."
              : "Cette catégorie ne contient encore rien."}
          </EmptyState>
        )}
      </section>

      {doc && node.type === "knowledge" && (
        <KnowledgeSources node={node} sources={doc.fields.sources ?? []} />
      )}
      {node.type === "knowledge" && <KnowledgeFlashcards node={node} />}

      {subcategories.length > 0 && (
        <section className="section">
          <div className="section__head">
            <h2>Sous-catégories</h2>
            <span className="muted small">{plural(subcategories.length, "catégorie")}</span>
          </div>
          <div className="children-grid">
            {subcategories.map((child) => (
              <ChildCard key={child.id} child={child} mastery={branch.get(child.id)} />
            ))}
          </div>
        </section>
      )}

      {knowledge.length > 0 && (
        <section className="section">
          <div className="section__head">
            <h2>Connaissances</h2>
            <span className="muted small">{plural(knowledge.length, "connaissance")}</span>
          </div>
          <div className="children-grid">
            {knowledge.map((child) => (
              <ChildCard key={child.id} child={child} mastery={branch.get(child.id)} />
            ))}
          </div>
        </section>
      )}

      {others.length > 0 && (
        <section className="section">
          <h2>Pages mal rangées</h2>
          <p className="muted small">
            Ces pages ne devraient pas se trouver ici : déplacez-les sous une connaissance (une
            flashcard) ou dans la bibliothèque (une source).
          </p>
          <ul className="link-list">
            {others.map((child) => (
              <li key={child.id}>
                <TypeIcon node={child} />{" "}
                <a href={href({ name: "node", id: child.id })}>{child.title}</a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {editable && node.type === "category" && hasAI(settings) && (
        <section className="section">
          <CategorySuggestions node={node} />
        </section>
      )}

      {isSource && (
        <section className="section">
          <div className="section__head">
            <h2>Connaissances tirées de cette source</h2>
            {editable && (
              <a
                className="oe-button oe-button--ghost oe-button--sm"
                href={href({ name: "extract", id: node.id })}
              >
                <Highlighter aria-hidden="true" /> Extraire
              </a>
            )}
          </div>
          {usedBy.length === 0 ? (
            <p className="muted small">Aucune connaissance ne cite encore cette source.</p>
          ) : (
            <ul className="link-list">
              {usedBy.map((k) => (
                <li key={k.id}>
                  <TypeIcon node={k} /> <a href={href({ name: "node", id: k.id })}>{k.title}</a>
                  {k.description && <span className="muted small">{k.description}</span>}
                </li>
              ))}
            </ul>
          )}
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
                      openFile(file.path);
                    }}
                  >
                    {relative}
                  </a>
                  {personalFile === relative && <span className="oe-badge">Fichier personnel</span>}
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

      {(discussions.length > 0 || editable) && (
        <section className="section">
          <div className="section__head">
            <h2>Discussions</h2>
            {editable && (
              <a
                className="oe-button oe-button--ghost oe-button--sm"
                href={href({ name: "discussion", about: node.id })}
              >
                <MessageSquare aria-hidden="true" /> Nouvelle discussion
              </a>
            )}
          </div>
          {discussions.length === 0 ? (
            <p className="muted small">Aucune discussion sur cette page.</p>
          ) : (
            <DiscussionList entries={discussions} />
          )}
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
            !n.path.startsWith(`${node.path}/`) &&
            n.id !== node.parentId &&
            placementProblem(derived.tree, node, n.id) === null
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

/** Énoncé d'une connaissance (sa cible en gras), puis ses notes éventuelles. */
function KnowledgeBody({ body, path }: { body: string; path: string }) {
  const { statement, notes } = parseKnowledgeBody(body);
  return (
    <>
      <div className="card-face__block oe-card">
        <span className="card-face__label">Connaissance</span>
        <Markdown
          className="prose knowledge"
          text={statement || "_(énoncé manquant)_"}
          path={path}
        />
      </div>
      {notes && (
        <div className="section">
          <Markdown text={notes} path={path} />
        </div>
      )}
    </>
  );
}
