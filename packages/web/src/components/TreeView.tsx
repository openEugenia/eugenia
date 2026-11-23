/**
 * Wiki tree (side panel): categories and atomic knowledge, collapsible, badges, gauges,
 * drag and drop (§9.2). Flashcards are viewed from their knowledge item.
 */
import { useEffect, useMemo, useState, type DragEvent } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import {
  ancestors,
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
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const branch = useMemo(() => branchMasteryMap(tree, mastery), [tree, mastery]);
  // An open flashcard is shown on its knowledge item.
  const currentNode = currentId ? tree.nodes.get(currentId) : undefined;
  const highlighted =
    currentNode?.type === "flashcard" && currentNode.parentId ? currentNode.parentId : currentId;

  // The current node is always visible: its ancestors are expanded.
  useEffect(() => {
    if (!currentId || !tree.nodes.has(currentId)) return;
    const chain = ancestors(tree, currentId).map((a) => a.id);
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
