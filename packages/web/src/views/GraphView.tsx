/**
 * Unified graph (§9.2, view 7): the whole common hierarchy — categories, knowledge items and
 * their flashcards, the sources filed in the categories and the parts of their index, the
 * discussions placed under the pages — as one tree, drawn with xyflow. Only the links of this
 * tree are drawn. Branches fold and unfold; the layout is computed, never dragged. Each card,
 * once selected, shows the content of its element and every action on it: the graph alone is
 * enough to work.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStoreApi,
  type Edge,
  type NodeChange,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import {
  ArrowUpLeft,
  ChevronsDownUp,
  ChevronsUpDown,
  Map as MapIcon,
  Minus,
  Plus,
  Scan,
} from "lucide-react";
import {
  hierarchyAncestors,
  isCategory,
  placementProblem,
  readSourceIndex,
  sourceIndexPages,
  type SourceIndexNode,
} from "@openeugenia/core";
import {
  GraphCard,
  GraphContext,
  KIND_LABELS,
  type GraphCardNode,
  type GraphContextValue,
  type GraphDialog,
} from "../components/GraphCard.tsx";
import {
  DeleteDialog,
  moveWithConfirmation,
  VisibilityDialog,
} from "../components/NodeActions.tsx";
import { NodePicker } from "../components/NodePicker.tsx";
import { fileSource } from "../components/SourcePanels.tsx";
import { buildGraph, layoutTree, type GraphItem, type GraphKind, type Size } from "../lib/graph.ts";
import { useCanEdit, useDerived, useIsOwner } from "../lib/hooks.ts";
import { branchMasteryMap } from "../lib/mastery.ts";
import { href } from "../lib/router.ts";
import { errorMessage, toast } from "../store/ui.ts";
import { useWiki } from "../store/wiki.ts";

const NODE_TYPES: NodeTypes = { item: GraphCard };

/** Colors of the kinds in the overview (the same as the cards). */
const MINIMAP_COLORS: Record<GraphKind, string> = {
  category: "var(--viz-series-1)",
  knowledge: "var(--viz-series-2)",
  flashcard: "var(--viz-series-3)",
  source: "var(--viz-series-4)",
  section: "color-mix(in srgb, var(--viz-series-4) 60%, var(--viz-muted))",
  discussion: "var(--viz-muted)",
};

const KINDS: GraphKind[] = [
  "category",
  "knowledge",
  "flashcard",
  "source",
  "section",
  "discussion",
];

/** Size of a card before it is measured. */
function estimate(item: GraphItem, selected: boolean): Size {
  if (selected) return { width: 352, height: 320 };
  return { width: item.kind === "flashcard" ? 208 : 240, height: 92 };
}

const OVERVIEW_KEY = "eugenia:graph-overview";

function loadOverview(): boolean {
  try {
    return localStorage.getItem(OVERVIEW_KEY) === "shown";
  } catch {
    return false;
  }
}

function storageKey(key: string): string {
  return `eugenia:graph:${key}`;
}

function loadExpanded(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey(key));
    const list: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((v) => typeof v === "string") : []);
  } catch {
    return new Set();
  }
}

/** Index of a source, read when the source is unfolded; `sha`: of its root page. */
type LoadedIndex = { sha: string; root: SourceIndexNode | null };

function Graph({ focusId }: { focusId: string | undefined }) {
  const derived = useDerived();
  const owner = useIsOwner();
  const editable = useCanEdit();
  const workspace = useWiki((s) => s.workspace)!;
  const { tree } = derived;
  const focus = tree.nodes.get(focusId ?? tree.rootId) ?? tree.nodes.get(tree.rootId)!;
  const { fitView, getViewport, setViewport, zoomIn, zoomOut } = useReactFlow();
  const store = useStoreApi();

  const [expanded, setExpanded] = useState<Set<string>>(() => loadExpanded(workspace.key));
  const [selected, setSelected] = useState<string | null>(focus.id);
  const [sizes, setSizes] = useState<Map<string, Size>>(new Map());
  const [indexes, setIndexes] = useState<Map<string, LoadedIndex>>(new Map());
  const [dialog, setDialog] = useState<GraphDialog | null>(null);
  // Overview of the whole graph (minimap): optional, it hides a corner of the graph.
  const [overview, setOverview] = useState(loadOverview);
  useEffect(() => {
    try {
      if (overview) localStorage.setItem(OVERVIEW_KEY, "shown");
      else localStorage.removeItem(OVERVIEW_KEY);
    } catch {
      // storage unavailable
    }
  }, [overview]);
  const loading = useRef(new Set<string>());
  // Viewport: the whole tree when the focus changes, then what the user unfolds or opens.
  const fitPending = useRef(true);
  // After the first fit, cards still grow (their text is read): the fit follows for a moment.
  const fitUntil = useRef(0);
  const reveal = useRef<{ id: string; children: boolean; until: number } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey(workspace.key), JSON.stringify([...expanded]));
    } catch {
      // storage unavailable
    }
  }, [expanded, workspace.key]);

  // Indexes still matching their source.
  const indexMap = useMemo(() => {
    const map = new Map<string, SourceIndexNode | null>();
    for (const [id, loaded] of indexes) {
      if (tree.nodes.get(id)?.sourceIndex?.root?.sha === loaded.sha) map.set(id, loaded.root);
    }
    return map;
  }, [indexes, tree]);

  const graph = useMemo(
    () => buildGraph(derived, focus.id, expanded, indexMap),
    [derived, focus.id, expanded, indexMap],
  );
  const byId = useMemo(() => new Map(graph.items.map((i) => [i.id, i])), [graph.items]);

  // The index of an unfolded source is read once.
  useEffect(() => {
    for (const item of graph.items) {
      const node = item.node;
      const sha = node?.sourceIndex?.root?.sha;
      if (item.kind !== "source" || !item.expanded || !node || !sha || indexMap.has(node.id))
        continue;
      const key = `${node.id}:${sha}`;
      if (loading.current.has(key)) continue;
      loading.current.add(key);
      const pages = sourceIndexPages(workspace.files.keys(), node).flatMap((path) => {
        const file = workspace.files.get(path);
        return file ? [file] : [];
      });
      workspace
        .prefetch(pages)
        .then(() => readSourceIndex(workspace, node))
        .then(
          (doc) =>
            setIndexes((prev) => new Map(prev).set(node.id, { sha, root: doc?.root ?? null })),
          (error: unknown) => {
            setIndexes((prev) => new Map(prev).set(node.id, { sha, root: null }));
            toast(`Unreadable index of "${node.title}": ${errorMessage(error)}`, "error");
          },
        )
        .finally(() => loading.current.delete(key));
    }
  }, [graph.items, indexMap, workspace]);

  const positions = useMemo(
    () =>
      layoutTree(graph.items, (id) => {
        const item = byId.get(id)!;
        return sizes.get(id) ?? estimate(item, id === selected);
      }),
    [graph.items, byId, sizes, selected],
  );

  const nodes = useMemo<GraphCardNode[]>(
    () =>
      graph.items.map((item) => {
        const size = sizes.get(item.id);
        return {
          id: item.id,
          type: "item",
          position: positions.get(item.id) ?? { x: 0, y: 0 },
          data: { item },
          selected: item.id === selected,
          draggable: false,
          connectable: false,
          deletable: false,
          ariaLabel: `${KIND_LABELS[item.kind]}: ${item.title}`,
          ...(size ? { measured: size } : {}),
        };
      }),
    [graph.items, positions, selected, sizes],
  );
  const edges = useMemo<Edge[]>(
    () =>
      graph.edges.map((e) => ({
        ...e,
        type: "smoothstep",
        selectable: false,
        focusable: false,
        className: `graph-edge graph-edge--${byId.get(e.target)?.kind ?? "category"}`,
      })),
    [graph.edges, byId],
  );

  // Measured sizes (the layout uses them) and selection.
  const onNodesChange = useCallback((changes: NodeChange<GraphCardNode>[]) => {
    setSizes((prev) => {
      let next: Map<string, Size> | null = null;
      for (const change of changes) {
        if (change.type !== "dimensions" || !change.dimensions) continue;
        const width = Math.round(change.dimensions.width);
        const height = Math.round(change.dimensions.height);
        const old = (next ?? prev).get(change.id);
        if (old && old.width === width && old.height === height) continue;
        next ??= new Map(prev);
        next.set(change.id, { width, height });
      }
      return next ?? prev;
    });
    const chosen = changes.find((c) => c.type === "select" && c.selected);
    if (chosen && chosen.type === "select") {
      setSelected(chosen.id);
      reveal.current = { id: chosen.id, children: false, until: Date.now() + 1200 };
      fitUntil.current = 0;
    } else if (changes.some((c) => c.type === "select" && !c.selected)) {
      setSelected(null);
    }
  }, []);

  const latest = useRef({ positions, sizes, items: graph.items });
  latest.current = { positions, sizes, items: graph.items };

  useEffect(() => {
    fitPending.current = true;
    setSelected(focus.id);
  }, [focus.id]);

  /** Brings these cards into view, zooming out if needed, without moving more than needed. */
  const ensureVisible = useCallback(
    (ids: readonly string[]) => {
      const { positions: at, sizes: measured } = latest.current;
      const boxes = ids.flatMap((id) => {
        const p = at.get(id);
        const s = measured.get(id);
        return p && s ? [{ x: p.x, y: p.y, width: s.width, height: s.height }] : [];
      });
      if (boxes.length === 0) return;
      const minX = Math.min(...boxes.map((b) => b.x));
      const minY = Math.min(...boxes.map((b) => b.y));
      const maxX = Math.max(...boxes.map((b) => b.x + b.width));
      const maxY = Math.max(...boxes.map((b) => b.y + b.height));
      const { width, height } = store.getState();
      if (!width || !height) return;
      const margin = 24;
      const view = getViewport();
      const fit = Math.min(
        (width - 2 * margin) / (maxX - minX),
        (height - 2 * margin) / (maxY - minY),
      );
      let zoom = view.zoom;
      let x = view.x;
      let y = view.y;
      if (fit < zoom) {
        // Too large at this zoom: zoom out (within reason), the start of the block first.
        zoom = Math.max(0.4, fit);
        x = margin - minX * zoom;
        y = Math.max(margin - minY * zoom, height / 2 - ((minY + maxY) / 2) * zoom);
        if (fit < 0.4) y = margin - minY * zoom;
      } else {
        const left = minX * zoom + x;
        const right = maxX * zoom + x;
        const top = minY * zoom + y;
        const bottom = maxY * zoom + y;
        if (right > width - margin) x -= right - (width - margin);
        if (left + (x - view.x) < margin) x += margin - (left + (x - view.x));
        if (bottom > height - margin) y -= bottom - (height - margin);
        if (top + (y - view.y) < margin) y += margin - (top + (y - view.y));
      }
      if (Math.abs(x - view.x) > 1 || Math.abs(y - view.y) > 1 || zoom !== view.zoom) {
        void setViewport({ x, y, zoom }, { duration: 200 });
      }
    },
    [getViewport, setViewport, store],
  );

  useEffect(() => {
    if (fitPending.current || Date.now() < fitUntil.current) {
      if (!graph.items.every((i) => sizes.has(i.id))) return;
      if (fitPending.current) fitUntil.current = Date.now() + 1000;
      fitPending.current = false;
      requestAnimationFrame(() => void fitView({ padding: 0.08, maxZoom: 1, duration: 0 }));
      return;
    }
    const r = reveal.current;
    if (!r) return;
    if (Date.now() > r.until) {
      reveal.current = null;
      return;
    }
    const ids = [
      r.id,
      ...(r.children
        ? latest.current.items.filter((i) => i.parentId === r.id).map((i) => i.id)
        : []),
    ];
    requestAnimationFrame(() => ensureVisible(ids));
  }, [positions, sizes, graph.items, fitView, ensureVisible]);

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    reveal.current = { id, children: true, until: Date.now() + 1500 };
    fitUntil.current = 0;
  }, []);

  /** Unfolds every page of the branch (not the indexes of the sources). */
  const unfoldAll = (): void => {
    const ids = new Set(expanded);
    const visit = (id: string): void => {
      const node = tree.nodes.get(id);
      if (!node) return;
      const has =
        node.childIds.length > 0 ||
        (derived.hierarchy.sourcesAt.get(id)?.length ?? 0) > 0 ||
        (derived.hierarchy.discussionsAt.get(id)?.length ?? 0) > 0;
      if (has) ids.add(id);
      node.childIds.forEach(visit);
    };
    visit(focus.id);
    setExpanded(ids);
    fitPending.current = true;
  };
  const foldAll = (): void => {
    setExpanded(new Set());
    fitPending.current = true;
  };

  const mastery = useMemo(() => branchMasteryMap(tree, derived.mastery), [tree, derived.mastery]);
  const context = useMemo<GraphContextValue>(
    () => ({
      owner,
      editable,
      focusId: focus.id,
      threshold: derived.config.mastery.reminder_threshold,
      mastery,
      toggle,
      openDialog: setDialog,
    }),
    [owner, editable, focus.id, derived.config.mastery.reminder_threshold, mastery, toggle],
  );

  const chain = focus.id === tree.rootId ? [] : hierarchyAncestors(tree, focus);
  const parent = chain.at(-1);
  const shown = new Set(graph.items.map((i) => i.kind));

  return (
    <div className="graph-screen">
      <header className="graph-screen__head">
        <div className="graph-screen__title">
          {chain.length > 0 && (
            <nav className="breadcrumb" aria-label="Breadcrumb">
              {chain.map((a, i) => (
                <span key={a.id}>
                  <a
                    href={href(
                      a.id === tree.rootId ? { name: "root" } : { name: "graph", id: a.id },
                    )}
                  >
                    {a.title}
                  </a>
                  {i < chain.length - 1 && <span aria-hidden="true"> › </span>}
                </span>
              ))}
            </nav>
          )}
          <h1>{focus.title}</h1>
        </div>
        <div className="toolbar graph-screen__tools">
          {parent && (
            <a
              className="oe-button oe-button--ghost oe-button--sm"
              href={href(
                parent.id === tree.rootId ? { name: "root" } : { name: "graph", id: parent.id },
              )}
            >
              <ArrowUpLeft aria-hidden="true" />{" "}
              <span className="graph-screen__label">Up to "{parent.title}"</span>
            </a>
          )}
          <button
            type="button"
            className="oe-button oe-button--ghost oe-button--sm"
            onClick={unfoldAll}
          >
            <ChevronsUpDown aria-hidden="true" />{" "}
            <span className="graph-screen__label">Unfold all</span>
          </button>
          <button
            type="button"
            className="oe-button oe-button--ghost oe-button--sm"
            onClick={foldAll}
          >
            <ChevronsDownUp aria-hidden="true" />{" "}
            <span className="graph-screen__label">Fold all</span>
          </button>
        </div>
        <ul className="legend graph-legend" aria-label="Kinds of elements">
          {KINDS.filter((k) => shown.has(k)).map((k) => (
            <li key={k} className="legend__item">
              <span className={`graph-swatch graph-swatch--${k}`} aria-hidden="true" />
              {KIND_LABELS[k]}
            </li>
          ))}
        </ul>
      </header>
      <GraphContext.Provider value={context}>
        <div className="graph-canvas">
          <ReactFlow<GraphCardNode>
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            nodesDraggable={false}
            nodesConnectable={false}
            edgesFocusable={false}
            elementsSelectable
            selectNodesOnDrag={false}
            zoomOnDoubleClick={false}
            deleteKeyCode={null}
            multiSelectionKeyCode={null}
            selectionKeyCode={null}
            onMoveStart={(event) => {
              // The user moves the view: it is no longer moved for them.
              if (event) {
                fitUntil.current = 0;
                reveal.current = null;
              }
            }}
            minZoom={0.1}
            maxZoom={1.6}
            aria-label={`Graph of ${focus.title}`}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} />
            <Panel position="bottom-left" className="graph-controls">
              <button
                type="button"
                className="oe-button oe-button--secondary oe-button--sm icon-only"
                aria-label="Zoom in"
                title="Zoom in"
                onClick={() => void zoomIn({ duration: 150 })}
              >
                <Plus />
              </button>
              <button
                type="button"
                className="oe-button oe-button--secondary oe-button--sm icon-only"
                aria-label="Zoom out"
                title="Zoom out"
                onClick={() => void zoomOut({ duration: 150 })}
              >
                <Minus />
              </button>
              <button
                type="button"
                className="oe-button oe-button--secondary oe-button--sm icon-only"
                aria-label="Show everything"
                title="Show everything"
                onClick={() => void fitView({ padding: 0.08, maxZoom: 1, duration: 200 })}
              >
                <Scan />
              </button>
              <button
                type="button"
                className="oe-button oe-button--secondary oe-button--sm icon-only"
                aria-label="Overview"
                title={overview ? "Hide the overview" : "Show the overview"}
                aria-pressed={overview}
                onClick={() => setOverview((v) => !v)}
              >
                <MapIcon />
              </button>
            </Panel>
            {overview && (
              <MiniMap<GraphCardNode>
                position="bottom-right"
                pannable
                zoomable
                ariaLabel="Overview of the graph"
                nodeColor={(n) => MINIMAP_COLORS[n.data.item.kind]}
                nodeBorderRadius={4}
              />
            )}
          </ReactFlow>
        </div>
      </GraphContext.Provider>

      {dialog?.kind === "visibility" && (
        <VisibilityDialog node={dialog.node} open onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "delete" && (
        <DeleteDialog node={dialog.node} open stay onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "move" && (
        <NodePicker
          open
          title={`Move "${dialog.node.title}" under…`}
          tree={tree}
          filter={(n) =>
            n.id !== dialog.node.id &&
            !n.path.startsWith(`${dialog.node.path}/`) &&
            n.id !== dialog.node.parentId &&
            placementProblem(tree, dialog.node, n.id) === null
          }
          onClose={() => setDialog(null)}
          onSelect={(target) => {
            const node = dialog.node;
            setDialog(null);
            void moveWithConfirmation(node.id, target.id);
          }}
        />
      )}
      {dialog?.kind === "file" && (
        <NodePicker
          open
          title={`File "${dialog.node.title}" in…`}
          hint="The category of the wiki this source deals with: it then appears in this category, and questions about it search it."
          tree={tree}
          filter={(n) => isCategory(n) && n.id !== dialog.node.filedIn}
          onClose={() => setDialog(null)}
          onSelect={(target) => {
            const node = dialog.node;
            setDialog(null);
            fileSource(node, target).catch((error: unknown) => toast(errorMessage(error), "error"));
          }}
        />
      )}
    </div>
  );
}

export function GraphView({ id }: { id?: string }) {
  return (
    <ReactFlowProvider>
      <Graph focusId={id} />
    </ReactFlowProvider>
  );
}
