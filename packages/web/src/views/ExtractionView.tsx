/**
 * Extraction of atomic knowledge (§8.1): a text (library source, discussion or quick note,
 * pasted text, PDF), the highlights of Eugenia and of the user, the proposals (statement, bold
 * target, title, first flashcard), the categories that group the knowledge of the document
 * (existing ones, or new ones proposed by Eugenia, as Wikipedia would file it), then a single
 * commit. A pasted text or a PDF becomes a library source; the extracted knowledge cites its
 * sources.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  FileUp,
  FolderPlus,
  Highlighter,
  Lightbulb,
  ListTree,
  Plus,
  Scissors,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import {
  createFlashcard,
  categoryForSource,
  createPage,
  findIndexNode,
  indexKnowledge,
  newCandidates,
  joinPath,
  markdownToText,
  parseDiscussion,
  parsePage,
  serializeKnowledgeBody,
  SOURCE_KINDS,
  type FileChange,
  type SourceKind,
  type SourceRef,
  updatePage,
} from "@openeugenia/core";
import {
  categorizeKnowledge,
  categoryOptions,
  highlightId,
  highlightKnowledge,
  orderPlanned,
  PLANNED_PREFIX,
  proposeKnowledge,
  type CategoryPlan,
  type Highlight,
  type PlannedCategory,
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
import { autoIndex, useSourceIndex } from "../lib/indexing.ts";
import { href } from "../lib/router.ts";
import { materializeSources, splitList, type NewSourceDraft } from "../lib/sources.ts";
import { errorMessage, toast } from "../store/ui.ts";
import { useWiki } from "../store/wiki.ts";

/** Origin of the text: library source, discussion, pasted text or PDF. */
type Origin = "source" | "discussion" | "paste" | "pdf";
type Step = "source" | "highlight" | "propose" | "done";

interface Source {
  kind: Origin;
  title: string;
  text: string;
  /** Source or discussion the text comes from. */
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
  /** Existing category, or key of a planned category (`new:…`). */
  categoryId: string;
}

/** Position of a selection in the displayed text. */
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

/** Splits the text into segments, each covered by 0, 1 or several highlights. */
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

const isPlanned = (id: string): boolean => id.startsWith(PLANNED_PREFIX);

export function ExtractionView({
  id,
  discussion,
  fromIndex,
}: {
  id?: string;
  discussion?: string;
  /** Starts from the knowledge proposed by the index of the source (`.`: the whole index). */
  fromIndex?: string;
}) {
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
  // Default category of the knowledge: the category the extraction started from, or the one the
  // source is filed in.
  const defaultCategory =
    node?.type === "category" && node.space === "wiki"
      ? node.id
      : isSourceNode && node.filedIn
        ? node.filedIn
        : derived.tree.rootId;
  // Knowledge proposed by the index of the source (all of it, or that of a section).
  const { index } = useSourceIndex(isSourceNode ? node : undefined);
  const indexed = useMemo(() => {
    if (!index) return [];
    const start =
      fromIndex && fromIndex !== "." ? findIndexNode(index.root, fromIndex) : index.root;
    if (!start || !node) return [];
    // What is already in the wiki is not proposed again.
    const kept = new Set(
      newCandidates(
        derived.tree,
        node.id,
        indexKnowledge(start).map((k) => k.candidate),
      ),
    );
    return indexKnowledge(start).filter((k) => kept.has(k.candidate));
  }, [index, fromIndex, derived.tree, node]);
  const startedFromIndex = useRef(false);
  // Sources cited by all the extracted knowledge (on top of the imported text).
  const [citations, setCitations] = useState<SourceRef[]>(isSourceNode ? [{ ref: node.id }] : []);
  const [drafts, setDrafts] = useState<NewSourceDraft[]>([]);
  const [source, setSource] = useState<Source | null>(null);
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [focused, setFocused] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [planned, setPlanned] = useState<PlannedCategory[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [created, setCreated] = useState<{
    knowledge: { id: string; title: string }[];
    categories: { id: string; title: string }[];
  }>({ knowledge: [], categories: [] });
  const textRef = useRef<HTMLDivElement>(null);
  const categories = useMemo(() => categoryOptions(derived), [derived]);

  useEffect(() => {
    if (!fromIndex || startedFromIndex.current || indexed.length === 0) return;
    if (nodeText.data === undefined) return;
    startedFromIndex.current = true;
    void proposeFromIndex();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromIndex, indexed, nodeText.data]);

  if (id && !node)
    return (
      <div className="page">
        <ErrorBox title="Page not found">This page does not exist.</ErrorBox>
      </div>
    );
  if (!editable)
    return (
      <div className="page">
        <InfoBox>Extraction is only possible in your own wiki, with write access.</InfoBox>
      </div>
    );

  const involvesPrivate = (): boolean =>
    !(source?.isPublic ?? false) ||
    categories.some((c) => derived.tree.nodes.get(c.id)?.isPublic === false);

  // Readable path of an existing or planned category.
  const plannedByKey = new Map(planned.map((c) => [c.key, c]));
  const existingPath = new Map(categories.map((c) => [c.id, c.path]));
  const pathOf = (categoryId: string, depth = 0): string => {
    const category = plannedByKey.get(categoryId);
    if (!category) return existingPath.get(categoryId) ?? "?";
    const parent = depth > planned.length ? "?" : pathOf(category.parent, depth + 1);
    return `${parent} > ${category.title.trim() || "(untitled)"}`;
  };
  /** True if `candidate` is `key` or lies below it among the planned categories. */
  const isWithin = (candidate: string, key: string): boolean => {
    let current = plannedByKey.get(candidate);
    for (let i = 0; current && i <= planned.length; i++) {
      if (current.key === key) return true;
      current = plannedByKey.get(current.parent);
    }
    return false;
  };
  const choices = [
    ...categories.map((c) => ({ value: c.id, label: c.path })),
    ...orderPlanned(planned).map((c) => ({ value: c.key, label: `${pathOf(c.key)} (new)` })),
  ];
  const usage = (key: string): number =>
    proposals.filter((p) => p.include && isWithin(p.categoryId, key)).length;

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
          .map((m) => `${m.role === "user" ? "Me" : "Eugenia"}: ${markdownToText(m.content)}`)
          .join("\n\n"),
        originId: doc.fields.id,
        isPublic: false,
      };
    } else if (kind === "paste") {
      if (!pasteText.trim()) return toast("Paste a text first.", "error");
      next = {
        kind,
        title: pasteTitle.trim() || "Imported text",
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
          ? "This source has no content: paste an excerpt into it or import the text."
          : "The source text is empty.",
        "error",
      );
    setSource(next);
    setHighlights([]);
    setStep("highlight");
  };

  /**
   * Review of the knowledge proposed by the index: no highlighting nor proposal step, the
   * categories are proposed for all of it together.
   */
  const proposeFromIndex = async (): Promise<void> => {
    if (!node || nodeText.data === undefined || indexed.length === 0) return;
    const next: Source = {
      kind: "source",
      title: node.title,
      text: markdownToText(parsePage(nodeText.data).body),
      originId: node.id,
      isPublic: node.isPublic,
    };
    setKind("source");
    setSource(next);
    setHighlights([]);
    let plan: CategoryPlan = {
      newCategories: [],
      assignments: indexed.map(() => defaultCategory),
    };
    setBusy("Eugenia is filing the knowledge into categories…");
    try {
      const context = await taskContext(
        !node.isPublic || categories.some((c) => derived.tree.nodes.get(c.id)?.isPublic === false),
      );
      plan = await categorizeKnowledge(context, {
        document: next.title,
        excerpt: next.text,
        categories,
        knowledge: indexed.map((k) => ({
          title: k.candidate.title,
          knowledge: k.candidate.statement,
        })),
        fallbackId: defaultCategory,
      });
    } catch (error) {
      toast(`Eugenia could not propose categories: ${errorMessage(error)}`, "error");
    } finally {
      setBusy(null);
    }
    setPlanned(plan.newCategories);
    setProposals(
      indexed.map((k, i) => ({
        key: `index-${i}`,
        include: true,
        title: k.candidate.title,
        knowledge: k.candidate.statement,
        question: k.candidate.question,
        answer: k.candidate.answer,
        categoryId: plan.assignments[i] ?? defaultCategory,
      })),
    );
    setStep("propose");
  };

  const autoHighlight = async (): Promise<void> => {
    if (!source) return;
    setBusy("Eugenia is highlighting the knowledge…");
    try {
      const context = await taskContext(involvesPrivate());
      const found = await highlightKnowledge(context, source.text);
      setHighlights((list) =>
        [...list.filter((h) => h.origin === "user"), ...found].sort((a, b) => a.start - b.start),
      );
      toast(`${plural(found.length, "passage")} highlighted.`, "success");
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
      return toast("Select a passage in the text.", "error");
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
    if (kept.length === 0) return toast("Highlight at least one passage.", "error");
    setBusy("Eugenia is proposing knowledge…");
    try {
      const context = await taskContext(involvesPrivate());
      const result = await proposeKnowledge(context, { text: source.text, highlights: kept });
      // Categories: all the knowledge of the document together, as Wikipedia would file it.
      setBusy("Eugenia is filing the knowledge into categories…");
      let plan: CategoryPlan = {
        newCategories: [],
        assignments: result.map(() => defaultCategory),
      };
      try {
        plan = await categorizeKnowledge(context, {
          document: source.title,
          excerpt: source.text,
          categories,
          knowledge: result.map((p) => ({ title: p.title, knowledge: p.knowledge })),
          fallbackId: defaultCategory,
        });
      } catch (error) {
        toast(`Eugenia could not propose categories: ${errorMessage(error)}`, "error");
      }
      setPlanned(plan.newCategories);
      setProposals(
        result.map((p, i) => ({
          key: `${p.highlightId}-${i}`,
          include: true,
          title: p.title,
          knowledge: p.knowledge,
          question: p.question,
          answer: p.answer,
          categoryId: plan.assignments[i] ?? defaultCategory,
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

  const updatePlanned = (key: string, patch: Partial<PlannedCategory>): void =>
    setPlanned((list) => list.map((c) => (c.key === key ? { ...c, ...patch } : c)));

  const addPlanned = (): void =>
    setPlanned((list) => [
      ...list,
      { key: `${PLANNED_PREFIX}${highlightId()}`, title: "", parent: defaultCategory },
    ]);

  /** Removes a planned category: its knowledge and subcategories move up to its parent. */
  const removePlanned = (key: string): void => {
    const removed = plannedByKey.get(key);
    if (!removed) return;
    setPlanned((list) =>
      list
        .filter((c) => c.key !== key)
        .map((c) => (c.parent === key ? { ...c, parent: removed.parent } : c)),
    );
    setProposals((list) =>
      list.map((p) => (p.categoryId === key ? { ...p, categoryId: removed.parent } : p)),
    );
  };

  const validate = async (): Promise<void> => {
    const { workspace, stage, commit } = useWiki.getState();
    if (!workspace || !source) return;
    const selected = proposals.filter((p) => p.include && p.title.trim() && p.knowledge.trim());
    if (selected.length === 0)
      return toast("Select at least one complete knowledge item.", "error");
    // New categories that hold a selected knowledge item, directly or below.
    const used = new Set<string>();
    for (const p of selected) {
      let category = plannedByKey.get(p.categoryId);
      while (category && !used.has(category.key)) {
        used.add(category.key);
        category = plannedByKey.get(category.parent);
      }
    }
    if ([...used].some((key) => !plannedByKey.get(key)!.title.trim()))
      return toast("Give a title to every new category that holds knowledge.", "error");
    setBusy("Creating the knowledge…");
    try {
      const tree = workspace.tree;
      const changes: FileChange[] = [];
      const reserved: string[] = [];
      const reserve = (path: string): void => {
        reserved.push(path);
      };
      // 1. New categories, each one after its parent.
      const newCategories = new Map<
        string,
        { id: string; path: string; isPublic: boolean; parentId: string }
      >();
      const madeCategories: { id: string; title: string }[] = [];
      const location = (categoryId: string): { path: string; isPublic: boolean } => {
        const fresh = newCategories.get(categoryId);
        if (fresh) return fresh;
        const existing = tree.nodes.get(categoryId) ?? tree.nodes.get(tree.rootId)!;
        return { path: existing.path, isPublic: existing.isPublic };
      };
      const categoryId = (key: string): string =>
        newCategories.get(key)?.id ?? (tree.nodes.has(key) ? key : tree.rootId);
      for (const category of orderPlanned(planned)) {
        if (!used.has(category.key)) continue;
        const parent = location(category.parent);
        const page = createPage(
          workspace,
          {
            parentPath: parent.path,
            parentIsPublic: parent.isPublic,
            title: category.title.trim(),
          },
          reserved,
        );
        changes.push(page.change);
        reserve(page.indexPath);
        newCategories.set(category.key, {
          id: page.id,
          path: page.path,
          isPublic: false,
          parentId: categoryId(category.parent),
        });
        madeCategories.push({ id: page.id, title: category.title.trim() });
      }
      // Common hierarchy: the source is filed where its knowledge goes.
      const parentIds = new Map([...newCategories.values()].map((c) => [c.id, c.parentId]));
      const sourceCategory = categoryForSource(
        selected.map((p) => categoryId(p.categoryId)),
        (id) => parentIds.get(id) ?? tree.nodes.get(id)?.parentId,
        tree.rootId,
      );
      const filedCategory = sourceCategory !== tree.rootId ? sourceCategory : undefined;
      // 2. Pasted text or PDF: new library source, with its file.
      let originId = source.originId;
      const refs: SourceRef[] = [...citations];
      let newSource: string | undefined;
      if (source.kind === "paste" || source.kind === "pdf") {
        const library = tree.nodes.get(tree.libraryId)!;
        const fileName = source.pdf && source.attachPdf ? safeFileName(source.pdf.name) : undefined;
        const page = createPage(
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
            ...(filedCategory ? { category: filedCategory } : {}),
            body: source.text
              .split(/\n{2,}/)
              .map((p) => `> ${p.replace(/\n/g, "\n> ")}`)
              .join("\n>\n"),
          },
          reserved,
        );
        changes.push(page.change);
        reserve(page.indexPath);
        if (source.pdf && fileName) {
          const path = joinPath(page.path, fileName);
          changes.push({ op: "write-binary", path, base64: source.pdf.base64 });
          reserve(path);
        }
        originId = page.id;
        newSource = page.id;
        refs.unshift({ ref: page.id });
      } else if (source.kind === "source" && originId && filedCategory) {
        // A source not filed yet is filed with its first extraction.
        const origin = tree.nodes.get(originId);
        if (origin?.type === "source" && !origin.category) {
          changes.push(...(await updatePage(workspace, originId, { category: filedCategory })));
        }
      }
      const materialized = materializeSources(workspace, refs, drafts, reserved);
      changes.push(...materialized.changes);
      const sources = materialized.sources;
      // 3. Atomic knowledge and its first flashcard.
      const made: { id: string; title: string }[] = [];
      for (const p of selected) {
        const parent = location(p.categoryId);
        const knowledge = createPage(
          workspace,
          {
            parentPath: parent.path,
            parentIsPublic: parent.isPublic,
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
      const message = `Extraction: ${plural(made.length, "knowledge item")} from "${source.title}"`;
      await stage(changes, message);
      await commit(
        message,
        changes.map((c) => c.path),
      );
      setCreated({ knowledge: made, categories: madeCategories });
      setStep("done");
      // The new source is indexed (if automatic indexing is on).
      if (newSource) void autoIndex([newSource]);
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setBusy(null);
    }
  };

  const included = proposals.filter((p) => p.include).length;

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
          trail={[{ label: "Library", href: href({ name: "library" }) }]}
        />
      )}
      <h1>Extract knowledge</h1>
      <ol className="stepper">
        {(["source", "highlight", "propose", "done"] as const).map((s, i) => (
          <li key={s} className={step === s ? "is-current" : ""}>
            <span className="num">{i + 1}</span>
            {["Source text", "Highlighting", "Proposals", "Done"][i]}
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
          <div role="tablist" className="toolbar" aria-label="Origin of the text">
            {isSourceNode && (
              <button
                type="button"
                role="tab"
                aria-selected={kind === "source"}
                className={`oe-button oe-button--sm ${kind === "source" ? "" : "oe-button--ghost"}`}
                onClick={() => setKind("source")}
              >
                This source
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
                The discussion
              </button>
            )}
            <button
              type="button"
              role="tab"
              aria-selected={kind === "paste"}
              className={`oe-button oe-button--sm ${kind === "paste" ? "" : "oe-button--ghost"}`}
              onClick={() => setKind("paste")}
            >
              Paste a text
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={kind === "pdf"}
              className={`oe-button oe-button--sm ${kind === "pdf" ? "" : "oe-button--ghost"}`}
              onClick={() => setKind("pdf")}
            >
              Import a PDF
            </button>
          </div>
          {kind === "source" && node && (
            <p className="muted">
              The content of "{node.title}" will be analyzed; the extracted knowledge will cite this
              source.
            </p>
          )}
          {kind === "discussion" && (
            <p className="muted">
              The exchange with Eugenia will be analyzed. The extracted knowledge will keep track of
              it; without an external source, it will be marked "needs a source": you can attach one
              at the proposals step.
            </p>
          )}
          {(kind === "paste" || kind === "pdf") && (
            <div className="form-grid">
              <p className="muted small">
                The text becomes a new source of your library, cited by the extracted knowledge.
              </p>
              <div className="form-row">
                <div className="oe-field">
                  <label className="oe-label" htmlFor="source-title">
                    Source title
                  </label>
                  <input
                    id="source-title"
                    className="oe-input"
                    value={pasteTitle}
                    onChange={(e) => setPasteTitle(e.target.value)}
                    placeholder={kind === "pdf" ? pdf?.name : "Article on…"}
                  />
                </div>
                <div className="oe-field">
                  <label className="oe-label" htmlFor="source-kind">
                    Kind
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
                    Authors (optional)
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
                    URL (optional)
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
                    Text
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
                    <FileUp aria-hidden="true" /> Choose a PDF
                    <input
                      type="file"
                      accept="application/pdf"
                      hidden
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setBusy("Reading the PDF…");
                        setSourceKind("document");
                        void Promise.all([pdfToText(file), fileToBase64(file)])
                          .then(([result, base64]) => {
                            setPdf({ name: file.name, base64, text: result.text });
                            toast(`${plural(result.pages, "page")} converted to text.`, "success");
                          })
                          .catch((error: unknown) =>
                            toast(`Unreadable PDF: ${errorMessage(error)}`, "error"),
                          )
                          .finally(() => setBusy(null));
                      }}
                    />
                  </label>
                  {pdf && (
                    <>
                      <span className="oe-help">
                        {pdf.name}: {plural(pdf.text.length, "character")} extracted.
                      </span>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={attachPdf}
                          onChange={(e) => setAttachPdf(e.target.checked)}
                        />
                        <span>Attach the PDF to the source (personal file, never published)</span>
                      </label>
                    </>
                  )}
                  <p className="muted small">
                    Audio and video: transcription will be supported in a later version.
                  </p>
                </div>
              )}
            </div>
          )}
          <div className="actions">
            {kind === "source" && indexed.length > 0 && (
              <button
                type="button"
                className="oe-button oe-button--secondary"
                onClick={() => void proposeFromIndex()}
                disabled={Boolean(busy) || nodeText.loading}
                title="The knowledge proposed when the source was indexed: review it, without highlighting"
              >
                <ListTree aria-hidden="true" /> Use the {plural(indexed.length, "item")} proposed by
                the index
              </button>
            )}
            <button
              type="button"
              className="oe-button"
              onClick={prepareSource}
              disabled={
                Boolean(busy) || (kind === "source" && nodeText.loading) || (kind === "pdf" && !pdf)
              }
            >
              Continue
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
                <Wand2 aria-hidden="true" /> Highlight with Eugenia
              </button>
              <button
                type="button"
                className="oe-button oe-button--ghost oe-button--sm"
                onClick={addSelection}
              >
                <Highlighter aria-hidden="true" /> Highlight the selection
              </button>
            </div>
            <div ref={textRef} className="source-text" aria-label="Source text">
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
              <h2>{plural(highlights.length, "passage")} highlighted</h2>
              <button
                type="button"
                className="oe-button oe-button--sm"
                onClick={() => void propose()}
                disabled={Boolean(busy) || highlights.length === 0}
              >
                <Sparkles aria-hidden="true" /> Propose knowledge
              </button>
            </div>
            <p className="muted small">
              Add your own highlights, split or refine Eugenia's: each passage will become an atomic
              knowledge item.
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
                    aria-label="Highlighted passage"
                    onChange={(e) =>
                      setHighlights((list) =>
                        list.map((x) => (x.id === h.id ? { ...x, quote: e.target.value } : x)),
                      )
                    }
                  />
                  {h.reason && <span className="muted small">{h.reason}</span>}
                  <div className="actions actions--start">
                    <span className="oe-badge">{h.origin === "eugenia" ? "Eugenia" : "You"}</span>
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
                      <Scissors aria-hidden="true" /> Split
                    </button>
                    <button
                      type="button"
                      className="oe-button oe-button--ghost oe-button--sm"
                      onClick={() => setHighlights((list) => list.filter((x) => x.id !== h.id))}
                    >
                      <Trash2 aria-hidden="true" /> Remove
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
            <h2>{plural(included, "knowledge item")} to create</h2>
            <div className="actions">
              <button
                type="button"
                className="oe-button oe-button--ghost oe-button--sm"
                onClick={() => setStep("highlight")}
              >
                Back to highlighting
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
                    },
                  ])
                }
              >
                <Plus aria-hidden="true" /> Add
              </button>
            </div>
          </div>
          <section className="oe-card section" aria-label="Sources of the knowledge">
            <h3 style={{ margin: 0 }}>Sources</h3>
            <p className="muted small">
              {source?.kind === "paste" || source?.kind === "pdf"
                ? `Each knowledge item will cite the new source "${source.title}", and the sources added here.`
                : "Each knowledge item will cite the sources below."}
              {citations.length === 0 && source?.kind === "discussion"
                ? ' Without a source, they will be marked "needs a source": preferably back them with an external source.'
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
          <section className="oe-card section" aria-label="New categories">
            <h3 style={{ margin: 0 }}>New categories</h3>
            <p className="muted small">
              Eugenia compared the knowledge of "{source?.title}" with your categories, and proposes
              the categories that group it best, as Wikipedia would. Rename, move or remove them:
              only the categories that end up holding knowledge are created.
            </p>
            {planned.length === 0 && (
              <p className="muted small">
                No new category: the knowledge fits in your existing categories.
              </p>
            )}
            <div className="form-grid">
              {orderPlanned(planned).map((c) => (
                <div key={c.key} className="planned-category">
                  <div className="form-row">
                    <input
                      className="oe-input"
                      value={c.title}
                      placeholder="Title of the new category"
                      aria-label="Title of the new category"
                      onChange={(e) => updatePlanned(c.key, { title: e.target.value })}
                    />
                    <select
                      className="oe-select"
                      value={c.parent}
                      aria-label={`Parent of "${c.title || "the new category"}"`}
                      onChange={(e) => updatePlanned(c.key, { parent: e.target.value })}
                    >
                      {choices
                        .filter((o) => !isWithin(o.value, c.key))
                        .map((o) => (
                          <option key={o.value} value={o.value}>
                            under {o.label}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="actions actions--start">
                    <span className="muted small">{plural(usage(c.key), "knowledge item")}</span>
                    {c.reason && <span className="muted small">· {c.reason}</span>}
                    <button
                      type="button"
                      className="oe-button oe-button--ghost oe-button--sm"
                      onClick={() => removePlanned(c.key)}
                    >
                      <Trash2 aria-hidden="true" /> Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="actions actions--start">
              <button
                type="button"
                className="oe-button oe-button--ghost oe-button--sm"
                onClick={addPlanned}
              >
                <FolderPlus aria-hidden="true" /> New category
              </button>
            </div>
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
                  <span>Create this knowledge item</span>
                </label>
                <div className="form-row">
                  <div className="oe-field">
                    <label className="oe-label">Title</label>
                    <input
                      className="oe-input"
                      value={p.title}
                      onChange={(e) => update(p.key, { title: e.target.value })}
                    />
                  </div>
                  <div className="oe-field">
                    <label className="oe-label">Category</label>
                    <select
                      className="oe-select"
                      value={p.categoryId}
                      onChange={(e) => update(p.key, { categoryId: e.target.value })}
                    >
                      {choices.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="oe-field">
                  <label className="oe-label">Statement (learning target in **bold**)</label>
                  <textarea
                    className="oe-textarea"
                    style={{ minHeight: "4rem" }}
                    value={p.knowledge}
                    onChange={(e) => update(p.key, { knowledge: e.target.value })}
                  />
                </div>
                <div className="form-row">
                  <div className="oe-field">
                    <label className="oe-label">Question of the first flashcard</label>
                    <textarea
                      className="oe-textarea"
                      style={{ minHeight: "3.5rem" }}
                      value={p.question}
                      onChange={(e) => update(p.key, { question: e.target.value })}
                    />
                  </div>
                  <div className="oe-field">
                    <label className="oe-label">Expected answer</label>
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
              <CheckCircle2 aria-hidden="true" /> Create {plural(included, "knowledge item")}
            </button>
          </div>
        </section>
      )}

      {step === "done" && (
        <section className="oe-card oe-card--featured">
          <h2 className="oe-card__title">
            {plural(created.knowledge.length, "knowledge item")} created
          </h2>
          <p className="oe-card__body">
            Everything was grouped in a single commit{" "}
            {useWiki.getState().online ? "" : "(sent when the network is back)"}.
          </p>
          <ul className="link-list">
            {created.knowledge.map((c) => (
              <li key={c.id}>
                <Lightbulb aria-hidden="true" />{" "}
                <a href={href({ name: "node", id: c.id })}>{c.title}</a>
              </li>
            ))}
          </ul>
          {created.categories.length > 0 && (
            <>
              <p className="oe-card__body">
                In {plural(created.categories.length, "new category", "new categories")}:
              </p>
              <ul className="link-list">
                {created.categories.map((c) => (
                  <li key={c.id}>
                    <FolderPlus aria-hidden="true" />{" "}
                    <a href={href({ name: "node", id: c.id })}>{c.title}</a>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="actions actions--start">
            {node ? (
              <a
                className="oe-button oe-button--secondary"
                href={href({ name: "node", id: node.id })}
              >
                Back to "{node.title}"
              </a>
            ) : discussion ? (
              <a
                className="oe-button oe-button--secondary"
                href={href({ name: "discussion", path: discussion })}
              >
                Back to the discussion
              </a>
            ) : (
              <a className="oe-button oe-button--secondary" href={href({ name: "library" })}>
                Back to the library
              </a>
            )}
          </div>
        </section>
      )}
      {source && step !== "source" && step !== "done" && (
        <p className="muted small section">Source: {source.title}</p>
      )}
    </div>
  );
}
