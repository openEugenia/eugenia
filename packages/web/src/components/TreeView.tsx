/**
 * Wiki tree (side panel): the common hierarchy (§5.10) — categories and atomic knowledge, the
 * sources filed in the categories and, on demand, the discussions placed under the pages —
 * collapsible, badges, gauges, drag and drop (a source dropped on a category is filed in it)
 * (§9.2). Flashcards are viewed from their knowledge item.
 */
import { useEffect, useMemo, useState, type DragEvent } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  hierarchyAncestors,
  isAncestorOf,
  isCategory,
  placementProblem,
  type PlacedDiscussion,
  type WikiNode,
  type WikiTree,
} from "@openeugenia/core";
import { branchMasteryMap } from "../lib/mastery.ts";
import { href } from "../lib/router.ts";
import type { Derived } from "../lib/workspace.ts";
import { MasteryMeter } from "./charts.tsx";
import { DiscussionKindIcon, TypeIcon, UnsourcedBadge, VisibilityBadge } from "./common.tsx";

interface TreeViewProps {
  derived: Derived;
  currentId: string | undefined;
  owner: boolean;
  canEdit: boolean;
  storageKey: string;
  onMove(nodeId: string, parentId: string): void;
  onNavigate?(): void;
}

const DRAG_TYPE = "application/x-eugenia-node";

interface Shown {
  sources: boolean;
  discussions: boolean;
}

function loadShown(): Shown {
  try {
    const raw = localStorage.getItem("eugenia:tree:shown");
    return raw
      ? { sources: true, discussions: false, ...(JSON.parse(raw) as Partial<Shown>) }
      : { sources: true, discussions: false };
  } catch {
    return { sources: true, discussions: false };
  }
}

function loadExpanded(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(`eugenia:tree:${key}`);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function TreeView({
  derived,
  currentId,
  owner,
  canEdit,
  storageKey,
  onMove,
  onNavigate,
}: TreeViewProps) {
  const { tree, mastery, summaryStates, pendingNodes, config, hierarchy } = derived;
  const [expanded, setExpanded] = useState<Set<string>>(() => loadExpanded(storageKey));
  const [shown, setShown] = useState<Shown>(loadShown);
  const toggleShown = (key: keyof Shown): void =>
    setShown((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try {
        localStorage.setItem("eugenia:tree:shown", JSON.stringify(next));
      } catch {
        // storage unavailable
      }
      return next;
    });
  const filedSources = (id: string): WikiNode[] =>
    shown.sources ? (hierarchy.sourcesAt.get(id) ?? []) : [];
  const placedDiscussions = (id: string): PlacedDiscussion[] =>
    shown.discussions
      ? (hierarchy.discussionsAt.get(id) ?? []).filter((d) => d.meta.kind !== "quiz")
      : [];
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const branch = useMemo(() => branchMasteryMap(tree, mastery), [tree, mastery]);
  // An open flashcard is shown on its knowledge item.
  const currentNode = currentId ? tree.nodes.get(currentId) : undefined;
  const highlighted =
    currentNode?.type === "flashcard" && currentNode.parentId ? currentNode.parentId : currentId;

  // The current node is always visible: its ancestors are expanded.
  useEffect(() => {
    const current = currentId ? tree.nodes.get(currentId) : undefined;
    if (!current) return;
    const chain = hierarchyAncestors(tree, current).map((a) => a.id);
    setExpanded((prev) =>
      chain.every((id) => prev.has(id)) ? prev : new Set([...prev, ...chain]),
    );
  }, [currentId, tree]);

  useEffect(() => {
    try {
      localStorage.setItem(`eugenia:tree:${storageKey}`, JSON.stringify([...expanded]));
    } catch {
      // storage unavailable
    }
  }, [expanded, storageKey]);

  const toggle = (id: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const canDrop = (targetId: string): boolean => {
    const moving = dragging ? tree.nodes.get(dragging) : undefined;
    // A source is filed in a category by dropping it there.
    if (moving?.type === "source") {
      const target = tree.nodes.get(targetId);
      return target !== undefined && isCategory(target) && moving.filedIn !== targetId;
    }
    return (
      moving !== undefined &&
      moving.id !== targetId &&
      !isAncestorOf(tree, moving.id, targetId) &&
      moving.parentId !== targetId &&
      placementProblem(tree, moving, targetId) === null
    );
  };

  const renderNode = (node: WikiNode, tree: WikiTree): React.ReactNode => {
    const open = expanded.has(node.id) || node.id === tree.rootId;
    const visibleChildren =
      node.type === "knowledge"
        ? []
        : node.childIds.filter((id) => tree.nodes.get(id)?.type !== "flashcard");
    const sources = node.type === "category" ? filedSources(node.id) : [];
    const discussions = node.type === "source" ? [] : placedDiscussions(node.id);
    const hasChildren = visibleChildren.length + sources.length + discussions.length > 0;
    const stale =
      owner && ["stale", "missing"].includes(summaryStates.private.get(node.id)?.status ?? "");
    const branchMastery = branch.get(node.id);
    const dragProps =
      canEdit && node.id !== tree.rootId
        ? {
            draggable: true,
            onDragStart: (e: DragEvent) => {
              e.dataTransfer.setData(DRAG_TYPE, node.id);
              e.dataTransfer.effectAllowed = "move";
              setDragging(node.id);
            },
            onDragEnd: () => {
              setDragging(null);
              setDropTarget(null);
            },
          }
        : {};
    const dropProps = canEdit
      ? {
          onDragOver: (e: DragEvent) => {
            if (!canDrop(node.id)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setDropTarget(node.id);
          },
          onDragLeave: () => setDropTarget((t) => (t === node.id ? null : t)),
          onDrop: (e: DragEvent) => {
            e.preventDefault();
            const id = e.dataTransfer.getData(DRAG_TYPE);
            setDropTarget(null);
            setDragging(null);
            if (id && id !== node.id) onMove(id, node.id);
          },
        }
      : {};
    return (
      <li key={node.id}>
        <div
          className={`tree-row${node.id === highlighted ? " is-current" : ""}${dropTarget === node.id ? " is-drop-target" : ""}`}
          {...dragProps}
          {...dropProps}
        >
          {hasChildren && node.id !== tree.rootId ? (
            <button
              type="button"
              className="tree-toggle"
              onClick={() => toggle(node.id)}
              aria-label={open ? `Collapse ${node.title}` : `Expand ${node.title}`}
              aria-expanded={open}
            >
              {open ? <ChevronDown /> : <ChevronRight />}
            </button>
          ) : (
            <span className="tree-spacer" />
          )}
          <a
            href={href({ name: "node", id: node.id })}
            aria-current={node.id === highlighted ? "page" : undefined}
            onClick={onNavigate}
          >
            <TypeIcon node={node} tree={tree} />
            <span className="title">{node.title}</span>
          </a>
          <span className="tree-flags">
            {node.type === "knowledge" && !node.sourced && <UnsourcedBadge compact />}
            {owner && branchMastery?.value !== undefined && (
              <MasteryMeter
                value={branchMastery.value}
                threshold={config.mastery.reminder_threshold}
                compact
              />
            )}
            {stale && (
              <span className="flag-dot flag-dot--stale" title="Stale or missing description" />
            )}
            {pendingNodes.has(node.id) && (
              <span
                className="flag-dot flag-dot--pending"
                title="Changed, not saved to the repository yet"
              />
            )}
            {owner && <VisibilityBadge visibility={node.isPublic ? "public" : "private"} compact />}
          </span>
        </div>
        {hasChildren && open && (
          <ul className="tree">
            {visibleChildren.map((id) => renderNode(tree.nodes.get(id)!, tree))}
            {sources.map((source) => renderSource(source))}
            {discussions.map((d) => (
              <li key={d.path}>
                <div className="tree-row tree-row--secondary">
                  <span className="tree-spacer" />
                  <a
                    href={href({ name: "discussion", path: d.path })}
                    onClick={onNavigate}
                    title={d.meta.preview ?? d.meta.title}
                  >
                    <DiscussionKindIcon kind={d.meta.kind} />
                    <span className="title">{d.meta.title || "Discussion"}</span>
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  };

  /** A source filed in a category: a leaf, which can be dragged onto another category. */
  const renderSource = (source: WikiNode): React.ReactNode => {
    const discussions = placedDiscussions(source.id);
    const open = expanded.has(source.id);
    return (
      <li key={source.id}>
        <div
          className={`tree-row tree-row--secondary${source.id === highlighted ? " is-current" : ""}`}
          {...(canEdit
            ? {
                draggable: true,
                onDragStart: (e: DragEvent) => {
                  e.dataTransfer.setData(DRAG_TYPE, source.id);
                  e.dataTransfer.effectAllowed = "move";
                  setDragging(source.id);
                },
                onDragEnd: () => {
                  setDragging(null);
                  setDropTarget(null);
                },
              }
            : {})}
        >
          {discussions.length > 0 ? (
            <button
              type="button"
              className="tree-toggle"
              onClick={() => toggle(source.id)}
              aria-label={open ? `Collapse ${source.title}` : `Expand ${source.title}`}
              aria-expanded={open}
            >
              {open ? <ChevronDown /> : <ChevronRight />}
            </button>
          ) : (
            <span className="tree-spacer" />
          )}
          <a
            href={href({ name: "node", id: source.id })}
            aria-current={source.id === highlighted ? "page" : undefined}
            onClick={onNavigate}
          >
            <TypeIcon node={source} tree={tree} />
            <span className="title">{source.title}</span>
          </a>
          <span className="tree-flags">
            {pendingNodes.has(source.id) && (
              <span
                className="flag-dot flag-dot--pending"
                title="Changed, not saved to the repository yet"
              />
            )}
            {owner && (
              <VisibilityBadge visibility={source.isPublic ? "public" : "private"} compact />
            )}
          </span>
        </div>
        {open && discussions.length > 0 && (
          <ul className="tree">
            {discussions.map((d) => (
              <li key={d.path}>
                <div className="tree-row tree-row--secondary">
                  <span className="tree-spacer" />
                  <a href={href({ name: "discussion", path: d.path })} onClick={onNavigate}>
                    <DiscussionKindIcon kind={d.meta.kind} />
                    <span className="title">{d.meta.title || "Discussion"}</span>
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  };

  const root = tree.nodes.get(tree.rootId);
  if (!root) return null;
  return (
    <>
      <div className="chips tree-filters" role="group" aria-label="Shown in the tree">
        {(["sources", "discussions"] as const).map((key) => (
          <button
            key={key}
            type="button"
            className={`chip${shown[key] ? " is-active" : ""}`}
            aria-pressed={shown[key]}
            onClick={() => toggleShown(key)}
          >
            {key === "sources" ? "Sources" : "Discussions"}
          </button>
        ))}
      </div>
      <ul className="tree" aria-label="Wiki tree">
        {renderNode(root, tree)}
      </ul>
    </>
  );
}
