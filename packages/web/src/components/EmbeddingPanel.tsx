/**
 * Embedding vector of an indexed element (a page, or a section of the index of a source): its
 * values (1,024 for mistral-embed), its model and its state, to copy or download. Embeddings
 * are never published: this panel is for the owner only. The vector is read when the panel is
 * opened.
 */
import { useState } from "react";
import { Copy, Download, Sigma } from "lucide-react";
import type { ElementVector } from "@openeugenia/core";
import { formatDate } from "../lib/format.ts";
import { useIsOwner } from "../lib/hooks.ts";
import { href } from "../lib/router.ts";
import { errorMessage, toast } from "../store/ui.ts";
import { Spinner } from "./common.tsx";

function asJson(name: string, vector: ElementVector): string {
  return JSON.stringify(
    {
      element: name,
      model: vector.model,
      generated: vector.generated,
      status: vector.status,
      dimensions: vector.values.length,
      values: Array.from(vector.values, (v) => Number(v.toPrecision(6))),
    },
    null,
    2,
  );
}

export function EmbeddingPanel({
  name,
  load,
}: {
  /** Name of the element, for the downloaded file. */
  name: string;
  load(): Promise<ElementVector | null>;
}) {
  const owner = useIsOwner();
  const [state, setState] = useState<
    { loading: true } | { loading: false; vector: ElementVector | null; error?: string } | null
  >(null);
  if (!owner) return null;
  const open = (): void => {
    if (state) return;
    setState({ loading: true });
    load().then(
      (vector) => setState({ loading: false, vector }),
      (error: unknown) => setState({ loading: false, vector: null, error: errorMessage(error) }),
    );
  };
  const vector = state && !state.loading ? state.vector : null;
  const copy = async (): Promise<void> => {
    if (!vector) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(Array.from(vector.values)));
      toast(`${vector.values.length} values copied.`, "success");
    } catch (error) {
      toast(errorMessage(error), "error");
    }
  };
  const download = (): void => {
    if (!vector) return;
    const blob = new Blob([asJson(name, vector)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name.replace(/[^\p{L}\p{N}]+/gu, "-").toLowerCase()}-embedding.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <details
      className="section embedding-panel"
      onToggle={(e) => (e.currentTarget.open ? open() : undefined)}
    >
      <summary>
        <Sigma aria-hidden="true" className="inline-icon" /> Embedding vector
      </summary>
      {!state || state.loading ? (
        <Spinner small label="Reading the vector" />
      ) : state.error ? (
        <p className="muted small">Unreadable vector: {state.error}</p>
      ) : !vector ? (
        <p className="muted small">
          No vector yet: compute the embeddings in{" "}
          <a href={href({ name: "search" })}>Search › By meaning</a>.
        </p>
      ) : (
        <>
          <p className="muted small embedding-panel__meta">
            {vector.values.length} values · {vector.model}
            {vector.generated ? ` · ${formatDate(vector.generated)}` : ""} ·{" "}
            {vector.status === "current"
              ? "up to date"
              : "computed from an older text: compute it again"}
            <button
              type="button"
              className="oe-button oe-button--ghost oe-button--sm"
              onClick={() => void copy()}
            >
              <Copy aria-hidden="true" /> Copy
            </button>
            <button
              type="button"
              className="oe-button oe-button--ghost oe-button--sm"
              onClick={download}
            >
              <Download aria-hidden="true" /> Download
            </button>
          </p>
          <ol className="embedding-values" aria-label="Values of the vector">
            {Array.from(vector.values, (v, i) => (
              <li key={i} title={`Dimension ${i}`}>
                {v.toFixed(4)}
              </li>
            ))}
          </ol>
        </>
      )}
    </details>
  );
}
