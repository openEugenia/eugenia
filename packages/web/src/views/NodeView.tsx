/**
 * Page of a node (§9.2, views 2 and 3): category (description, subcategories, knowledge),
 * atomic knowledge (statement, sources, flashcards), flashcard (question, answer, mastery),
 * library source (bibliographic record, file, knowledge drawn from it).
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
  InfoBox,
  RecordBadge,
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
import { CategorySources, SourceFiling, SourceIndexPanel } from "../components/SourcePanels.tsx";
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
  // When reading the public part, `_summary.md` holds the public description.
  const file = node.summaries.private ?? node.summaries.public;
  const { data, loading } = useText(file?.path);
  const state = owner ? derived.summaryStates.private.get(node.id) : undefined;
  if (!file && !(owner && state?.status === "missing")) return null;
  const summary = data ? parseSummary(data) : undefined;
  return (
    <section className="description oe-frame" aria-label="Sub-wiki description">
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
            <RefreshCw aria-hidden="true" />{" "}
            {state.status === "missing" ? "Generate" : "Regenerate"}
          </a>
        )}
      </div>
      {loading && <p className="muted">Loading…</p>}
      {summary && <Markdown text={summary.body} path={file!.path} />}
      {!file && <p className="muted">This sub-wiki has no description yet.</p>}
      {summary?.fields.generated && (
        <p className="muted small" style={{ marginTop: "0.5rem" }}>
          Generated on {formatDate(summary.fields.generated)}
          {summary.fields.model ? ` by ${summary.fields.model}` : ""}
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
        <Markdown text={card.question || "_(missing question)_"} path={node.indexPath} />
        <div style={{ marginTop: "0.75rem" }}>
          {revealed ? (
            <>
              <span className="card-face__label">Expected answer</span>
              <Markdown text={card.answer || "_(missing answer)_"} path={node.indexPath} />
            </>
          ) : (
            <button
              type="button"
              className="oe-button oe-button--secondary oe-button--sm"
              onClick={() => setRevealed(true)}
            >
              <Eye aria-hidden="true" /> Reveal the answer
            </button>
          )}
        </div>
      </div>
      {statement !== undefined && (
        <div className="card-face__block oe-card">
          <span className="card-face__label">
            Tested knowledge
            {knowledge && knowledge.id !== node.id && (
              <>
                {" · "}
                <a href={href({ name: "node", id: knowledge.id })}>{knowledge.title}</a>
              </>
            )}
          </span>
          <Markdown
            className="prose knowledge"
            text={statement || "_(missing statement)_"}
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
        <section className="oe-card" aria-label="Mastery">
          <div className="section__head" style={{ marginBottom: 0 }}>
            <h2 style={{ fontSize: "var(--oe-font-size-lg)" }}>Mastery</h2>
            <MasteryMeter value={current} threshold={derived.config.mastery.reminder_threshold} />
          </div>
          <p className="muted small">
            {state.evaluations === 0
              ? "Never evaluated: mastery has been decaying since the flashcard was created."
              : `${plural(state.evaluations, "evaluation")}, the last one on ${formatDate(state.lastEvalAt)} (score ${formatPercent(state.lastScore)}). Current daily decay: ${formatPercent(1 - state.decay, 1)}.`}
          </p>
          {curve.length > 1 && (
            <LineChart
              title="Mastery over time"
              series={[
                { id: node.id, label: node.title, color: "var(--viz-series-1)", points: curve },
              ]}
              xFormat={(day) => formatShortDate(dayToDate(day))}
              threshold={{
                value: derived.config.mastery.reminder_threshold,
                label: "Reminder threshold",
              }}
              height={200}
            />
          )}
          {events.length > 0 && (
            <details>
              <summary className="small">Evaluation history</summary>
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
                        {e.self ? <span className="muted">(self-assessment)</span> : null}
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

/** Card of a child: category or knowledge item, with description and mastery. */
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
            <span className="muted small">{plural(child.childIds.length, "item")}</span>
          )
        )}
      </span>
    </a>
  );
}

/** Sources cited by a knowledge item: library sources or free references. */
function KnowledgeSources({ node, sources }: { node: WikiNode; sources: SourceRef[] }) {
  const derived = useDerived();
  const owner = useIsOwner();
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
            <Plus aria-hidden="true" /> {sources.length > 0 ? "Edit the sources" : "Add a source"}
          </a>
        )}
      </div>
      {sources.length === 0 ? (
        <div className="oe-alert oe-alert--warning">
          <strong className="oe-alert__title">Needs a source</strong>
          No source backs this knowledge item yet. Attach it to a source of your{" "}
          <a href={href({ name: "library" })}>library</a> (book, article, website…), or first add
          the source that confirms it.
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
                    {!owner && !target.isPublic && <RecordBadge compact />}
                  </>
                ) : source.ref ? (
                  <>
                    <Link2 aria-hidden="true" />
                    <span className="muted">
                      {source.description || "Source not available (deleted)"}
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
                    <span className="oe-badge" title="Free reference, outside the library">
                      Outside the library
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

/** Flashcards of a knowledge item: question, mastery, answer to reveal. */
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
            <Plus aria-hidden="true" /> Add a flashcard
          </a>
        )}
      </div>
      {cards.length === 0 ? (
        <p className="muted small">
          No flashcard: this knowledge item will not appear in quizzes until a question tests it.
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
                    <span className="muted small">{plural(state.evaluations, "evaluation")}</span>
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

/** Bibliographic record of a source: kind, authors, date, URL, personal file. */
function SourceRecord({ node, file }: { node: WikiNode; file?: string }) {
  const owner = useIsOwner();
  const rows: { label: string; value: ReactNode }[] = [];
  if (node.sourceKind) rows.push({ label: "Kind", value: SOURCE_KIND_LABELS[node.sourceKind] });
  if (node.authors.length > 0) rows.push({ label: "Authors", value: node.authors.join(", ") });
  if (node.published) rows.push({ label: "Published", value: node.published });
  if (node.url)
    rows.push({
      label: "URL",
      value: (
        <a href={node.url} target="_blank" rel="noopener noreferrer">
          {node.url} <ExternalLink aria-hidden="true" className="inline-icon" />
        </a>
      ),
    });
  if (file && owner)
    rows.push({
      label: "File",
      value: (
        <button
          type="button"
          className="oe-button oe-button--ghost oe-button--sm"
          onClick={() => openFile(`${node.path}/${file}`)}
          title="Personal file (never published)"
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
        <ErrorBox title="Page not found">
          This page does not exist in this wiki, or no longer does.
        </ErrorBox>
      </div>
    );
  }
  const doc = content.data ? parsePage(content.data) : undefined;
  const children = node.childIds.map((cid) => derived.tree.nodes.get(cid)!);
  const cards = flashcardsUnder(derived.tree, node.id);
  const isRoot = node.id === derived.tree.rootId;
  const isSource = node.type === "source";
  // Private source in the public part: only its bibliographic record is published.
  const isRecord = isSource && !owner && !node.isPublic && !node.virtual;
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
  // Children that break the structure (reported by `validate`): made reachable.
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
            {isRecord && <RecordBadge />}
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
                label={`Average mastery (${plural(mastery.count, "flashcard")})`}
              />
            )}
            {node.updated && <span>Updated on {formatDate(node.updated)}</span>}
            {derived.pendingNodes.has(node.id) && (
              <span className="oe-badge oe-badge--warning">Not saved</span>
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
            <Pencil aria-hidden="true" /> Edit
          </a>
        )}
        {editable && node.type === "category" && (
          <>
            <a
              className="oe-button oe-button--ghost oe-button--sm"
              href={href({ name: "new", parentId: node.id, type: "knowledge" })}
            >
              <Lightbulb aria-hidden="true" /> Knowledge
            </a>
            <a
              className="oe-button oe-button--ghost oe-button--sm"
              href={href({ name: "new", parentId: node.id, type: "category" })}
            >
              <Folder aria-hidden="true" /> Subcategory
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
            <Highlighter aria-hidden="true" /> Extract knowledge
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
            <MessageSquare aria-hidden="true" /> Discuss
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
              <Shield aria-hidden="true" /> {node.isPublic ? "Make private" : "Make public"}
            </button>
            {movable && (
              <button
                type="button"
                className="oe-button oe-button--ghost oe-button--sm"
                onClick={() => setDialog("move")}
              >
                <MoveRight aria-hidden="true" /> Move
              </button>
            )}
            {!isRoot && (
              <button
                type="button"
                className="oe-button oe-button--ghost oe-button--sm"
                onClick={() => setDialog("delete")}
              >
                <Trash2 aria-hidden="true" /> Delete
              </button>
            )}
          </>
        )}
      </div>

      {reminderGroups.length > 0 && (
        <div className="oe-alert oe-alert--warning" style={{ marginTop: "1.5rem" }}>
          <strong className="oe-alert__title">To review</strong>
          <ul className="link-list">
            {reminderGroups.slice(0, 5).map((group) => (
              <li key={group.category.id}>
                <span>
                  {plural(group.cards.length, "flashcard")} in <em>{group.category.title}</em> may
                  be forgotten.
                </span>
                <a
                  className="oe-button oe-button--ghost oe-button--sm"
                  href={href({ name: "quiz", id: group.category.id })}
                >
                  <Brain aria-hidden="true" /> Review
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {node.type === "category" && <Description node={node} />}

      {origin && (
        <p className="muted small" style={{ marginTop: "1rem" }}>
          Extracted from {"meta" in origin ? "the discussion " : ""}
          {"meta" in origin ? (
            <a href={href({ name: "discussion", path: origin.path })}>
              <StickyNote aria-hidden="true" className="inline-icon" /> {origin.meta.title}
            </a>
          ) : (
            <a href={href({ name: "node", id: origin.id })}>{origin.title}</a>
          )}
        </p>
      )}

      {isSource && <SourceRecord node={node} {...(personalFile ? { file: personalFile } : {})} />}
      {isSource && !node.virtual && <SourceFiling node={node} />}
      {isRecord && (
        <InfoBox title="Private source">
          The content of this source is private: only its bibliographic record (title, kind,
          authors, date, URL) is published, so that the knowledge of this wiki can cite it.
        </InfoBox>
      )}
      {owner && isSource && !node.isPublic && (
        <p className="muted small">
          Private source: its content and personal file stay private; only its bibliographic record
          (title, kind, authors, date, URL) is published in the public part of the wiki.
        </p>
      )}

      <section className="section">
        {content.loading && <p className="muted">Loading the content…</p>}
        {content.error && <ErrorBox title="Content unavailable">{content.error}</ErrorBox>}
        {doc && node.type === "flashcard" && <FlashcardBody node={node} body={doc.body} />}
        {doc && node.type === "knowledge" && (
          <KnowledgeBody body={doc.body} path={node.indexPath} />
        )}
        {doc && (node.type === "category" || isSource) && doc.body.trim() !== "" && (
          <Markdown text={doc.body} path={node.indexPath} />
        )}
        {doc && node.type === "category" && doc.body.trim() === "" && children.length === 0 && (
          <EmptyState title="Empty category">
            {editable
              ? "Add atomic knowledge or subcategories to it, or extract knowledge from a source of your library."
              : "This category does not contain anything yet."}
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
            <h2>Subcategories</h2>
            <span className="muted small">
              {plural(subcategories.length, "category", "categories")}
            </span>
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
            <h2>Knowledge</h2>
            <span className="muted small">{plural(knowledge.length, "knowledge item")}</span>
          </div>
          <div className="children-grid">
            {knowledge.map((child) => (
              <ChildCard key={child.id} child={child} mastery={branch.get(child.id)} />
            ))}
          </div>
        </section>
      )}

      {node.type === "category" && <CategorySources node={node} />}

      {others.length > 0 && (
        <section className="section">
          <h2>Misplaced pages</h2>
          <p className="muted small">
            These pages should not be here: move them under a knowledge item (a flashcard) or to the
            library (a source).
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

      {isSource && !isRecord && !node.virtual && <SourceIndexPanel node={node} />}

      {isSource && (
        <section className="section">
          <div className="section__head">
            <h2>Knowledge drawn from this source</h2>
            {editable && (
              <a
                className="oe-button oe-button--ghost oe-button--sm"
                href={href({ name: "extract", id: node.id })}
              >
                <Highlighter aria-hidden="true" /> Extract
              </a>
            )}
          </div>
          {usedBy.length === 0 ? (
            <p className="muted small">No knowledge item cites this source yet.</p>
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
          <h2>Attached files</h2>
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
                  {personalFile === relative && <span className="oe-badge">Personal file</span>}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {backlinks.length > 0 && (
        <section className="section">
          <h2>Backlinks</h2>
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
                <MessageSquare aria-hidden="true" /> New discussion
              </a>
            )}
          </div>
          {discussions.length === 0 ? (
            <p className="muted small">No discussion about this page.</p>
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
          title={`Move "${node.title}" under…`}
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

/** Statement of a knowledge item (its target in bold), then its notes if any. */
function KnowledgeBody({ body, path }: { body: string; path: string }) {
  const { statement, notes } = parseKnowledgeBody(body);
  return (
    <>
      <div className="card-face__block oe-card">
        <span className="card-face__label">Knowledge</span>
        <Markdown
          className="prose knowledge"
          text={statement || "_(missing statement)_"}
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
