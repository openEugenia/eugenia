/**
 * Card of an element in the unified graph (§9.2, view 7): category, knowledge item, flashcard,
 * source, section of an index or discussion. Folded, it shows what the element is; selected, it
 * shows its content and every action on it, so that the graph alone is enough to work.
 */
import { createContext, memo, useContext, useEffect, useState, type ReactNode } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import {
  ChevronLeft,
  ChevronRight,
  Crosshair,
  ExternalLink,
  Folder,
  FolderInput,
  GraduationCap,
  Highlighter,
  Layers,
  Lightbulb,
  ListTree,
  MessageCircleQuestion,
  MessageSquare,
  MoveRight,
  Pencil,
  Plus,
  RefreshCw,
  Shield,
  Trash2,
} from "lucide-react";
import {
  flashcardsUnder,
  indexKnowledge,
  knowledgeKey,
  newCandidates,
  parseFlashcardBody,
  parseKnowledgeBody,
  parsePage,
  parseSummary,
  sourceIndexState,
  type SourceIndexNode,
  type SourceIndexStatus,
  type WikiNode,
} from "@openeugenia/core";
import type { GraphItem } from "../lib/graph.ts";
import { formatDate, plural } from "../lib/format.ts";
import { useDerived, useText } from "../lib/hooks.ts";
import { addProposedKnowledge, indexSourceNode, useSourceIndex } from "../lib/indexing.ts";
import type { BranchMastery } from "../lib/mastery.ts";
import { href } from "../lib/router.ts";
import { hasIndexing } from "../lib/settings.ts";
import { useTasks } from "../lib/tasks.ts";
import { useSettings } from "../store/settings.ts";
import { errorMessage, toast } from "../store/ui.ts";
import { useWiki } from "../store/wiki.ts";
import { MasteryMeter } from "./charts.tsx";
import {
  DiscussionKindIcon,
  DISCUSSION_KIND_LABELS,
  RecordBadge,
  SOURCE_KIND_LABELS,
  Spinner,
  SummaryStatusBadge,
  TypeIcon,
  UnsourcedBadge,
  VisibilityBadge,
} from "./common.tsx";
import { Markdown } from "./Markdown.tsx";
import { IndexingProgress, INDEX_STATUS_LABELS, sectionHref } from "./SourcePanels.tsx";

/** Dialogs opened from a card, shown by the graph. */
export type GraphDialog = { kind: "visibility" | "delete" | "move" | "file"; node: WikiNode };

export interface GraphContextValue {
  owner: boolean;
  editable: boolean;
  focusId: string;
  threshold: number;
  mastery: Map<string, BranchMastery>;
  toggle(id: string): void;
  openDialog(dialog: GraphDialog): void;
}

export const GraphContext = createContext<GraphContextValue | null>(null);

function useGraph(): GraphContextValue {
  const value = useContext(GraphContext);
  if (!value) throw new Error("GraphCard outside of the graph.");
  return value;
}

export type GraphCardNode = Node<{ item: GraphItem }, "item">;

export const KIND_LABELS: Record<GraphItem["kind"], string> = {
  category: "Category",
  knowledge: "Knowledge",
  flashcard: "Flashcard",
  source: "Source",
  section: "Part of an index",
  discussion: "Discussion",
};

function kindLabel(item: GraphItem, rootId: string): string {
  if (item.kind === "category" && item.id === rootId) return "Wiki";
  if (item.kind === "source" && item.node?.sourceKind)
    return SOURCE_KIND_LABELS[item.node.sourceKind];
  if (item.kind === "discussion" && item.discussion)
    return DISCUSSION_KIND_LABELS[item.discussion.meta.kind];
  return KIND_LABELS[item.kind];
}

function KindIcon({ item }: { item: GraphItem }) {
  if (item.node) return <TypeIcon node={item.node} />;
  if (item.discussion) return <DiscussionKindIcon kind={item.discussion.meta.kind} />;
  return <ListTree aria-hidden="true" />;
}

/** One line under the title: what the element contains or is. */
function Summary({ item }: { item: GraphItem }) {
  const derived = useDerived();
  const { owner, mastery } = useGraph();
  const node = item.node;
  switch (item.kind) {
    case "category": {
      const kids = node!.childIds.map((id) => derived.tree.nodes.get(id));
      const categories = kids.filter((k) => k?.type === "category").length;
      const knowledge = kids.filter((k) => k?.type === "knowledge").length;
      const sources = derived.hierarchy.sourcesAt.get(node!.id)?.length ?? 0;
      const discussions = derived.hierarchy.discussionsAt.get(node!.id)?.length ?? 0;
      const parts = [
        categories > 0 && plural(categories, "category", "categories"),
        knowledge > 0 && plural(knowledge, "knowledge item"),
        sources > 0 && plural(sources, "source"),
        discussions > 0 && plural(discussions, "discussion"),
      ].filter(Boolean);
      return <span>{parts.length > 0 ? parts.join(" · ") : "Empty"}</span>;
    }
    case "knowledge": {
      const cards = node!.childIds.length;
      return (
        <span>
          {node!.description ? `${node!.description} · ` : ""}
          {cards > 0 ? plural(cards, "flashcard") : "No flashcard"}
        </span>
      );
    }
    case "flashcard": {
      const value = mastery.get(node!.id)?.value;
      return (
        <span>
          {!owner ? "Question and answer" : value === undefined ? "Not reviewed yet" : "Mastery"}
        </span>
      );
    }
    case "source": {
      const year = node!.published?.slice(0, 4);
      const who = [node!.authors.join(", "), year].filter(Boolean).join(", ");
      return (
        <span>
          {who ? `${who} · ` : ""}
          {node!.sourceIndex?.root ? "Indexed" : "Not indexed"}
        </span>
      );
    }
    case "section": {
      const proposed = indexKnowledge(item.section!).length;
      return (
        <span>
          {item.section!.description}
          {proposed > 0 ? ` · ${plural(proposed, "knowledge item")} to extract` : ""}
        </span>
      );
    }
    case "discussion": {
      const meta = item.discussion!.meta;
      return (
        <span>
          {[meta.created && formatDate(meta.created), plural(meta.messages, "message")]
            .filter(Boolean)
            .join(" · ")}
        </span>
      );
    }
  }
}

function Badges({ item }: { item: GraphItem }) {
  const derived = useDerived();
  const { owner, mastery, threshold } = useGraph();
  const node = item.node ?? item.source;
  if (!node) return null;
  const value = item.node ? mastery.get(item.node.id) : undefined;
  return (
    <span className="graph-card__badges">
      {owner && item.node && value?.value !== undefined && (
        <MasteryMeter
          value={value.value}
          threshold={threshold}
          compact
          label={
            item.kind === "flashcard"
              ? "Mastery"
              : `Average mastery (${plural(value.count, "flashcard")})`
          }
        />
      )}
      {item.kind === "knowledge" && !node.sourced && <UnsourcedBadge compact />}
      {item.node && derived.pendingNodes.has(item.node.id) && (
        <span className="oe-badge oe-badge--warning" title="Changes not saved yet">
          Not saved
        </span>
      )}
      {owner && item.node && (
        <VisibilityBadge visibility={item.node.isPublic ? "public" : "private"} compact />
      )}
      {!owner && item.kind === "source" && !node.isPublic && !node.virtual && (
        <RecordBadge compact />
      )}
    </span>
  );
}

// ---- Content of a selected card ---------------------------------------------------------------

function PageText({ node, render }: { node: WikiNode; render(body: string): ReactNode }) {
  const { data, loading } = useText(node.virtual ? undefined : node.indexPath);
  if (loading) return <Spinner small label="Loading" />;
  const body = data ? parsePage(data).body : "";
  return body.trim() ? <>{render(body)}</> : null;
}

function CategoryContent({ node }: { node: WikiNode }) {
  const derived = useDerived();
  const { owner, editable } = useGraph();
  // When reading the public part, `_summary.md` holds the public description.
  const file = node.summaries.private ?? node.summaries.public;
  const { data, loading } = useText(file?.path);
  const state = owner ? derived.summaryStates.private.get(node.id) : undefined;
  const summary = data ? parseSummary(data) : undefined;
  return (
    <>
      {(file || state?.status === "missing") && (
        <div className="graph-card__description" aria-label="Sub-wiki description">
          <span className="graph-card__label">
            Description <SummaryStatusBadge state={state} />
            {editable && (state?.status === "stale" || state?.status === "missing") && (
              <a href={href({ name: "summaries", id: node.id })}>
                {state.status === "missing" ? "Generate" : "Regenerate"}
              </a>
            )}
          </span>
          {loading && <Spinner small label="Loading" />}
          {summary && <Markdown text={summary.body} path={file!.path} />}
          {!file && <p className="muted small">This sub-wiki has no description yet.</p>}
        </div>
      )}
      <PageText
        node={node}
        render={(body) => (
          <div className="graph-card__text">
            <Markdown text={body} path={node.indexPath} />
          </div>
        )}
      />
    </>
  );
}

function KnowledgeContent({ node }: { node: WikiNode }) {
  const derived = useDerived();
  const sources = node.refs
    .map((id) => derived.tree.nodes.get(id))
    .filter((n): n is WikiNode => n?.type === "source");
  return (
    <>
      <PageText
        node={node}
        render={(body) => (
          <div className="graph-card__text">
            <Markdown
              text={parseKnowledgeBody(body).statement}
              path={node.indexPath}
              className="prose knowledge"
            />
          </div>
        )}
      />
      {sources.length > 0 && (
        <p className="muted small">
          From{" "}
          {sources.map((s, i) => (
            <span key={s.id}>
              {i > 0 && ", "}
              <a href={href({ name: "node", id: s.id })}>{s.title}</a>
            </span>
          ))}
        </p>
      )}
    </>
  );
}

function FlashcardContent({ node }: { node: WikiNode }) {
  const [shown, setShown] = useState(false);
  return (
    <PageText
      node={node}
      render={(body) => {
        const card = parseFlashcardBody(body);
        return (
          <div className="graph-card__text">
            <Markdown text={card.question || "_(missing question)_"} path={node.indexPath} />
            {shown ? (
              <Markdown text={card.answer || "_(missing answer)_"} path={node.indexPath} />
            ) : (
              <button
                type="button"
                className="oe-button oe-button--ghost oe-button--sm"
                onClick={() => setShown(true)}
              >
                Show the answer
              </button>
            )}
          </div>
        );
      }}
    />
  );
}

/** State of the index of a source, for the owner. */
function useIndexStatus(node: WikiNode, enabled: boolean): SourceIndexStatus | null {
  const workspace = useWiki((s) => s.workspace);
  const version = useWiki((s) => s.version);
  const [status, setStatus] = useState<SourceIndexStatus | null>(null);
  useEffect(() => {
    if (!workspace || !enabled) return;
    let cancelled = false;
    sourceIndexState(workspace, node).then(
      (state) => !cancelled && setStatus(state.status),
      () => !cancelled && setStatus(null),
    );
    return () => {
      cancelled = true;
    };
  }, [workspace, enabled, node, version]);
  return status;
}

/**
 * Knowledge proposed by a part of an index (and the parts below it): added to the wiki in one
 * click, without review, or reviewed first; never added on its own.
 */
function ProposedKnowledge({
  source,
  section,
  list,
}: {
  source: WikiNode;
  section: SourceIndexNode;
  /** List the items of this part, each with its own button. */
  list: boolean;
}) {
  const derived = useDerived();
  const { editable } = useGraph();
  const [adding, setAdding] = useState<string | null>(null);
  const all = indexKnowledge(section).map((k) => k.candidate);
  if (all.length === 0) return null;
  const remaining = newCandidates(derived.tree, source.id, all).length;
  const inWiki = new Map<string, WikiNode>();
  for (const n of derived.tree.nodes.values()) {
    if (n.type === "knowledge" && (n.extractedFrom === source.id || n.refs.includes(source.id)))
      inWiki.set(knowledgeKey(n.title), n);
  }
  const add = async (title?: string): Promise<void> => {
    setAdding(title ?? "");
    try {
      const added = await addProposedKnowledge(source.id, section.key, title);
      toast(`${plural(added, "knowledge item")} added to your wiki.`, "success");
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setAdding(null);
    }
  };
  return (
    <div className="graph-card__proposed">
      <span className="graph-card__label">
        {plural(all.length, "knowledge item")} to extract
        {remaining < all.length ? ` · ${all.length - remaining} in your wiki` : ""}
      </span>
      {list && section.knowledge.length > 0 && (
        <ul>
          {section.knowledge.map((k, i) => {
            const existing = inWiki.get(knowledgeKey(k.title));
            return (
              <li key={i}>
                <span>{k.title}</span>
                {existing ? (
                  <a className="oe-badge" href={href({ name: "node", id: existing.id })}>
                    In your wiki
                  </a>
                ) : (
                  editable && (
                    <button
                      type="button"
                      className="oe-button oe-button--ghost oe-button--sm icon-only"
                      disabled={adding !== null}
                      onClick={() => void add(k.title)}
                      aria-label={`Add "${k.title}" to my wiki`}
                      title="Add to my wiki"
                    >
                      {adding === k.title ? <Spinner small label="Adding" /> : <Plus />}
                    </button>
                  )
                )}
              </li>
            );
          })}
        </ul>
      )}
      {editable && remaining > 0 && (
        <span className="graph-card__row">
          <button
            type="button"
            className="oe-button oe-button--secondary oe-button--sm"
            disabled={adding !== null}
            onClick={() => void add()}
          >
            {adding === "" ? <Spinner small label="Adding" /> : <Plus aria-hidden="true" />} Add{" "}
            {remaining > 1 ? `these ${remaining} items` : "it"} to my wiki
          </button>
          <a
            className="oe-button oe-button--ghost oe-button--sm"
            href={href({ name: "extract", id: source.id, index: section.key || "." })}
          >
            <Highlighter aria-hidden="true" /> Review first
          </a>
        </span>
      )}
    </div>
  );
}

function SourceContent({ node }: { node: WikiNode }) {
  const derived = useDerived();
  const { owner } = useGraph();
  const record = !owner && !node.isPublic && !node.virtual;
  const { index, loading } = useSourceIndex(record ? undefined : node);
  const status = useIndexStatus(node, owner);
  const job = useTasks((s) => s.tasks[node.id]);
  const category = node.filedIn ? derived.tree.nodes.get(node.filedIn) : undefined;
  const used = derived.knowledgeBySource.get(node.id)?.length ?? 0;
  return (
    <>
      <dl className="graph-card__record">
        {node.authors.length > 0 && (
          <>
            <dt>Authors</dt>
            <dd>{node.authors.join(", ")}</dd>
          </>
        )}
        {node.published && (
          <>
            <dt>Published</dt>
            <dd>{node.published}</dd>
          </>
        )}
        {node.url && (
          <>
            <dt>Address</dt>
            <dd>
              <a href={node.url} target="_blank" rel="noreferrer">
                {node.url.replace(/^https?:\/\//, "")}
              </a>
            </dd>
          </>
        )}
        <dt>Filed in</dt>
        <dd>
          {category && category.id !== derived.tree.rootId
            ? category.title
            : "Not filed in a category yet"}
        </dd>
        <dt>Cited by</dt>
        <dd>{used > 0 ? plural(used, "knowledge item") : "No knowledge item yet"}</dd>
      </dl>
      {record && (
        <p className="muted small">
          The content of this source is private: only its bibliographic record is published.
        </p>
      )}
      {job ? (
        <IndexingProgress sourceId={node.id} />
      ) : (
        owner &&
        status && (
          <p className="muted small">
            <ListTree aria-hidden="true" className="inline-icon" /> {INDEX_STATUS_LABELS[status]}
            {index?.generated && status !== "missing"
              ? ` · indexed on ${formatDate(index.generated)} by ${index.model}`
              : ""}
          </p>
        )
      )}
      {loading && !index && <Spinner small label="Loading the index" />}
      {index && (
        <>
          <div className="graph-card__text">
            <p>{index.root.description}</p>
          </div>
          <ProposedKnowledge source={node} section={index.root} list={false} />
        </>
      )}
    </>
  );
}

function SectionContent({ source, section }: { source: WikiNode; section: SourceIndexNode }) {
  return (
    <>
      <div className="graph-card__text">
        <p>{section.description}</p>
      </div>
      <ProposedKnowledge source={source} section={section} list />
    </>
  );
}

function DiscussionContent({ item }: { item: GraphItem }) {
  const meta = item.discussion!.meta;
  return (
    <div className="graph-card__text">
      {meta.preview ? <p>{meta.preview}</p> : <p className="muted">No message yet.</p>}
    </div>
  );
}

// ---- Actions ----------------------------------------------------------------------------------

function ActionLink({ to, icon, children }: { to: string; icon: ReactNode; children: ReactNode }) {
  return (
    <a className="oe-button oe-button--ghost oe-button--sm" href={to}>
      {icon} {children}
    </a>
  );
}

function ActionButton({
  onClick,
  icon,
  children,
}: {
  onClick(): void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button type="button" className="oe-button oe-button--ghost oe-button--sm" onClick={onClick}>
      {icon} {children}
    </button>
  );
}

/** Every action on a page, as on its own page. */
function PageActions({ item }: { item: GraphItem }) {
  const derived = useDerived();
  const { owner, editable, focusId, openDialog } = useGraph();
  const settings = useSettings((s) => s.settings);
  const job = useTasks((s) => (item.node ? s.tasks[item.node.id] : undefined));
  const node = item.node!;
  const isRoot = node.id === derived.tree.rootId;
  const isSource = node.type === "source";
  const cards = node.type === "flashcard" ? [] : flashcardsUnder(derived.tree, node.id);
  const movable =
    !isRoot && !isSource && node.parentId !== null && node.parentId !== derived.tree.libraryId;
  const record = isSource && !owner && !node.isPublic && !node.virtual;
  return (
    <div className="graph-card__actions" role="group" aria-label={`Actions on ${node.title}`}>
      <a
        className="oe-button oe-button--secondary oe-button--sm"
        href={href({ name: "node", id: node.id })}
      >
        <ExternalLink aria-hidden="true" /> Open the page
      </a>
      {node.id !== focusId && item.expandable && node.type === "category" && (
        <ActionLink
          to={href({ name: "graph", id: node.id })}
          icon={<Crosshair aria-hidden="true" />}
        >
          Center here
        </ActionLink>
      )}
      {editable && !node.virtual && (
        <ActionLink to={href({ name: "edit", id: node.id })} icon={<Pencil aria-hidden="true" />}>
          Edit
        </ActionLink>
      )}
      {editable && node.type === "category" && (
        <>
          <ActionLink
            to={href({ name: "new", parentId: node.id, type: "knowledge" })}
            icon={<Lightbulb aria-hidden="true" />}
          >
            Knowledge
          </ActionLink>
          <ActionLink
            to={href({ name: "new", parentId: node.id, type: "category" })}
            icon={<Folder aria-hidden="true" />}
          >
            Subcategory
          </ActionLink>
          <ActionLink
            to={href({
              name: "new",
              parentId: derived.tree.libraryId,
              type: "source",
              ...(isRoot ? {} : { category: node.id }),
            })}
            icon={<Plus aria-hidden="true" />}
          >
            Source
          </ActionLink>
        </>
      )}
      {editable && node.type === "knowledge" && (
        <ActionLink
          to={href({ name: "new", parentId: node.id, type: "flashcard" })}
          icon={<Layers aria-hidden="true" />}
        >
          Flashcard
        </ActionLink>
      )}
      {editable && isSource && !node.virtual && hasIndexing(settings) && !job && (
        <ActionButton
          onClick={() => indexSourceNode(node.id)}
          icon={<RefreshCw aria-hidden="true" />}
        >
          {node.sourceIndex?.root ? "Index again" : "Index"}
        </ActionButton>
      )}
      {editable && isSource && !record && (
        <ActionLink
          to={href({ name: "extract", id: node.id })}
          icon={<Highlighter aria-hidden="true" />}
        >
          Extract knowledge
        </ActionLink>
      )}
      {editable && isSource && !node.virtual && (
        <ActionButton
          onClick={() => openDialog({ kind: "file", node })}
          icon={<FolderInput aria-hidden="true" />}
        >
          File in…
        </ActionButton>
      )}
      {owner && cards.length > 0 && (
        <ActionLink
          to={href({ name: "quiz", id: node.id })}
          icon={<GraduationCap aria-hidden="true" />}
        >
          Quiz
        </ActionLink>
      )}
      {node.type === "category" && (node.childIds.length > 0 || isRoot) && (
        <ActionLink
          to={href({ name: "ask", id: node.id })}
          icon={<MessageCircleQuestion aria-hidden="true" />}
        >
          Questions
        </ActionLink>
      )}
      {editable && (
        <ActionLink
          to={href({ name: "discussion", about: node.id })}
          icon={<MessageSquare aria-hidden="true" />}
        >
          Discuss
        </ActionLink>
      )}
      {editable && (
        <ActionButton
          onClick={() => openDialog({ kind: "visibility", node })}
          icon={<Shield aria-hidden="true" />}
        >
          {node.isPublic ? "Make private" : "Make public"}
        </ActionButton>
      )}
      {editable && movable && (
        <ActionButton
          onClick={() => openDialog({ kind: "move", node })}
          icon={<MoveRight aria-hidden="true" />}
        >
          Move
        </ActionButton>
      )}
      {editable && !isRoot && (
        <ActionButton
          onClick={() => openDialog({ kind: "delete", node })}
          icon={<Trash2 aria-hidden="true" />}
        >
          Delete
        </ActionButton>
      )}
    </div>
  );
}

function OtherActions({ item }: { item: GraphItem }) {
  const { editable } = useGraph();
  if (item.kind === "section") {
    return (
      <div className="graph-card__actions" role="group" aria-label={`Actions on ${item.title}`}>
        <a
          className="oe-button oe-button--secondary oe-button--sm"
          href={sectionHref(item.source!.id, item.section!.key)}
        >
          <ExternalLink aria-hidden="true" /> Open the part
        </a>
        <ActionLink
          to={href({ name: "node", id: item.source!.id })}
          icon={<ListTree aria-hidden="true" />}
        >
          The source
        </ActionLink>
      </div>
    );
  }
  const path = item.discussion!.path;
  return (
    <div className="graph-card__actions" role="group" aria-label={`Actions on ${item.title}`}>
      <a
        className="oe-button oe-button--secondary oe-button--sm"
        href={href({ name: "discussion", path })}
      >
        <ExternalLink aria-hidden="true" /> Open the discussion
      </a>
      {editable && (
        <ActionLink
          to={href({ name: "extract", discussion: path })}
          icon={<Highlighter aria-hidden="true" />}
        >
          Extract knowledge
        </ActionLink>
      )}
    </div>
  );
}

function Content({ item }: { item: GraphItem }) {
  switch (item.kind) {
    case "category":
      return <CategoryContent node={item.node!} />;
    case "knowledge":
      return <KnowledgeContent node={item.node!} />;
    case "flashcard":
      return <FlashcardContent node={item.node!} />;
    case "source":
      return <SourceContent node={item.node!} />;
    case "section":
      return <SectionContent source={item.source!} section={item.section!} />;
    case "discussion":
      return <DiscussionContent item={item} />;
  }
}

// ---- Card -------------------------------------------------------------------------------------

export const GraphCard = memo(function GraphCard({ data, selected }: NodeProps<GraphCardNode>) {
  const { item } = data;
  const derived = useDerived();
  const { toggle, focusId } = useGraph();
  const count = item.childCount;
  return (
    <div
      className={`graph-card graph-card--${item.kind}${selected ? " is-selected" : ""}${
        item.id === focusId ? " is-focus" : ""
      }`}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="graph-card__head">
        <span className="graph-card__kind">
          <KindIcon item={item} /> <span>{kindLabel(item, derived.tree.rootId)}</span>
        </span>
        <Badges item={item} />
      </div>
      <span className="graph-card__title">{item.title}</span>
      {/* Selected, a knowledge item or a part of an index shows its whole text instead. */}
      {!(selected && (item.kind === "section" || item.kind === "knowledge")) && (
        <span className="graph-card__summary">
          <Summary item={item} />
        </span>
      )}
      {selected && (
        <div className="graph-card__body nodrag nowheel nopan">
          <Content item={item} />
          {item.node ? <PageActions item={item} /> : <OtherActions item={item} />}
        </div>
      )}
      {item.expandable && item.depth > 0 && (
        <button
          type="button"
          className="graph-card__toggle nodrag"
          aria-expanded={item.expanded}
          aria-label={`${item.expanded ? "Fold" : "Unfold"} ${item.title}${
            count > 0 ? ` (${count})` : ""
          }`}
          title={item.expanded ? "Fold" : "Unfold"}
          onClick={(e) => {
            e.stopPropagation();
            toggle(item.id);
          }}
        >
          {!item.expanded && count > 0 && <span>{count}</span>}
          {item.expanded ? <ChevronLeft aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
        </button>
      )}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
});
