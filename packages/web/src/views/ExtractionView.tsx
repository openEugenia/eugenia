/**
 * Extraction de connaissances atomiques (§8.1) : un texte (source de la bibliothèque,
 * discussion ou note rapide, texte collé, PDF), les surlignages d'Eugenia et de l'utilisateur,
 * les propositions (énoncé, cible en gras, titre, première flashcard, catégorie), puis un seul
 * commit. Un texte collé ou un PDF devient une source de la bibliothèque ; les connaissances
 * extraites citent leurs sources.
 */
import { useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  FileUp,
  Highlighter,
  Lightbulb,
  Plus,
  Scissors,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import {
  createFlashcard,
  createPage,
  joinPath,
  markdownToText,
  parseDiscussion,
  parsePage,
  serializeKnowledgeBody,
  SOURCE_KINDS,
  type FileChange,
  type SourceKind,
  type SourceRef,
} from "@openeugenia/core";
import {
  categoryOptions,
  highlightId,
  highlightKnowledge,
  proposeKnowledge,
  type CategoryOption,
  type Highlight,
} from "@openeugenia/ai";
import {
  Breadcrumb,
  ErrorBox,
  InfoBox,
  SOURCE_KIND_LABELS,
  Spinner,
} from "../components/common.tsx";
import { SourcesEditor } from "../components/SourcesEditor.tsx";
import { taskContext } from "../lib/ai.ts";
import { fileToBase64, safeFileName } from "../lib/files.ts";
import { plural } from "../lib/format.ts";
import { useCanEdit, useDerived, useText } from "../lib/hooks.ts";
import { pdfToText } from "../lib/pdf.ts";
import { href } from "../lib/router.ts";
import { materializeSources, splitList, type NewSourceDraft } from "../lib/sources.ts";
import { errorMessage, toast } from "../store/ui.ts";
import { useWiki } from "../store/wiki.ts";

/** Origine du texte : source de la bibliothèque, discussion, texte collé ou PDF. */
type Origin = "source" | "discussion" | "paste" | "pdf";
type Step = "source" | "highlight" | "propose" | "done";

interface Source {
  kind: Origin;
  title: string;
  text: string;
  /** Source ou discussion d'origine. */
  originId?: string;
  isPublic: boolean;
  pdf?: { name: string; base64: string };
  attachPdf?: boolean;
}

interface Proposal {
  key: string;
  include: boolean;
  title: string;
  knowledge: string;
  question: string;
  answer: string;
  /** Catégorie existante, ou `new`. */
  categoryId: string;
  newTitle: string;
  newParentId: string;
}

/** Position d'une sélection dans le texte affiché. */
function selectionOffsets(container: HTMLElement): { start: number; end: number } | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!container.contains(range.commonAncestorContainer)) return null;
  const before = document.createRange();
  before.selectNodeContents(container);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  return { start, end: start + range.toString().length };
}

/** Découpe le texte en segments, chacun couvert par 0, 1 ou plusieurs surlignages. */
function segments(
  text: string,
  highlights: readonly Highlight[],
): { text: string; count: number; ids: string[] }[] {
  const bounds = new Set([0, text.length]);
  for (const h of highlights) {
    if (h.end > h.start) {
      bounds.add(Math.max(0, h.start));
      bounds.add(Math.min(text.length, h.end));
    }
  }
  const sorted = [...bounds].sort((a, b) => a - b);
  const out: { text: string; count: number; ids: string[] }[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    const ids = highlights
      .filter((h) => h.start <= a && h.end >= b && h.end > h.start)
      .map((h) => h.id);
    out.push({ text: text.slice(a, b), count: ids.length, ids });
  }
  return out;
}

export function ExtractionView({ id, discussion }: { id?: string; discussion?: string }) {
  const derived = useDerived();
  const editable = useCanEdit();
  const node = id ? derived.tree.nodes.get(id) : undefined;
  const isSourceNode = node?.type === "source" && !node.virtual;
  const nodeText = useText(isSourceNode ? node.indexPath : undefined);
  const discussionText = useText(discussion);
  const discussionEntry = discussion
    ? derived.discussions.find((d) => d.path === discussion)
    : undefined;
  const [step, setStep] = useState<Step>("source");
  const [kind, setKind] = useState<Origin>(
    discussion ? "discussion" : isSourceNode ? "source" : "paste",
  );
  const [pasteTitle, setPasteTitle] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [sourceKind, setSourceKind] = useState<SourceKind>("article");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceAuthors, setSourceAuthors] = useState("");
  const [pdf, setPdf] = useState<{ name: string; base64: string; text: string } | null>(null);
  const [attachPdf, setAttachPdf] = useState(true);
  // Catégorie proposée par défaut aux connaissances : la catégorie d'où l'on vient.
  const defaultCategory =
    node?.type === "category" && node.space === "wiki" ? node.id : derived.tree.rootId;
  // Sources citées par toutes les connaissances extraites (en plus du texte importé).
  const [citations, setCitations] = useState<SourceRef[]>(isSourceNode ? [{ ref: node.id }] : []);
  const [drafts, setDrafts] = useState<NewSourceDraft[]>([]);
  const [source, setSource] = useState<Source | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [focused, setFocused] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; title: string }[]>([]);
  const textRef = useRef<HTMLDivElement>(null);
  const categories = useMemo(() => categoryOptions(derived), [derived]);

  if (id && !node)
    return (
      <div className="page">
        <ErrorBox title="Page introuvable">Cette page n'existe pas.</ErrorBox>
      </div>
    );
  if (!editable)
    return (
      <div className="page">
        <InfoBox>
          L'extraction n'est possible que dans votre wiki, avec un accès en écriture.
        </InfoBox>
      </div>
    );

  const involvesPrivate = (): boolean =>
    !(source?.isPublic ?? false) ||
    categories.some((c) => derived.tree.nodes.get(c.id)?.isPublic === false);

  const prepareSource = (): void => {
    let next: Source | null = null;
    if (kind === "source" && node && nodeText.data !== undefined) {
      next = {
        kind,
        title: node.title,
        text: markdownToText(parsePage(nodeText.data).body),
        originId: node.id,
        isPublic: node.isPublic,
      };
    } else if (kind === "discussion" && discussionText.data !== undefined) {
      const doc = parseDiscussion(discussionText.data);
      next = {
        kind,
        title: doc.fields.title || "Discussion",
        text: doc.messages
          .map((m) => `${m.role === "user" ? "Moi" : "Eugenia"} : ${markdownToText(m.content)}`)
          .join("\n\n"),
        originId: doc.fields.id,
        isPublic: false,
      };
    } else if (kind === "paste") {
      if (!pasteText.trim()) return toast("Collez d'abord un texte.", "error");
      next = {
        kind,
        title: pasteTitle.trim() || "Texte importé",
        text: pasteText.trim(),
        isPublic: false,
      };
    } else if (kind === "pdf" && pdf) {
      next = {
        kind,
        title: pasteTitle.trim() || pdf.name.replace(/\.pdf$/i, ""),
        text: pdf.text,
        isPublic: false,
        pdf: { name: pdf.name, base64: pdf.base64 },
        attachPdf,
      };
    }
    if (!next || !next.text.trim())
      return toast(
        kind === "source"
          ? "Cette source n'a pas de contenu : collez-y un extrait ou importez le texte."
          : "Le texte source est vide.",
        "error",
      );
    setSource(next);
    setHighlights([]);
    setStep("highlight");
  };

  const autoHighlight = async (): Promise<void> => {
    if (!source) return;
    setBusy("Eugenia surligne les connaissances…");
    try {
      const context = await taskContext(involvesPrivate());
      const found = await highlightKnowledge(context, source.text);
      setHighlights((list) =>
        [...list.filter((h) => h.origin === "user"), ...found].sort((a, b) => a.start - b.start),
      );
      toast(
        `${plural(found.length, "passage")} surligné${found.length > 1 ? "s" : ""}.`,
        "success",
      );
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setBusy(null);
    }
  };

  const addSelection = (): void => {
    if (!textRef.current || !source) return;
    const offsets = selectionOffsets(textRef.current);
    if (!offsets || offsets.end <= offsets.start)
      return toast("Sélectionnez un passage dans le texte.", "error");
    const quote = source.text.slice(offsets.start, offsets.end).trim();
    const start = source.text.indexOf(quote, offsets.start);
    setHighlights((list) =>
      [
        ...list,
        { id: highlightId(), start, end: start + quote.length, quote, origin: "user" as const },
      ].sort((a, b) => a.start - b.start),
    );
    window.getSelection()?.removeAllRanges();
  };

  const propose = async (): Promise<void> => {
    if (!source) return;
    const kept = highlights.filter((h) => h.quote.trim());
    if (kept.length === 0) return toast("Surlignez au moins un passage.", "error");
    setBusy("Eugenia propose des connaissances…");
    try {
      const context = await taskContext(involvesPrivate());
      const result = await proposeKnowledge(context, {
        text: source.text,
        highlights: kept,
        categories,
      });
      const fallback = defaultCategory;
      setProposals(
        result.map((p, i) => ({
          key: `${p.highlightId}-${i}`,
          include: true,
          title: p.title,
          knowledge: p.knowledge,
          question: p.question,
          answer: p.answer,
          categoryId: p.category.existingId ?? (p.category.newTitle ? "new" : fallback),
          newTitle: p.category.newTitle ?? "",
          newParentId: p.category.newParentId ?? fallback,
        })),
      );
      setStep("propose");
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setBusy(null);
    }
  };

  const update = (key: string, patch: Partial<Proposal>): void =>
    setProposals((list) => list.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  const validate = async (): Promise<void> => {
    const { workspace, stage, commit } = useWiki.getState();
    if (!workspace || !source) return;
    const selected = proposals.filter((p) => p.include && p.title.trim() && p.knowledge.trim());
    if (selected.length === 0)
      return toast("Sélectionnez au moins une connaissance complète.", "error");
    setBusy("Création des connaissances…");
    try {
      const tree = workspace.tree;
      const changes: FileChange[] = [];
      const reserved: string[] = [];
      const reserve = (path: string): void => {
        reserved.push(path);
      };
      // 1. Texte collé ou PDF : nouvelle source de la bibliothèque, avec son fichier.
      let originId = source.originId;
      const refs: SourceRef[] = [...citations];
      if (source.kind === "paste" || source.kind === "pdf") {
        const library = tree.nodes.get(tree.libraryId)!;
        const fileName = source.pdf && source.attachPdf ? safeFileName(source.pdf.name) : undefined;
        const created = createPage(
          workspace,
          {
            parentPath: library.path,
            parentIsPublic: library.isPublic,
            title: source.title,
            type: "source",
            kind: sourceKind,
            authors: splitList(sourceAuthors),
            ...(sourceUrl.trim() ? { url: sourceUrl.trim() } : {}),
            ...(fileName ? { file: fileName } : {}),
            body: source.text
              .split(/\n{2,}/)
              .map((p) => `> ${p.replace(/\n/g, "\n> ")}`)
              .join("\n>\n"),
          },
          reserved,
        );
        changes.push(created.change);
        reserve(created.indexPath);
        if (source.pdf && fileName) {
          const path = joinPath(created.path, fileName);
          changes.push({ op: "write-binary", path, base64: source.pdf.base64 });
          reserve(path);
        }
        originId = created.id;
        refs.unshift({ ref: created.id });
      }
      const materialized = materializeSources(workspace, refs, drafts, reserved);
      changes.push(...materialized.changes);
      const sources = materialized.sources;
      // 2. Nouvelles catégories (une par titre et parent).
      const newCategories = new Map<string, { path: string; isPublic: boolean }>();
      for (const p of selected) {
        if (p.categoryId !== "new" || !p.newTitle.trim()) continue;
        const key = `${p.newParentId}|${p.newTitle.trim().toLowerCase()}`;
        if (newCategories.has(key)) continue;
        const parent = tree.nodes.get(p.newParentId) ?? tree.nodes.get(tree.rootId)!;
        const category = createPage(
          workspace,
          { parentPath: parent.path, parentIsPublic: parent.isPublic, title: p.newTitle.trim() },
          reserved,
        );
        changes.push(category.change);
        reserve(category.indexPath);
        newCategories.set(key, { path: category.path, isPublic: false });
      }
      // 3. Connaissances atomiques et leur première flashcard.
      const made: { id: string; title: string }[] = [];
      for (const p of selected) {
        let parentPath: string;
        let parentIsPublic: boolean;
        if (p.categoryId === "new" && p.newTitle.trim()) {
          const category = newCategories.get(
            `${p.newParentId}|${p.newTitle.trim().toLowerCase()}`,
          )!;
          parentPath = category.path;
          parentIsPublic = category.isPublic;
        } else {
          const category = tree.nodes.get(p.categoryId) ?? tree.nodes.get(tree.rootId)!;
          parentPath = category.path;
          parentIsPublic = category.isPublic;
        }
        const knowledge = createPage(
          workspace,
          {
            parentPath,
            parentIsPublic,
            title: p.title.trim(),
            type: "knowledge",
            body: serializeKnowledgeBody({ statement: p.knowledge }),
            sources,
            ...(originId ? { extracted_from: originId } : {}),
          },
          reserved,
        );
        changes.push(knowledge.change);
        reserve(knowledge.indexPath);
        if (p.question.trim() && p.answer.trim()) {
          const card = createFlashcard(
            workspace,
            { path: knowledge.path, isPublic: false },
            { question: p.question, answer: p.answer },
            reserved,
          );
          changes.push(card.change);
          reserve(card.indexPath);
        }
        made.push({ id: knowledge.id, title: p.title.trim() });
      }
      const message = `Extraction : ${plural(made.length, "connaissance")} depuis « ${source.title} »`;
      await stage(changes, message);
      await commit(
        message,
        changes.map((c) => c.path),
      );
      setCreated(made);
      setStep("done");
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setBusy(null);
    }
  };

  const categoryLabel = (option: CategoryOption): string => option.path;

  return (
    <div className="page page--wide">
      {node ? (
        <Breadcrumb tree={derived.tree} node={node} />
      ) : discussion ? (
        <Breadcrumb
          tree={derived.tree}
          trail={[
            { label: "Discussions", href: href({ name: "discussions" }) },
            {
              label: discussionEntry?.meta.title ?? "Discussion",
              href: href({ name: "discussion", path: discussion }),
            },
          ]}
        />
      ) : (
        <Breadcrumb
          tree={derived.tree}
          trail={[{ label: "Bibliothèque", href: href({ name: "library" }) }]}
        />
      )}
      <h1>Extraire des connaissances</h1>
      <ol className="stepper">
        {(["source", "highlight", "propose", "done"] as const).map((s, i) => (
          <li key={s} className={step === s ? "is-current" : ""}>
            <span className="num">{i + 1}</span>
            {["Texte source", "Surlignage", "Propositions", "Terminé"][i]}
          </li>
        ))}
      </ol>
      {busy && (
        <p
          className="oe-alert oe-alert--info"
          role="status"
          style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}
        >
          <Spinner small /> {busy}
        </p>
      )}

      {step === "source" && (
        <section className="oe-card">
          <div role="tablist" className="toolbar" aria-label="Origine du texte">
            {isSourceNode && (
              <button
                type="button"
                role="tab"
                aria-selected={kind === "source"}
                className={`oe-button oe-button--sm ${kind === "source" ? "" : "oe-button--ghost"}`}
                onClick={() => setKind("source")}
              >
                Cette source
              </button>
            )}
            {discussion && (
              <button
                type="button"
                role="tab"
                aria-selected={kind === "discussion"}
                className={`oe-button oe-button--sm ${kind === "discussion" ? "" : "oe-button--ghost"}`}
                onClick={() => setKind("discussion")}
              >
                La discussion
              </button>
            )}
            <button
              type="button"
              role="tab"
              aria-selected={kind === "paste"}
              className={`oe-button oe-button--sm ${kind === "paste" ? "" : "oe-button--ghost"}`}
              onClick={() => setKind("paste")}
            >
              Coller un texte
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={kind === "pdf"}
              className={`oe-button oe-button--sm ${kind === "pdf" ? "" : "oe-button--ghost"}`}
              onClick={() => setKind("pdf")}
            >
              Importer un PDF
            </button>
          </div>
          {kind === "source" && node && (
            <p className="muted">
              Le contenu de « {node.title} » sera analysé ; les connaissances extraites citeront
              cette source.
            </p>
          )}
          {kind === "discussion" && (
            <p className="muted">
              L'échange avec Eugenia sera analysé. Les connaissances extraites en garderont la trace
              ; sans source extérieure, elles seront marquées « à sourcer » : vous pourrez leur en
              associer une à l'étape des propositions.
            </p>
          )}
          {(kind === "paste" || kind === "pdf") && (
            <div className="form-grid">
              <p className="muted small">
                Le texte devient une nouvelle source de votre bibliothèque, citée par les
                connaissances extraites.
              </p>
              <div className="form-row">
                <div className="oe-field">
                  <label className="oe-label" htmlFor="source-title">
                    Titre de la source
                  </label>
                  <input
                    id="source-title"
                    className="oe-input"
                    value={pasteTitle}
                    onChange={(e) => setPasteTitle(e.target.value)}
                    placeholder={kind === "pdf" ? pdf?.name : "Article sur…"}
                  />
                </div>
                <div className="oe-field">
                  <label className="oe-label" htmlFor="source-kind">
                    Nature
                  </label>
                  <select
                    id="source-kind"
                    className="oe-select"
                    value={sourceKind}
                    onChange={(e) => setSourceKind(e.target.value as SourceKind)}
                  >
                    {SOURCE_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {SOURCE_KIND_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="oe-field">
                  <label className="oe-label" htmlFor="source-authors">
                    Auteurs (facultatif)
                  </label>
                  <input
                    id="source-authors"
                    className="oe-input"
                    value={sourceAuthors}
                    onChange={(e) => setSourceAuthors(e.target.value)}
                  />
                </div>
                <div className="oe-field">
                  <label className="oe-label" htmlFor="source-url">
                    Adresse (facultatif)
                  </label>
                  <input
                    id="source-url"
                    className="oe-input"
                    type="url"
                    value={sourceUrl}
                    onChange={(e) => setSourceUrl(e.target.value)}
                    placeholder="https://…"
                  />
                </div>
              </div>
              {kind === "paste" ? (
                <div className="oe-field">
                  <label className="oe-label" htmlFor="source-text">
                    Texte
                  </label>
                  <textarea
                    id="source-text"
                    className="oe-textarea"
                    style={{ minHeight: "14rem" }}
                    value={pasteText}
                    onChange={(e) => setPasteText(e.target.value)}
                  />
                </div>
              ) : (
                <div className="oe-field">
                  <label
                    className="oe-button oe-button--secondary"
                    style={{ alignSelf: "flex-start" }}
                  >
                    <FileUp aria-hidden="true" /> Choisir un PDF
                    <input
                      type="file"
                      accept="application/pdf"
                      hidden
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setBusy("Lecture du PDF…");
                        setSourceKind("document");
                        void Promise.all([pdfToText(file), fileToBase64(file)])
                          .then(([result, base64]) => {
                            setPdf({ name: file.name, base64, text: result.text });
                            toast(
                              `${plural(result.pages, "page")} converties en texte.`,
                              "success",
                            );
                          })
                          .catch((error: unknown) =>
                            toast(`PDF illisible : ${errorMessage(error)}`, "error"),
                          )
                          .finally(() => setBusy(null));
                      }}
                    />
                  </label>
                  {pdf && (
                    <>
                      <span className="oe-help">
                        {pdf.name} : {plural(pdf.text.length, "caractère")} extraits.
                      </span>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={attachPdf}
                          onChange={(e) => setAttachPdf(e.target.checked)}
                        />
                        <span>Joindre le PDF à la source (fichier personnel, jamais publié)</span>
                      </label>
                    </>
                  )}
                  <p className="muted small">
                    Audio et vidéo : la transcription sera prise en charge dans une version
                    ultérieure.
                  </p>
                </div>
              )}
            </div>
          )}
          <div className="actions">
            <button
              type="button"
              className="oe-button"
              onClick={prepareSource}
              disabled={
                Boolean(busy) || (kind === "source" && nodeText.loading) || (kind === "pdf" && !pdf)
              }
            >
              Continuer
            </button>
          </div>
        </section>
      )}

      {step === "highlight" && source && (
        <div className="extract-layout">
          <section className="oe-card" style={{ padding: 0 }}>
            <div className="editor-toolbar">
              <button
                type="button"
                className="oe-button oe-button--sm"
                onClick={() => void autoHighlight()}
                disabled={Boolean(busy)}
              >
                <Wand2 aria-hidden="true" /> Surligner avec Eugenia
              </button>
              <button
                type="button"
                className="oe-button oe-button--ghost oe-button--sm"
                onClick={addSelection}
              >
                <Highlighter aria-hidden="true" /> Surligner la sélection
              </button>
            </div>
            <div ref={textRef} className="source-text" aria-label="Texte source">
              {segments(source.text, highlights).map((seg, i) =>
                seg.count === 0 ? (
                  <span key={i}>{seg.text}</span>
                ) : (
                  <mark
                    key={i}
                    className={`${seg.count > 1 ? "is-double" : ""}${focused && seg.ids.includes(focused) ? " is-focused" : ""}`}
                  >
                    {seg.text}
                  </mark>
                ),
              )}
            </div>
          </section>
          <section>
            <div className="section__head">
              <h2>
                {plural(highlights.length, "passage")} surligné{highlights.length > 1 ? "s" : ""}
              </h2>
              <button
                type="button"
                className="oe-button oe-button--sm"
                onClick={() => void propose()}
                disabled={Boolean(busy) || highlights.length === 0}
              >
                <Sparkles aria-hidden="true" /> Proposer des connaissances
              </button>
            </div>
            <p className="muted small">
              Ajoutez vos propres surlignages, découpez ou affinez ceux d'Eugenia : chaque passage
              deviendra une connaissance atomique.
            </p>
            <div className="form-grid">
              {highlights.map((h) => (
                <div
                  key={h.id}
                  className="highlight-item"
                  onMouseEnter={() => setFocused(h.id)}
                  onMouseLeave={() => setFocused(null)}
                >
                  <textarea
                    className="oe-textarea"
                    style={{ minHeight: "3.5rem" }}
                    value={h.quote}
                    aria-label="Passage surligné"
                    onChange={(e) =>
                      setHighlights((list) =>
                        list.map((x) => (x.id === h.id ? { ...x, quote: e.target.value } : x)),
                      )
                    }
                  />
                  {h.reason && <span className="muted small">{h.reason}</span>}
                  <div className="actions actions--start">
                    <span className="oe-badge">{h.origin === "eugenia" ? "Eugenia" : "Vous"}</span>
                    <button
                      type="button"
                      className="oe-button oe-button--ghost oe-button--sm"
                      onClick={() =>
                        setHighlights((list) =>
                          [...list, { ...h, id: highlightId(), origin: "user" as const }].sort(
                            (a, b) => a.start - b.start,
                          ),
                        )
                      }
                    >
                      <Scissors aria-hidden="true" /> Découper
                    </button>
                    <button
                      type="button"
                      className="oe-button oe-button--ghost oe-button--sm"
                      onClick={() => setHighlights((list) => list.filter((x) => x.id !== h.id))}
                    >
                      <Trash2 aria-hidden="true" /> Retirer
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {step === "propose" && (
        <section>
          <div className="section__head">
            <h2>{plural(proposals.filter((p) => p.include).length, "connaissance")} à créer</h2>
            <div className="actions">
              <button
                type="button"
                className="oe-button oe-button--ghost oe-button--sm"
                onClick={() => setStep("highlight")}
              >
                Retour au surlignage
              </button>
              <button
                type="button"
                className="oe-button oe-button--ghost oe-button--sm"
                onClick={() =>
                  setProposals((list) => [
                    ...list,
                    {
                      key: highlightId(),
                      include: true,
                      title: "",
                      knowledge: "",
                      question: "",
                      answer: "",
                      categoryId: defaultCategory,
                      newTitle: "",
                      newParentId: derived.tree.rootId,
                    },
                  ])
                }
              >
                <Plus aria-hidden="true" /> Ajouter
              </button>
            </div>
          </div>
          <section className="oe-card section" aria-label="Sources des connaissances">
            <h3 style={{ margin: 0 }}>Sources</h3>
            <p className="muted small">
              {source?.kind === "paste" || source?.kind === "pdf"
                ? `Chaque connaissance citera la nouvelle source « ${source.title} », et les sources ajoutées ici.`
                : "Chaque connaissance citera les sources ci-dessous."}
              {citations.length === 0 && source?.kind === "discussion"
                ? " Sans source, elles seront marquées « à sourcer » : appuyez-les de préférence sur une source extérieure."
                : ""}
            </p>
            <SourcesEditor
              tree={derived.tree}
              sources={citations}
              onChange={setCitations}
              drafts={drafts}
              onDraftsChange={setDrafts}
            />
          </section>
          <div className="form-grid">
            {proposals.map((p) => (
              <div key={p.key} className={`proposal${p.include ? "" : " is-excluded"}`}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={p.include}
                    onChange={(e) => update(p.key, { include: e.target.checked })}
                  />
                  <span>Créer cette connaissance</span>
                </label>
                <div className="form-row">
                  <div className="oe-field">
                    <label className="oe-label">Titre</label>
                    <input
                      className="oe-input"
                      value={p.title}
                      onChange={(e) => update(p.key, { title: e.target.value })}
                    />
                  </div>
                  <div className="oe-field">
                    <label className="oe-label">Catégorie</label>
                    <select
                      className="oe-select"
                      value={p.categoryId}
                      onChange={(e) => update(p.key, { categoryId: e.target.value })}
                    >
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {categoryLabel(c)}
                        </option>
                      ))}
                      <option value="new">Nouvelle catégorie…</option>
                    </select>
                  </div>
                </div>
                {p.categoryId === "new" && (
                  <div className="form-row">
                    <input
                      className="oe-input"
                      placeholder="Titre de la nouvelle catégorie"
                      value={p.newTitle}
                      onChange={(e) => update(p.key, { newTitle: e.target.value })}
                      aria-label="Nouvelle catégorie"
                    />
                    <select
                      className="oe-select"
                      value={p.newParentId}
                      onChange={(e) => update(p.key, { newParentId: e.target.value })}
                      aria-label="Sous la catégorie"
                    >
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          sous {categoryLabel(c)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="oe-field">
                  <label className="oe-label">Énoncé (cible d'apprentissage en **gras**)</label>
                  <textarea
                    className="oe-textarea"
                    style={{ minHeight: "4rem" }}
                    value={p.knowledge}
                    onChange={(e) => update(p.key, { knowledge: e.target.value })}
                  />
                </div>
                <div className="form-row">
                  <div className="oe-field">
                    <label className="oe-label">Question de la première flashcard</label>
                    <textarea
                      className="oe-textarea"
                      style={{ minHeight: "3.5rem" }}
                      value={p.question}
                      onChange={(e) => update(p.key, { question: e.target.value })}
                    />
                  </div>
                  <div className="oe-field">
                    <label className="oe-label">Réponse attendue</label>
                    <textarea
                      className="oe-textarea"
                      style={{ minHeight: "3.5rem" }}
                      value={p.answer}
                      onChange={(e) => update(p.key, { answer: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="actions section">
            <button
              type="button"
              className="oe-button"
              disabled={Boolean(busy)}
              onClick={() => void validate()}
            >
              <CheckCircle2 aria-hidden="true" /> Créer{" "}
              {plural(proposals.filter((p) => p.include).length, "connaissance")}
            </button>
          </div>
        </section>
      )}

      {step === "done" && (
        <section className="oe-card oe-card--featured">
          <h2 className="oe-card__title">
            {plural(created.length, "connaissance")} créée{created.length > 1 ? "s" : ""}
          </h2>
          <p className="oe-card__body">
            Tout a été regroupé dans un seul commit{" "}
            {useWiki.getState().online ? "" : "(envoyé au retour du réseau)"}.
          </p>
          <ul className="link-list">
            {created.map((c) => (
              <li key={c.id}>
                <Lightbulb aria-hidden="true" />{" "}
                <a href={href({ name: "node", id: c.id })}>{c.title}</a>
              </li>
            ))}
          </ul>
          <div className="actions actions--start">
            {node ? (
              <a
                className="oe-button oe-button--secondary"
                href={href({ name: "node", id: node.id })}
              >
                Retour à « {node.title} »
              </a>
            ) : discussion ? (
              <a
                className="oe-button oe-button--secondary"
                href={href({ name: "discussion", path: discussion })}
              >
                Retour à la discussion
              </a>
            ) : (
              <a className="oe-button oe-button--secondary" href={href({ name: "library" })}>
                Retour à la bibliothèque
              </a>
            )}
          </div>
        </section>
      )}
      {source && step !== "source" && step !== "done" && (
        <p className="muted small section">Source : {source.title}</p>
      )}
    </div>
  );
}
