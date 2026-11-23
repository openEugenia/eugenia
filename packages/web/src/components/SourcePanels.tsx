/**
 * The library in the common hierarchy (§5.10, §8.6): the category a source is filed in, the
 * index of a source (its knowledge tree, browsed like the wiki), and the sources filed in a
 * category.
 */
import { useEffect, useState } from "react";
import { FolderInput, Highlighter, ListTree, Plus, RefreshCw, Square } from "lucide-react";
import {
  hierarchyAncestors,
  indexKnowledge,
  isCategory,
  knowledgeKey,
  newCandidates,
  sourceIndexState,
  sourcesIn,
  sourcesInBranch,
  updatePage,
  type SourceIndexNode,
  type SourceIndexStatus,
  type WikiNode,
} from "@openeugenia/core";
import { formatDate, plural } from "../lib/format.ts";
import { useCanEdit, useDerived, useIsOwner } from "../lib/hooks.ts";
import {
  addProposedKnowledge,
  cancelIndexing,
  indexSourceNode,
  useIndexing,
  useSourceIndex,
} from "../lib/indexing.ts";
import { href } from "../lib/router.ts";
import { hasIndexing } from "../lib/settings.ts";
import { useSettings } from "../store/settings.ts";
import { errorMessage, toast } from "../store/ui.ts";
import { useWiki } from "../store/wiki.ts";
import { Markdown } from "./Markdown.tsx";
import { NodePicker } from "./NodePicker.tsx";
import { SourceKindIcon, Spinner, VisibilityBadge } from "./common.tsx";

/** Files a source in a category (`null`: at the root), in one commit. */
export async function fileSource(source: WikiNode, category: WikiNode | null): Promise<void> {
  const { workspace, stage, commit } = useWiki.getState();
  if (!workspace) return;
  const rootId = workspace.tree.rootId;
  const changes = await updatePage(workspace, source.id, {
    category: category && category.id !== rootId ? category.id : null,
  });
  const message = `File "${source.title}" in "${category?.title ?? workspace.tree.nodes.get(rootId)!.title}"`;
  await stage(changes, message);
  await commit(
    message,
    changes.map((c) => c.path),
  );
}

/** Category a source is filed in, and the button to file it elsewhere. */
export function SourceFiling({ node }: { node: WikiNode }) {
  const derived = useDerived();
  const editable = useCanEdit();
  const [picker, setPicker] = useState(false);
  const category = node.filedIn ? derived.tree.nodes.get(node.filedIn) : undefined;
  const chain = category ? [...hierarchyAncestors(derived.tree, category), category] : [];
  const unfiled = !node.filedIn || node.filedIn === derived.tree.rootId;
  return (
    <p className="muted small source-filing">
      <FolderInput aria-hidden="true" className="inline-icon" />{" "}
      {unfiled ? (
        "Not filed in a category yet: it is at the root of your wiki."
      ) : (
        <>
          Filed in{" "}
          {chain.map((c, i) => (
            <span key={c.id}>
              {i > 0 && " › "}
              <a href={href({ name: "node", id: c.id })}>{c.title}</a>
            </span>
          ))}
        </>
      )}
      {editable && (
        <button
          type="button"
          className="oe-button oe-button--ghost oe-button--sm"
          onClick={() => setPicker(true)}
        >
          {unfiled ? "File it" : "Change"}
        </button>
      )}
      {picker && (
        <NodePicker
          open
          title={`File "${node.title}" in…`}
          hint="The category of the wiki this source deals with: it then appears in this category, and questions about it search it."
          tree={derived.tree}
          filter={(n) => isCategory(n) && n.id !== node.filedIn}
          onClose={() => setPicker(false)}
          onSelect={(target) => {
            setPicker(false);
            fileSource(node, target).catch((error: unknown) => toast(errorMessage(error), "error"));
          }}
        />
      )}
    </p>
  );
}

export const INDEX_STATUS_LABELS: Record<SourceIndexStatus, string> = {
  current: "Up to date",
  stale: "The source changed since it was indexed",
  missing: "Not indexed",
  invalid: "Unreadable index",
};

/** Progress of the indexing of a source, if it is queued or running. */
export function IndexingProgress({ sourceId }: { sourceId: string }) {
  const job = useIndexing((s) => s.jobs[sourceId]);
  if (!job) return null;
  return (
    <span className="indexing-progress small">
      <Spinner small label="Indexing" />
      {job.status === "queued"
        ? "Waiting to be indexed…"
        : job.extracting
          ? "Adding the proposed knowledge to your wiki…"
          : job.assembling
            ? "Gathering the parts of the source…"
            : job.total > 1
              ? `Reading the source: part ${Math.min(job.done + 1, job.total)} of ${job.total}…`
              : "Eugenia is reading the source…"}
      <button
        type="button"
        className="oe-button oe-button--ghost oe-button--sm"
        onClick={() => cancelIndexing(sourceId)}
      >
        <Square aria-hidden="true" /> Stop
      </button>
    </span>
  );
}

/** Address of a section of the index of a source (`""`: the source itself). */
export function sectionHref(sourceId: string, key: string): string {
  return key
    ? href({ name: "node", id: sourceId, section: key })
    : href({ name: "node", id: sourceId });
}

/** Sections of an index, as cards, like the subcategories of a category. */
export function IndexCards({
  source,
  nodes,
}: {
  source: WikiNode;
  nodes: readonly SourceIndexNode[];
}) {
  return (
    <div className="children-grid">
      {nodes.map((node) => {
        const knowledge = indexKnowledge(node).length;
        return (
          <a key={node.key} className="child-card" href={sectionHref(source.id, node.key)}>
            <span className="child-card__title">
              <ListTree aria-hidden="true" /> {node.name}
            </span>
            {node.description && <span className="child-card__text">{node.description}</span>}
            <span className="badges">
              {node.children.length > 0 && (
                <span className="muted small">{plural(node.children.length, "part")}</span>
              )}
              {knowledge > 0 && (
                <span className="muted small">
                  {plural(knowledge, "knowledge item")} to extract
                </span>
              )}
            </span>
          </a>
        );
      })}
    </div>
  );
}

/**
 * Knowledge proposed by a node of the index (and, in a count, by the nodes below it): what is
 * already in the wiki links to it; the rest is added in one click, without review (or reviewed
 * first in the extraction).
 */
export function ProposedKnowledge({ source, node }: { source: WikiNode; node: SourceIndexNode }) {
  const derived = useDerived();
  const editable = useCanEdit();
  const [adding, setAdding] = useState(false);
  const all = indexKnowledge(node).map((k) => k.candidate);
  if (all.length === 0) return null;
  // Knowledge of the wiki drawn from this source, by title.
  const inWiki = new Map<string, WikiNode>();
  for (const n of derived.tree.nodes.values()) {
    if (n.type === "knowledge" && (n.extractedFrom === source.id || n.refs.includes(source.id))) {
      inWiki.set(knowledgeKey(n.title), n);
    }
  }
  const remaining = newCandidates(derived.tree, source.id, all).length;
  const add = async (): Promise<void> => {
    setAdding(true);
    try {
      const added = await addProposedKnowledge(source.id, node.key);
      toast(`${plural(added, "knowledge item")} added to your wiki.`, "success");
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setAdding(false);
    }
  };
  return (
    <section className="section">
      <div className="section__head">
        <h2>Knowledge to extract</h2>
        {editable && remaining > 0 && (
          <div className="actions">
            <a
              className="oe-button oe-button--ghost oe-button--sm"
              href={href({ name: "extract", id: source.id, index: node.key || "." })}
            >
              <Highlighter aria-hidden="true" /> Review first
            </a>
            <button
              type="button"
              className="oe-button oe-button--secondary oe-button--sm"
              disabled={adding}
              onClick={() => void add()}
            >
              {adding ? <Spinner small label="Adding" /> : <Plus aria-hidden="true" />} Add{" "}
              {remaining > 1 ? `these ${remaining} items` : "it"} to my wiki
            </button>
          </div>
        )}
      </div>
      {remaining === 0 && <p className="muted small">Everything proposed here is in your wiki.</p>}
      {node.knowledge.length > 0 ? (
        <ul className="proposed-knowledge">
          {node.knowledge.map((k, i) => {
            const existing = inWiki.get(knowledgeKey(k.title));
            return (
              <li key={i} className="oe-card">
                <span className="proposed-knowledge__title">
                  {k.title}
                  {existing && (
                    <a className="oe-badge" href={href({ name: "node", id: existing.id })}>
                      In your wiki
                    </a>
                  )}
                </span>
                <Markdown text={k.statement} path={source.indexPath} className="prose knowledge" />
                {k.question && (
                  <span className="muted small">
                    {k.question} → {k.answer}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      {all.length > node.knowledge.length && (
        <p className="muted small">
          {node.knowledge.length > 0 ? "And " : ""}
          {plural(all.length - node.knowledge.length, "item")} proposed in the parts below.
        </p>
      )}
    </section>
  );
}

/**
 * Index of a source on its page: state, generation in the background, summary of the source,
 * knowledge to extract and the sections, to browse like the wiki.
 */
export function SourceIndexPanel({ node }: { node: WikiNode }) {
  const workspace = useWiki((s) => s.workspace);
  const version = useWiki((s) => s.version);
  const owner = useIsOwner();
  const editable = useCanEdit();
  const settings = useSettings((s) => s.settings);
  const job = useIndexing((s) => s.jobs[node.id]);
  const { index, loading } = useSourceIndex(node);
  const [status, setStatus] = useState<SourceIndexStatus | null>(null);

  useEffect(() => {
    if (!workspace || !owner) return;
    let cancelled = false;
    sourceIndexState(workspace, node).then(
      (state) => !cancelled && setStatus(state.status),
      () => !cancelled && setStatus(null),
    );
    return () => {
      cancelled = true;
    };
  }, [workspace, owner, node, version]);

  const configured = hasIndexing(settings);
  return (
    <section className="section" id="source-index">
      <div className="section__head">
        <h2>
          <ListTree aria-hidden="true" className="inline-icon" /> Index of the source
        </h2>
        {editable && configured && !job && (
          <button
            type="button"
            className="oe-button oe-button--ghost oe-button--sm"
            onClick={() => indexSourceNode(node.id)}
          >
            <RefreshCw aria-hidden="true" /> {index ? "Index again" : "Index this source"}
          </button>
        )}
      </div>
      {job ? (
        <p>
          <IndexingProgress sourceId={node.id} />
        </p>
      ) : (
        owner &&
        status && (
          <p className="muted small">
            {INDEX_STATUS_LABELS[status]}
            {index?.generated && status !== "missing"
              ? ` · indexed on ${formatDate(index.generated)} by ${index.model}`
              : ""}
            .{" "}
            {editable &&
              (configured ? (
                <a href={href({ name: "indexes" })}>All the indexes</a>
              ) : (
                <>
                  Add a Mistral key in the <a href={href({ name: "settings" })}>settings</a> to
                  index your sources.
                </>
              ))}
          </p>
        )
      )}
      {loading && !index && <Spinner small label="Loading the index" />}
      {!index && !loading && !job && (
        <p className="muted small">
          An index describes the whole content of a source as a tree of knowledge, browsed like your
          wiki, and proposes the knowledge worth extracting. Eugenia answers your questions from it,
          without reading the whole source again.
        </p>
      )}
      {index && (
        <>
          <p className="index-summary">{index.root.description}</p>
          {index.root.children.length > 0 && (
            <IndexCards source={node} nodes={index.root.children} />
          )}
          <ProposedKnowledge source={node} node={index.root} />
        </>
      )}
    </section>
  );
}

/** Sources filed in a category, with their count in the whole branch. */
export function CategorySources({ node }: { node: WikiNode }) {
  const derived = useDerived();
  const owner = useIsOwner();
  const editable = useCanEdit();
  const direct = sourcesIn(derived.tree, node.id);
  const isRoot = node.id === derived.tree.rootId;
  const all = isRoot ? direct : sourcesInBranch(derived.tree, node.id);
  // At the root: the sources not filed in a category yet.
  if (all.length === 0 && (!editable || isRoot)) return null;
  return (
    <section className="section">
      <div className="section__head">
        <h2>{isRoot ? "Sources to file in a category" : "Sources"}</h2>
        <div className="actions">
          {all.length > direct.length && (
            <a
              className="oe-button oe-button--ghost oe-button--sm"
              href={href({ name: "library", category: node.id })}
            >
              {plural(all.length, "source")} in this branch
            </a>
          )}
          {editable && (
            <a
              className="oe-button oe-button--ghost oe-button--sm"
              href={href({
                name: "new",
                parentId: derived.tree.libraryId,
                type: "source",
                category: node.id,
              })}
            >
              <Plus aria-hidden="true" /> Add a source
            </a>
          )}
        </div>
      </div>
      {direct.length === 0 ? (
        <p className="muted small">
          {isRoot
            ? "No source waiting to be filed."
            : "No source is filed directly in this category."}
        </p>
      ) : (
        <ul className="link-list">
          {direct.map((s) => (
            <li key={s.id}>
              <SourceKindIcon kind={s.sourceKind} />
              <a href={href({ name: "node", id: s.id })}>{s.title}</a>
              {s.sourceIndex?.root && (
                <ListTree aria-label="Indexed" className="inline-icon muted" />
              )}
              {owner && <VisibilityBadge visibility={s.isPublic ? "public" : "private"} compact />}
              {s.description && <span className="muted small">{s.description}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
