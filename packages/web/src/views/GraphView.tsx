/** Graphe de l'arbre (§9.2, vue 7) : arbre radial, zoom, focus sur une branche, liens entre pages. */
import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from "react";
import { hierarchy, tree as d3tree, type HierarchyPointNode } from "d3-hierarchy";
import { ArrowUpLeft, Minus, Plus, Scan } from "lucide-react";
import { ancestors, buildBacklinks, type WikiNode } from "@openeugenia/core";
import { Breadcrumb } from "../components/common.tsx";
import { formatPercent } from "../lib/format.ts";
import { useDerived, useIsOwner } from "../lib/hooks.ts";
import { branchMasteryMap } from "../lib/mastery.ts";
import { href, navigate } from "../lib/router.ts";
import { useWiki } from "../store/wiki.ts";

const TYPE_COLORS = {
  category: "var(--viz-series-1)",
  flashcard: "var(--viz-series-2)",
  note: "var(--viz-series-3)",
} as const;

function kind(node: WikiNode): keyof typeof TYPE_COLORS {
  if (node.type === "flashcard") return "flashcard";
  return node.childIds.length > 0 || node.virtual ? "category" : "note";
}

const MAX_NODES = 600;

export function GraphView({ id }: { id?: string }) {
  const derived = useDerived();
  const owner = useIsOwner();
  const workspace = useWiki((s) => s.workspace);
  const version = useWiki((s) => s.version);
  const focus =
    derived.tree.nodes.get(id ?? derived.tree.rootId) ??
    derived.tree.nodes.get(derived.tree.rootId)!;
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const [hover, setHover] = useState<string | null>(null);
  const [showLinks, setShowLinks] = useState(true);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const branch = useMemo(
    () => branchMasteryMap(derived.tree, derived.mastery),
    [derived.tree, derived.mastery],
  );

  const { nodes, links, bounds, truncated } = useMemo(() => {
    let count = 0;
    const root = hierarchy(focus, (n) => {
      if (count > MAX_NODES) return [];
      const kids = n.childIds.map((c) => derived.tree.nodes.get(c)!);
      count += kids.length;
      return kids;
    });
    const depth = Math.max(1, root.height);
    const r = Math.max(140, depth * 115);
    const layout = d3tree<WikiNode>()
      .size([2 * Math.PI, r])
      .separation((a, b) => (a.parent === b.parent ? 1 : 2) / Math.max(1, a.depth));
    const laid = layout(root);
    const all = laid.descendants();
    const xs = all.map((n) => Math.cos(n.x - Math.PI / 2) * n.y);
    const ys = all.map((n) => Math.sin(n.x - Math.PI / 2) * n.y);
    const bounds = {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    };
    return { nodes: all, links: laid.links(), radius: r, bounds, truncated: count > MAX_NODES };
  }, [focus, derived.tree]);

  /** Cadre l'arbre entier (étiquettes comprises) dans la zone visible. */
  const fit = (): void => {
    const svg = svgRef.current?.getBoundingClientRect();
    if (!svg) return;
    const w = bounds.maxX - bounds.minX + 320;
    const h = bounds.maxY - bounds.minY + 320;
    const k = Math.min(1.6, Math.max(0.2, Math.min(svg.width / w, svg.height / h)));
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    setView({ k, x: svg.width / 2 - k * cx, y: svg.height / 2 - k * cy });
  };

  const point = (n: HierarchyPointNode<WikiNode>): [number, number] => [
    Math.cos(n.x - Math.PI / 2) * n.y,
    Math.sin(n.x - Math.PI / 2) * n.y,
  ];

  const crossLinks = useMemo(() => {
    if (!showLinks || !workspace) return [];
    const contents = new Map<string, string>();
    for (const n of nodes) {
      const text = workspace.peekText(n.data.indexPath);
      if (text !== undefined) contents.set(n.data.indexPath, text);
    }
    const byId = new Map(nodes.map((n) => [n.data.id, n]));
    const out: [HierarchyPointNode<WikiNode>, HierarchyPointNode<WikiNode>][] = [];
    for (const [target, sources] of buildBacklinks(derived.tree, contents)) {
      const t = byId.get(target);
      if (!t) continue;
      for (const s of sources) {
        const from = byId.get(s);
        if (from && from.parent !== t && t.parent !== from) out.push([from, t]);
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, showLinks, workspace, derived.tree, version]);

  // Cadre la vue à chaque changement de focus.
  useEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bounds, focus.id]);

  const zoom = (factor: number, cx?: number, cy?: number): void => {
    setView((v) => {
      const svg = svgRef.current?.getBoundingClientRect();
      const px = cx ?? (svg ? svg.width / 2 : 0);
      const py = cy ?? (svg ? svg.height / 2 : 0);
      const k = Math.min(6, Math.max(0.15, v.k * factor));
      return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
    });
  };

  const onWheel = (e: WheelEvent<SVGSVGElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    zoom(Math.exp(-e.deltaY * 0.0015), e.clientX - rect.left, e.clientY - rect.top);
  };
  const onPointerDown = (e: PointerEvent<SVGSVGElement>): void => {
    if ((e.target as Element).closest(".node")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>): void => {
    const d = drag.current;
    if (d) setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
  };

  const hovered = hover ? derived.tree.nodes.get(hover) : undefined;
  const parent = focus.parentId ? derived.tree.nodes.get(focus.parentId) : undefined;

  return (
    <div className="page page--wide">
      <Breadcrumb tree={derived.tree} node={focus} />
      <div className="section__head">
        <h1 style={{ fontSize: "var(--oe-font-size-2xl)", margin: 0 }}>Graphe — {focus.title}</h1>
        <div className="toolbar">
          {parent && (
            <a
              className="oe-button oe-button--ghost oe-button--sm"
              href={href({ name: "graph", id: parent.id })}
            >
              <ArrowUpLeft aria-hidden="true" /> Remonter à « {parent.title} »
            </a>
          )}
          <label className="check">
            <input
              type="checkbox"
              checked={showLinks}
              onChange={(e) => setShowLinks(e.target.checked)}
            />{" "}
            Liens entre pages
          </label>
        </div>
      </div>
      <div className="legend" style={{ marginBottom: "0.75rem" }}>
        <span className="legend__item">
          <svg width="10" height="10" aria-hidden="true">
            <circle cx="5" cy="5" r="5" fill={TYPE_COLORS.category} />
          </svg>{" "}
          Catégorie
        </span>
        <span className="legend__item">
          <svg width="10" height="10" aria-hidden="true">
            <circle cx="5" cy="5" r="5" fill={TYPE_COLORS.note} />
          </svg>{" "}
          Note
        </span>
        <span className="legend__item">
          <svg width="10" height="10" aria-hidden="true">
            <circle cx="5" cy="5" r="5" fill={TYPE_COLORS.flashcard} />
          </svg>{" "}
          Connaissance atomique
        </span>
        {showLinks && (
          <span className="legend__item">
            <span className="line-key" style={{ background: "var(--viz-series-4)" }} /> Lien entre
            pages
          </span>
        )}
        <span className="muted">Clic : centrer sur la branche · double-clic : ouvrir la page</span>
      </div>
      <div className="graph">
        <svg
          ref={svgRef}
          role="img"
          aria-label={`Graphe de la branche ${focus.title}`}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => (drag.current = null)}
        >
          <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
            {links.map((link) => {
              const [sx, sy] = point(link.source);
              const [tx, ty] = point(link.target);
              const midR = (link.source.y + link.target.y) / 2;
              const c1 = [
                Math.cos(link.source.x - Math.PI / 2) * midR,
                Math.sin(link.source.x - Math.PI / 2) * midR,
              ];
              const c2 = [
                Math.cos(link.target.x - Math.PI / 2) * midR,
                Math.sin(link.target.x - Math.PI / 2) * midR,
              ];
              return (
                <path
                  key={`${link.source.data.id}-${link.target.data.id}`}
                  className="edge"
                  d={`M${sx},${sy}C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${tx},${ty}`}
                />
              );
            })}
            {crossLinks.map(([a, b], i) => {
              const [ax, ay] = point(a);
              const [bx, by] = point(b);
              // Courbe tirée vers le centre, sans le traverser.
              const cx = ((ax + bx) / 2) * 0.55;
              const cy = ((ay + by) / 2) * 0.55;
              return (
                <path
                  key={i}
                  className="cross-link"
                  style={{ stroke: "var(--viz-series-4)" }}
                  d={`M${ax},${ay}Q${cx},${cy} ${bx},${by}`}
                />
              );
            })}
            {nodes.map((n) => {
              const [x, y] = point(n);
              const m = branch.get(n.data.id);
              const cards = m?.count ?? 0;
              const r = n.depth === 0 ? 11 : Math.min(12, 4 + Math.sqrt(Math.max(1, cards)) * 1.6);
              const showLabel =
                nodes.length <= 80 || n.depth <= 2 || view.k > 1.6 || hover === n.data.id;
              const angle = (n.x * 180) / Math.PI - 90;
              const flip = n.x > Math.PI;
              // Feuilles : étiquette dans le prolongement du rayon ; nœuds internes : horizontale, au-dessus.
              const leaf = !n.children || n.children.length === 0;
              return (
                <g
                  key={n.data.id}
                  className={`node${n.depth === 0 ? " is-focus" : ""}`}
                  transform={`translate(${x},${y})`}
                  tabIndex={0}
                  role="link"
                  aria-label={`${n.data.title}${owner && m?.value !== undefined ? `, maîtrise ${formatPercent(m.value)}` : ""}`}
                  onPointerEnter={() => setHover(n.data.id)}
                  onPointerLeave={() => setHover((h) => (h === n.data.id ? null : h))}
                  onFocus={() => setHover(n.data.id)}
                  onClick={() =>
                    n.data.childIds.length > 0 && navigate({ name: "graph", id: n.data.id })
                  }
                  onDoubleClick={() => navigate({ name: "node", id: n.data.id })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") navigate({ name: "node", id: n.data.id });
                  }}
                >
                  <circle r={r + 6} fill="transparent" />
                  <circle r={r} fill={TYPE_COLORS[kind(n.data)]} />
                  {showLabel && (
                    <text
                      dy="0.32em"
                      style={{ fontSize: `${12 / view.k}px`, strokeWidth: `${3 / view.k}px` }}
                      transform={
                        leaf && n.depth > 0
                          ? `rotate(${flip ? angle + 180 : angle}) translate(${flip ? -(r + 6) : r + 6},0)`
                          : `translate(0,${-(r + 10 / view.k)})`
                      }
                      textAnchor={leaf && n.depth > 0 ? (flip ? "end" : "start") : "middle"}
                    >
                      {n.data.title.length > 32 ? `${n.data.title.slice(0, 31)}…` : n.data.title}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
        <div className="graph-controls">
          <button
            type="button"
            className="oe-button oe-button--secondary oe-button--sm icon-only"
            aria-label="Zoomer"
            onClick={() => zoom(1.3)}
          >
            <Plus />
          </button>
          <button
            type="button"
            className="oe-button oe-button--secondary oe-button--sm icon-only"
            aria-label="Dézoomer"
            onClick={() => zoom(1 / 1.3)}
          >
            <Minus />
          </button>
          <button
            type="button"
            className="oe-button oe-button--secondary oe-button--sm icon-only"
            aria-label="Recentrer"
            onClick={fit}
          >
            <Scan />
          </button>
        </div>
      </div>
      <p className="muted small" style={{ marginTop: "0.5rem", minHeight: "1.5em" }}>
        {hovered
          ? `${[...ancestors(derived.tree, hovered.id).map((a) => a.title), hovered.title].join(" › ")}${owner && branch.get(hovered.id)?.value !== undefined ? ` · maîtrise ${formatPercent(branch.get(hovered.id)!.value)}` : ""}`
          : truncated
            ? `Branche volumineuse : seuls les ${MAX_NODES} premiers nœuds sont affichés. Centrez-vous sur une sous-branche.`
            : `${nodes.length} nœud(s) affiché(s).`}
      </p>
    </div>
  );
}
