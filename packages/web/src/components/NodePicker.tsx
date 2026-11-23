import { useMemo, useState } from "react";
import { ancestors, type WikiNode, type WikiTree } from "@openeugenia/core";
import { normalizeTerm } from "../lib/text.ts";
import { Modal } from "./Modal.tsx";
import { TypeIcon } from "./common.tsx";

interface NodePickerProps {
  open: boolean;
  title: string;
  tree: WikiTree;
  onClose(): void;
  onSelect(node: WikiNode): void;
  /** Nodes that can be picked (all by default). */
  filter?(node: WikiNode): boolean;
  hint?: string;
}

/** Finds a page by its title (links, move, category). */
export function NodePicker({
  open,
  title,
  tree,
  onClose,
  onSelect,
  filter,
  hint,
}: NodePickerProps) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const results = useMemo(() => {
    const q = normalizeTerm(query.trim());
    const all = [...tree.nodes.values()].filter((n) => (filter ? filter(n) : true));
    const scored = all
      .map((node) => {
        const title = normalizeTerm(node.title);
        const score = q === "" ? node.depth : title.startsWith(q) ? 0 : title.includes(q) ? 1 : -1;
        return { node, score };
      })
      .filter((r) => r.score >= 0)
      .sort(
        (a, b) =>
          a.score - b.score ||
          a.node.depth - b.node.depth ||
          a.node.title.localeCompare(b.node.title, "fr"),
      );
    return scored.slice(0, 60).map((r) => r.node);
  }, [query, tree, filter]);

  const choose = (node: WikiNode | undefined): void => {
    if (!node) return;
    onSelect(node);
    setQuery("");
  };

  return (
    <Modal title={title} open={open} onClose={onClose}>
      {hint && <p className="muted small">{hint}</p>}
      <input
        className="oe-input"
        type="search"
        placeholder="Search for a page by its title…"
        value={query}
        autoFocus
        onChange={(e) => {
          setQuery(e.target.value);
          setSelected(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setSelected((s) => Math.min(results.length - 1, s + 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSelected((s) => Math.max(0, s - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            choose(results[selected]);
          }
        }}
        aria-label="Page title"
      />
      <ul className="picker-list" role="listbox">
        {results.map((node, i) => (
          <li key={node.id}>
            <button
              type="button"
              role="option"
              aria-selected={i === selected}
              onClick={() => choose(node)}
            >
              <span style={{ display: "inline-flex", gap: "0.4rem", alignItems: "center" }}>
                <TypeIcon node={node} tree={tree} /> {node.title}
              </span>
              <span className="path">
                {ancestors(tree, node.id)
                  .map((a) => a.title)
                  .join(" › ") || "Root"}
              </span>
            </button>
          </li>
        ))}
        {results.length === 0 && (
          <li className="muted small" style={{ padding: "0.75rem" }}>
            No pages.
          </li>
        )}
      </ul>
    </Modal>
  );
}
