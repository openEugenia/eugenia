/**
 * Wiki tree (side panel): categories and atomic knowledge, collapsible, badges, gauges, drag and
 * drop (§9.2). Flashcards are viewed from their knowledge item. The library and the discussions
 * share this hierarchy (§5.10): each branch shows, discreetly, how many sources and discussions
 * it holds, which open the library or the discussions filtered on it.
 */
import { useEffect, useMemo, useState, type DragEvent } from "react";
import { ChevronDown, ChevronRight, Library, MessagesSquare } from "lucide-react";
import {
  hierarchyAncestors,
  isAncestorOf,
  placementProblem,
  type WikiNode,
  type WikiTree,
} from "@openeugenia/core";
import { branchMasteryMap } from "../lib/mastery.ts";
import { href } from "../lib/router.ts";
import type { Derived } from "../lib/workspace.ts";
import { MasteryMeter } from "./charts.tsx";
import { TypeIcon, UnsourcedBadge, VisibilityBadge } from "./common.tsx";

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

/**
 * Number of sources and discussions in each branch: a source counts for the category it is filed
 * in and its ancestors, a discussion for the page it is placed under and its ancestors.
 */
function branchCounts(derived: Derived): {
  sources: Map<string, number>;
  discussions: Map<string, number>;
} {
  const { tree, hierarchy } = derived;
  const add = (counts: Map<string, number>, node: WikiNode | undefined): void => {
    if (!node) return;
    for (const n of [...hierarchyAncestors(tree, node), node]) {
      counts.set(n.id, (counts.get(n.id) ?? 0) + 1);
    }
  };
  const sources = new Map<string, number>();
  for (const list of hierarchy.sourcesAt.values()) {
    for (const source of list) add(sources, tree.nodes.get(source.filedIn!));
  }
  const discussions = new Map<string, number>();
  for (const place of hierarchy.placeOf.values()) {
    const node = tree.nodes.get(place);
    // A discussion about a source counts in the category of the source.
    add(discussions, node?.type === "source" ? tree.nodes.get(node.filedIn ?? "") : node);
  }
  return { sources, discussions };
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
  const { tree, mastery, summaryStates, pendingNodes, config } = derived;
  const [expanded, setExpanded] = useState<Set<string>>(() => loadExpanded(storageKey));
  const counts = useMemo(() => branchCounts(derived), [derived]);
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
    const hasChildren = visibleChildren.length > 0;
    const sourceCount = counts.sources.get(node.id) ?? 0;
    const discussionCount = counts.discussions.get(node.id) ?? 0;
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
            title={node.title}
          >
            <TypeIcon node={node} tree={tree} />
            <span className="title">{node.title}</span>
          </a>
          <span className="tree-flags">
            {sourceCount > 0 && (
              <a
                className="tree-count"
                href={href({ name: "library", category: node.id })}
                title={`${sourceCount} source(s) in this branch`}
                aria-label={`Sources of this branch: ${sourceCount}`}
                onClick={onNavigate}
              >
                <Library aria-hidden="true" />
                {sourceCount}
              </a>
            )}
            {discussionCount > 0 && (
              <a
                className="tree-count"
                href={href({ name: "discussions", category: node.id })}
                title={`${discussionCount} discussion(s) in this branch`}
                aria-label={`Discussions of this branch: ${discussionCount}`}
                onClick={onNavigate}
              >
                <MessagesSquare aria-hidden="true" />
                {discussionCount}
              </a>
            )}
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
          </ul>
        )}
      </li>
    );
  };

  const root = tree.nodes.get(tree.rootId);
  if (!root) return null;
  return (
    <ul className="tree" aria-label="Wiki tree">
      {renderNode(root, tree)}
    </ul>
  );
}
