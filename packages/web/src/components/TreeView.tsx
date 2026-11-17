/** Arbre du wiki (panneau latéral) : repliable, badges, jauges, glisser-déposer (§9.2). */
import { useEffect, useMemo, useState, type DragEvent } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ancestors, isAncestorOf, type WikiNode, type WikiTree } from "@openeugenia/core";
import { branchMasteryMap } from "../lib/mastery.ts";
import { href } from "../lib/router.ts";
import type { Derived } from "../lib/workspace.ts";
import { MasteryMeter } from "./charts.tsx";
import { TypeIcon, VisibilityBadge } from "./common.tsx";

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

  // Le nœud courant est toujours visible : ses ancêtres sont dépliés.
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
      // stockage indisponible
    }
  }, [expanded, storageKey]);

  const toggle = (id: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const canDrop = (targetId: string): boolean =>
    dragging !== null &&
    dragging !== targetId &&
    !isAncestorOf(tree, dragging, targetId) &&
    tree.nodes.get(dragging)?.parentId !== targetId;

  const renderNode = (node: WikiNode, tree: WikiTree): React.ReactNode => {
    const open = expanded.has(node.id) || node.id === tree.rootId;
    const hasChildren = node.childIds.length > 0;
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
          className={`tree-row${node.id === currentId ? " is-current" : ""}${dropTarget === node.id ? " is-drop-target" : ""}`}
          {...dragProps}
          {...dropProps}
        >
          {hasChildren && node.id !== tree.rootId ? (
            <button
              type="button"
              className="tree-toggle"
              onClick={() => toggle(node.id)}
              aria-label={open ? `Replier ${node.title}` : `Déplier ${node.title}`}
              aria-expanded={open}
            >
              {open ? <ChevronDown /> : <ChevronRight />}
            </button>
          ) : (
            <span className="tree-spacer" />
          )}
          <a
            href={href({ name: "node", id: node.id })}
            aria-current={node.id === currentId ? "page" : undefined}
            onClick={onNavigate}
          >
            <TypeIcon node={node} tree={tree} />
            <span className="title">{node.title}</span>
          </a>
          <span className="tree-flags">
            {owner && branchMastery?.value !== undefined && (
              <MasteryMeter
                value={branchMastery.value}
                threshold={config.mastery.reminder_threshold}
                compact
              />
            )}
            {stale && (
              <span className="flag-dot flag-dot--stale" title="Description périmée ou manquante" />
            )}
            {pendingNodes.has(node.id) && (
              <span
                className="flag-dot flag-dot--pending"
                title="Modifié, pas encore enregistré dans le dépôt"
              />
            )}
            {owner && <VisibilityBadge visibility={node.isPublic ? "public" : "private"} compact />}
          </span>
        </div>
        {hasChildren && open && (
          <ul className="tree">
            {node.childIds.map((id) => renderNode(tree.nodes.get(id)!, tree))}
          </ul>
        )}
      </li>
    );
  };

  const root = tree.nodes.get(tree.rootId);
  if (!root) return null;
  return (
    <ul className="tree" aria-label="Arbre du wiki">
      {renderNode(root, tree)}
    </ul>
  );
}
