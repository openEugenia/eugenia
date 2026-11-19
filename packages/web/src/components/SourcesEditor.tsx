/**
 * Sources d'une connaissance : de préférence des sources de la bibliothèque (choisies ou
 * créées à la volée), avec une localisation (page, chapitre…), sinon une référence libre.
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
          Aucune source : la connaissance sera marquée « à sourcer ». Choisissez une source de votre
          bibliothèque, ou créez-la ici.
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
                  <Plus aria-hidden="true" className="inline-icon" /> Nouvelle source de la
                  bibliothèque
                </span>
                <div className="form-row">
                  <input
                    className="oe-input"
                    placeholder="Titre (ex. Discours de la méthode)"
                    value={draft.title}
                    onChange={(e) => updateDraft(draft.key, { title: e.target.value })}
                    aria-label="Titre de la nouvelle source"
                  />
                  <select
                    className="oe-select"
                    value={draft.kind}
                    onChange={(e) => updateDraft(draft.key, { kind: e.target.value as SourceKind })}
                    aria-label="Nature de la source"
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
                    placeholder="Auteurs (séparés par des virgules)"
                    value={draft.authors}
                    onChange={(e) => updateDraft(draft.key, { authors: e.target.value })}
                    aria-label="Auteurs de la nouvelle source"
                  />
                  <input
                    className="oe-input"
                    placeholder="https://…"
                    value={draft.url}
                    onChange={(e) => updateDraft(draft.key, { url: e.target.value })}
                    aria-label="Adresse de la nouvelle source"
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
                {target?.title ?? source.description ?? "Source introuvable"}
              </span>
            ) : (
              <div className="form-row">
                <input
                  className="oe-input"
                  placeholder="Référence libre (ex. Conférence au Collège de France)"
                  value={source.description ?? ""}
                  onChange={(e) => update(i, { description: e.target.value })}
                  aria-label="Description de la référence"
                />
                <input
                  className="oe-input"
                  placeholder="https://…"
                  value={source.url ?? ""}
                  onChange={(e) => update(i, { url: e.target.value })}
                  aria-label="Adresse de la référence"
                />
              </div>
            )}
            <div className="form-row" style={{ alignItems: "center", marginTop: "0.5rem" }}>
              <input
                className="oe-input"
                placeholder="Localisation : page, chapitre, minutage… (facultatif)"
                value={source.locator ?? ""}
                onChange={(e) => update(i, { locator: e.target.value })}
                aria-label="Localisation dans la source"
              />
              <button
                type="button"
                className="oe-button oe-button--ghost oe-button--sm"
                onClick={() => remove(i)}
                aria-label="Retirer la source"
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
          <Library aria-hidden="true" /> Choisir dans la bibliothèque
        </button>
        <button
          type="button"
          className="oe-button oe-button--ghost oe-button--sm"
          onClick={addDraft}
        >
          <Plus aria-hidden="true" /> Nouvelle source
        </button>
        <button
          type="button"
          className="oe-button oe-button--ghost oe-button--sm"
          onClick={() => onChange([...sources, { description: "" }])}
        >
          <Link2 aria-hidden="true" /> Référence libre
        </button>
      </div>
      {picker && (
        <NodePicker
          open
          title="Choisir une source"
          tree={tree}
          filter={(n) => n.type === "source" && !sources.some((s) => s.ref === n.id)}
          hint="Les sources de votre bibliothèque. Une source privée citée par une connaissance publique n'est pas publiée : la référence disparaît de la partie publique."
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
