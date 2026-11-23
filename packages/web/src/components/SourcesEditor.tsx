/**
 * Sources of a knowledge item: preferably library sources (picked or created on the fly), with
 * a location (page, chapter…), otherwise a free reference.
 */
import { useState } from "react";
import { Library, Link2, Plus, Trash2 } from "lucide-react";
import { SOURCE_KINDS, type SourceKind, type SourceRef, type WikiTree } from "@openeugenia/core";
import { newSourceKey, type NewSourceDraft } from "../lib/sources.ts";
import { SOURCE_KIND_LABELS, SourceKindIcon } from "./common.tsx";
import { NodePicker } from "./NodePicker.tsx";

export function SourcesEditor({
  tree,
  sources,
  onChange,
  drafts,
  onDraftsChange,
}: {
  tree: WikiTree;
  sources: SourceRef[];
  onChange(sources: SourceRef[]): void;
  drafts: NewSourceDraft[];
  onDraftsChange(drafts: NewSourceDraft[]): void;
}) {
  const [picker, setPicker] = useState(false);
  const update = (index: number, patch: Partial<SourceRef>): void =>
    onChange(sources.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  const remove = (index: number): void => {
    const ref = sources[index]?.ref;
    onChange(sources.filter((_, i) => i !== index));
    if (ref) onDraftsChange(drafts.filter((d) => d.key !== ref));
  };
  const updateDraft = (key: string, patch: Partial<NewSourceDraft>): void =>
    onDraftsChange(drafts.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const addDraft = (): void => {
    const key = newSourceKey();
    onDraftsChange([...drafts, { key, title: "", kind: "web", url: "", authors: "" }]);
    onChange([...sources, { ref: key }]);
  };

  return (
    <div className="form-grid">
      {sources.length === 0 && (
        <p className="muted small">
          No source: the knowledge item will be marked "needs a source". Pick a source from your
          library, or create it here.
        </p>
      )}
      {sources.map((source, i) => {
        const draft = source.ref ? drafts.find((d) => d.key === source.ref) : undefined;
        const target = source.ref && !draft ? tree.nodes.get(source.ref) : undefined;
        return (
          <div key={i} className="oe-card source-row">
            {draft ? (
              <div className="form-grid">
                <span className="small muted">
                  <Plus aria-hidden="true" className="inline-icon" /> New library source
                </span>
                <div className="form-row">
                  <input
                    className="oe-input"
                    placeholder="Title (e.g. Discourse on the Method)"
                    value={draft.title}
                    onChange={(e) => updateDraft(draft.key, { title: e.target.value })}
                    aria-label="Title of the new source"
                  />
                  <select
                    className="oe-select"
                    value={draft.kind}
                    onChange={(e) => updateDraft(draft.key, { kind: e.target.value as SourceKind })}
                    aria-label="Kind of source"
                  >
                    {SOURCE_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {SOURCE_KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-row">
                  <input
                    className="oe-input"
                    placeholder="Authors (comma-separated)"
                    value={draft.authors}
                    onChange={(e) => updateDraft(draft.key, { authors: e.target.value })}
                    aria-label="Authors of the new source"
                  />
                  <input
                    className="oe-input"
                    placeholder="https://…"
                    value={draft.url}
                    onChange={(e) => updateDraft(draft.key, { url: e.target.value })}
                    aria-label="URL of the new source"
                  />
                </div>
              </div>
            ) : source.ref ? (
              <span className="source-row__title">
                {target ? (
                  <SourceKindIcon kind={target.sourceKind} />
                ) : (
                  <Library aria-hidden="true" />
                )}{" "}
                {target?.title ?? source.description ?? "Source not found"}
              </span>
            ) : (
              <div className="form-row">
                <input
                  className="oe-input"
                  placeholder="Free reference (e.g. Lecture at the Royal Institution)"
                  value={source.description ?? ""}
                  onChange={(e) => update(i, { description: e.target.value })}
                  aria-label="Description of the reference"
                />
                <input
                  className="oe-input"
                  placeholder="https://…"
                  value={source.url ?? ""}
                  onChange={(e) => update(i, { url: e.target.value })}
                  aria-label="URL of the reference"
                />
              </div>
            )}
            <div className="form-row" style={{ alignItems: "center", marginTop: "0.5rem" }}>
              <input
                className="oe-input"
                placeholder="Location: page, chapter, timestamp… (optional)"
                value={source.locator ?? ""}
                onChange={(e) => update(i, { locator: e.target.value })}
                aria-label="Location in the source"
              />
              <button
                type="button"
                className="oe-button oe-button--ghost oe-button--sm"
                onClick={() => remove(i)}
                aria-label="Remove the source"
              >
                <Trash2 aria-hidden="true" /> Retirer
              </button>
            </div>
          </div>
        );
      })}
      <div className="actions actions--start">
        <button
          type="button"
          className="oe-button oe-button--secondary oe-button--sm"
          onClick={() => setPicker(true)}
        >
          <Library aria-hidden="true" /> Pick from the library
        </button>
        <button
          type="button"
          className="oe-button oe-button--ghost oe-button--sm"
          onClick={addDraft}
        >
          <Plus aria-hidden="true" /> New source
        </button>
        <button
          type="button"
          className="oe-button oe-button--ghost oe-button--sm"
          onClick={() => onChange([...sources, { description: "" }])}
        >
          <Link2 aria-hidden="true" /> Free reference
        </button>
      </div>
      {picker && (
        <NodePicker
          open
          title="Pick a source"
          tree={tree}
          filter={(n) => n.type === "source" && !sources.some((s) => s.ref === n.id)}
          hint="The sources of your library. A private source cited by public knowledge only has its bibliographic record (title, kind, authors, date, URL) published: its content and personal file stay private."
          onClose={() => setPicker(false)}
          onSelect={(node) => {
            setPicker(false);
            onChange([...sources, { ref: node.id }]);
          }}
        />
      )}
    </div>
  );
}
