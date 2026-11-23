/**
 * The library in the common hierarchy (§5.10, §8.6): the category a source is filed in, the
 * index of a source (its knowledge tree), and the sources filed in a category.
 */
import { useEffect, useMemo, useState } from "react";
import { FolderInput, ListTree, Plus, RefreshCw, Square } from "lucide-react";
import {
  hierarchyAncestors,
  isCategory,
  parseSourceTree,
  sourcesIn,
  sourcesInBranch,
  sourceTreeState,
  updatePage,
  type KnowledgeNode,
  type SourceTreeStatus,
  type WikiNode,
} from "@openeugenia/core";
import { formatDate, plural } from "../lib/format.ts";
import { useCanEdit, useDerived, useIsOwner, useText } from "../lib/hooks.ts";
import { cancelIndexing, indexSourceNode, useIndexing } from "../lib/indexing.ts";
import { href } from "../lib/router.ts";
import { hasIndexing } from "../lib/settings.ts";
import { useSettings } from "../store/settings.ts";
import { errorMessage, toast } from "../store/ui.ts";
import { useWiki } from "../store/wiki.ts";
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

const STATUS_LABELS: Record<SourceTreeStatus, string> = {
  current: "Up to date",
  stale: "The source changed since it was indexed",
  missing: "Not indexed",
  invalid: "Unreadable index",
};

function Outline({
  node,
  sectionKey,
  selected,
  depth,
}: {
  node: KnowledgeNode;
  sectionKey: string;
  selected: string | undefined;
  depth: number;
}) {
  const onPath =
    selected !== undefined && (selected === sectionKey || selected.startsWith(`${sectionKey}.`));
  const isSelected = selected === sectionKey;
  const body = (
    <>
      {node.description && <p className="outline__text">{node.description}</p>}
      {node.children.length > 0 && (
        <ul className="outline">
          {node.children.map((child, i) => {
            const key = `${sectionKey}.${i + 1}`;
            return (
              <li key={key}>
                <Outline node={child} sectionKey={key} selected={selected} depth={depth + 1} />
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
  return (
    <details
      className={`outline__node${isSelected ? " is-selected" : ""}`}
      open={depth < 1 || onPath}
      id={`section-${sectionKey}`}
      ref={(el) => {
        if (el && isSelected) el.scrollIntoView({ block: "center" });
      }}
    >
      <summary>
        <span className="outline__name">{node.name}</span>
        {node.children.length > 0 && (
          <span className="muted small"> · {plural(node.children.length, "part")}</span>
        )}
      </summary>
      {body}
    </details>
  );
}

/**
 * Index of a source: the knowledge tree that describes its content, its state, and its
 * generation (with the progress of a running indexing).
 */
export function SourceIndexPanel({ node, section }: { node: WikiNode; section?: string }) {
  const workspace = useWiki((s) => s.workspace);
  const version = useWiki((s) => s.version);
  const owner = useIsOwner();
  const editable = useCanEdit();
  const settings = useSettings((s) => s.settings);
  const job = useIndexing((s) => s.jobs[node.id]);
  const file = useText(node.sourceTree?.path);
  const [status, setStatus] = useState<SourceTreeStatus | null>(null);
  const tree = useMemo(() => {
    if (!file.data) return null;
    try {
      return parseSourceTree(file.data);
    } catch {
      return null;
    }
  }, [file.data]);

  useEffect(() => {
    if (!workspace || !owner) return;
    let cancelled = false;
    sourceTreeState(workspace, node).then(
      (state) => !cancelled && setStatus(state.status),
      () => !cancelled && setStatus(null),
    );
    return () => {
      cancelled = true;
    };
  }, [workspace, owner, node, version]);

  const configured = hasIndexing(settings);
  const canIndex = editable && configured && !job;
  const selected = section;

  return (
    <section className="section" id="source-index">
      <div className="section__head">
        <h2>
          <ListTree aria-hidden="true" className="inline-icon" /> Index of the source
        </h2>
        {canIndex && (
          <button
            type="button"
            className="oe-button oe-button--ghost oe-button--sm"
            onClick={() => void indexSourceNode(node.id)}
          >
            <RefreshCw aria-hidden="true" /> {tree ? "Index again" : "Index this source"}
          </button>
        )}
      </div>
      {job ? (
        <p className="small" style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <Spinner small label="Indexing" />
          {job.assembling
            ? "Gathering the parts of the source…"
            : job.total > 1
              ? `Reading the source: part ${Math.min(job.done + 1, job.total)} of ${job.total}…`
              : "Eugenia is reading the source (this can take a minute)…"}
          <button
            type="button"
            className="oe-button oe-button--ghost oe-button--sm"
            onClick={() => cancelIndexing(node.id)}
          >
            <Square aria-hidden="true" /> Stop
          </button>
        </p>
      ) : (
        owner &&
        status && (
          <p className="muted small">
            {STATUS_LABELS[status]}
            {tree?.generated && status !== "missing"
              ? ` · indexed on ${formatDate(tree.generated)} by ${tree.model}`
              : ""}
            .
            {editable && !configured && (
              <>
                {" "}
                Add a Mistral key in the <a href={href({ name: "settings" })}>settings</a> to index
                your sources.
              </>
            )}
          </p>
        )
      )}
      {!tree && !job && (
        <p className="muted small">
          An index describes the whole content of a source as a tree of knowledge: Eugenia then
          answers your questions from it, without reading the whole source again.
        </p>
      )}
      {tree && (
        <div className="outline-root oe-card">
          <p className="outline__summary">{tree.root.description}</p>
          <ul className="outline">
            {tree.root.children.map((child, i) => (
              <li key={i}>
                <Outline node={child} sectionKey={String(i + 1)} selected={selected} depth={0} />
              </li>
            ))}
          </ul>
        </div>
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
          {node.id === derived.tree.rootId
            ? "No source waiting to be filed."
            : "No source is filed directly in this category."}
        </p>
      ) : (
        <ul className="link-list">
          {direct.map((s) => (
            <li key={s.id}>
              <SourceKindIcon kind={s.sourceKind} />
              <a href={href({ name: "node", id: s.id })}>{s.title}</a>
              {s.sourceTree && <ListTree aria-label="Indexed" className="inline-icon muted" />}
              {owner && <VisibilityBadge visibility={s.isPublic ? "public" : "private"} compact />}
              {s.description && <span className="muted small">{s.description}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
