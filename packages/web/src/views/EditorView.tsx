/**
 * Page editor (§9.2, view 10), according to its type: category (introduction text), atomic
 * knowledge (statement, notes, sources; first flashcard on creation), flashcard (question and
 * answer), library source (bibliographic record, personal file, content). Metadata is a form,
 * never raw frontmatter.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Bold, Eye, Heading2, Italic, Link2, Paperclip, Save } from "lucide-react";
import {
  createFlashcard,
  createPage,
  dirname,
  encodeLinkPath,
  flashcardTitle,
  joinPath,
  parseFlashcardBody,
  parseKnowledgeBody,
  parsePage,
  relativePath,
  serializeFlashcardBody,
  serializeKnowledgeBody,
  SOURCE_KINDS,
  updatePage,
  type FileChange,
  type PageType,
  type SourceKind,
  type SourceRef,
  type WikiNode,
} from "@openeugenia/core";
import {
  Breadcrumb,
  ErrorBox,
  InfoBox,
  Loading,
  SOURCE_KIND_LABELS,
  VisibilityBadge,
} from "../components/common.tsx";
import { Markdown } from "../components/Markdown.tsx";
import {
  MarkdownEditor,
  type LinkCompletion,
  type MarkdownEditorHandle,
} from "../components/MarkdownEditor.tsx";
import { NodePicker } from "../components/NodePicker.tsx";
import { SourcesEditor } from "../components/SourcesEditor.tsx";
import { fileToBase64, safeFileName } from "../lib/files.ts";
import { useDerived, useText } from "../lib/hooks.ts";
import { href, navigate } from "../lib/router.ts";
import { materializeSources, splitList, type NewSourceDraft } from "../lib/sources.ts";
import { normalizeTerm } from "../lib/text.ts";
import { errorMessage, toast } from "../store/ui.ts";
import { useWiki } from "../store/wiki.ts";

type EditorProps = { mode: "edit"; id: string } | { mode: "new"; parentId: string; type: PageType };

interface Upload {
  name: string;
  base64: string;
}

const NEW_TITLES: Record<PageType, string> = {
  category: "New category",
  knowledge: "New atomic knowledge item",
  flashcard: "New flashcard",
  source: "New source",
};

function Field({
  id,
  label,
  help,
  children,
}: {
  id?: string;
  label: string;
  help?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="oe-field">
      {id ? (
        <label className="oe-label" htmlFor={id}>
          {label}
        </label>
      ) : (
        <span className="oe-label">{label}</span>
      )}
      {help && <span className="oe-help">{help}</span>}
      {children}
    </div>
  );
}

function Toolbar({
  editor,
  onLink,
  onPreview,
  preview,
}: {
  editor: React.RefObject<MarkdownEditorHandle | null>;
  onLink(): void;
  onPreview?(): void;
  preview?: boolean;
}) {
  return (
    <div className="editor-toolbar" role="toolbar" aria-label="Formatting">
      <button
        type="button"
        className="oe-button oe-button--ghost oe-button--sm icon-only"
        title="Bold (learning target)"
        aria-label="Bold"
        onClick={() => editor.current?.wrap("**")}
      >
        <Bold />
      </button>
      <button
        type="button"
        className="oe-button oe-button--ghost oe-button--sm icon-only"
        title="Italic"
        aria-label="Italic"
        onClick={() => editor.current?.wrap("*")}
      >
        <Italic />
      </button>
      <button
        type="button"
        className="oe-button oe-button--ghost oe-button--sm icon-only"
        title="Heading"
        aria-label="Heading"
        onClick={() => editor.current?.insert("\n## ")}
      >
        <Heading2 />
      </button>
      <button
        type="button"
        className="oe-button oe-button--ghost oe-button--sm"
        title="Link to a page (or type [[)"
        onClick={onLink}
      >
        <Link2 aria-hidden="true" /> Link to a page
      </button>
      {onPreview && (
        <button
          type="button"
          className="oe-button oe-button--ghost oe-button--sm"
          aria-pressed={preview}
          onClick={onPreview}
          style={{ marginLeft: "auto" }}
        >
          <Eye aria-hidden="true" /> {preview ? "Edit" : "Preview"}
        </button>
      )}
    </div>
  );
}

export function EditorView(props: EditorProps) {
  const derived = useDerived();
  const workspace = useWiki((s) => s.workspace);
  const stage = useWiki((s) => s.stage);
  const node = props.mode === "edit" ? derived.tree.nodes.get(props.id) : undefined;
  const parent =
    props.mode === "new"
      ? derived.tree.nodes.get(props.parentId)
      : node?.parentId
        ? derived.tree.nodes.get(node.parentId)
        : undefined;
  const content = useText(node && !node.virtual ? node.indexPath : undefined);
  const type: PageType = props.mode === "new" ? props.type : (node?.type ?? "category");

  const [loaded, setLoaded] = useState(props.mode === "new");
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const [order, setOrder] = useState("");
  // Category and source: Markdown body; knowledge: statement and notes.
  const [body, setBody] = useState("");
  const [statement, setStatement] = useState("");
  const [notes, setNotes] = useState("");
  // Flashcard (or first flashcard of a new knowledge item).
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [legacyKnowledge, setLegacyKnowledge] = useState<string | undefined>(undefined);
  // Knowledge: cited sources and sources to create.
  const [sources, setSources] = useState<SourceRef[]>([]);
  const [drafts, setDrafts] = useState<NewSourceDraft[]>([]);
  // Source: bibliographic record and personal file.
  const [kind, setKind] = useState<SourceKind>("web");
  const [authors, setAuthors] = useState("");
  const [url, setUrl] = useState("");
  const [published, setPublished] = useState("");
  const [file, setFile] = useState("");
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [preview, setPreview] = useState(false);
  const [picker, setPicker] = useState<"body" | "statement" | null>(null);
  const [saving, setSaving] = useState(false);
  const bodyEditor = useRef<MarkdownEditorHandle>(null);
  const statementEditor = useRef<MarkdownEditorHandle>(null);

  useEffect(() => {
    if (props.mode !== "edit" || loaded || !node) return;
    if (node.virtual) {
      setTitle(node.title);
      setLoaded(true);
      return;
    }
    if (content.data === undefined) return;
    const doc = parsePage(content.data);
    const f = doc.fields;
    setTitle(f.title || node.title);
    setTags((f.tags ?? []).join(", "));
    setOrder(f.order !== undefined ? String(f.order) : "");
    setSources(f.sources ?? []);
    setKind(f.kind ?? "other");
    setAuthors((f.authors ?? []).join(", "));
    setUrl(f.url ?? "");
    setPublished(f.published ?? "");
    setFile(f.file ?? "");
    if (node.type === "flashcard") {
      const card = parseFlashcardBody(doc.body);
      setQuestion(card.question);
      setAnswer(card.answer);
      setLegacyKnowledge(card.knowledge);
      setNotes([card.preamble, card.others].filter(Boolean).join("\n\n"));
    } else if (node.type === "knowledge") {
      const k = parseKnowledgeBody(doc.body);
      setStatement(k.statement);
      setNotes(k.notes ?? "");
    } else {
      setBody(doc.body);
    }
    setLoaded(true);
  }, [props.mode, loaded, node, content.data]);

  // File the relative links are computed from.
  const filePath = node
    ? node.indexPath
    : parent
      ? joinPath(parent.path, "__nouvelle-page__", "index.md")
      : "index.md";
  const linkCompletions = useMemo(() => {
    return (query: string): LinkCompletion[] => {
      const q = normalizeTerm(query);
      return [...derived.tree.nodes.values()]
        .filter((n) => n.id !== node?.id && !n.virtual && normalizeTerm(n.title).includes(q))
        .slice(0, 12)
        .map((n) => ({
          label: n.title,
          detail:
            n.type === "knowledge"
              ? "knowledge"
              : n.type === "source"
                ? "source"
                : n.type === "flashcard"
                  ? "flashcard"
                  : "category",
          apply: `[${n.title.replace(/([[\]])/g, "\\$1")}](${encodeLinkPath(relativePath(dirname(filePath), n.indexPath))})`,
        }));
    };
  }, [derived.tree, node?.id, filePath]);

  if (props.mode === "edit" && !node)
    return (
      <div className="page">
        <ErrorBox title="Page not found">This page does not exist.</ErrorBox>
      </div>
    );
  if (props.mode === "new" && !parent)
    return (
      <div className="page">
        <ErrorBox title="Parent not found">The parent page does not exist.</ErrorBox>
      </div>
    );
  if (!loaded) return <Loading message="Loading the page…" />;

  const insertLink = (target: WikiNode): void => {
    const link = `[${target.title}](${encodeLinkPath(relativePath(dirname(filePath), target.indexPath))})`;
    (picker === "statement" ? statementEditor : bodyEditor).current?.insert(link);
    setPicker(null);
  };

  const attach = async (input: File, personal: boolean): Promise<void> => {
    const name = safeFileName(input.name);
    const base64 = await fileToBase64(input);
    setUploads((list) => [...list.filter((u) => u.name !== name), { name, base64 }]);
    if (personal) setFile(name);
    else if (/\.(png|jpe?g|gif|webp|svg|avif)$/i.test(name))
      bodyEditor.current?.insert(`\n![${input.name}](${encodeLinkPath(name)})\n`);
  };

  const pageBody = (): string => {
    switch (type) {
      case "knowledge":
        return serializeKnowledgeBody({ statement, ...(notes.trim() ? { notes } : {}) });
      case "flashcard":
        return serializeFlashcardBody({
          question,
          answer,
          ...(legacyKnowledge ? { knowledge: legacyKnowledge } : {}),
          ...(notes.trim() ? { others: notes } : {}),
        });
      default:
        return body;
    }
  };

  const save = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!workspace) return;
    const finalTitle = title.trim() || (type === "flashcard" ? flashcardTitle(question) : "");
    if (!finalTitle) return void toast("The title is required.", "error");
    if (type === "knowledge" && !statement.trim())
      return void toast("An atomic knowledge item must have a statement.", "error");
    if (type === "flashcard" && (!question.trim() || !answer.trim()))
      return void toast("A flashcard has a question and an expected answer.", "error");
    setSaving(true);
    try {
      const tagList = splitList(tags);
      const orderValue = order.trim() === "" ? null : Number(order);
      const reserved: string[] = [];
      const changes: FileChange[] = [];
      let citations: SourceRef[] | undefined;
      if (type === "knowledge") {
        const materialized = materializeSources(workspace, sources, drafts, reserved);
        changes.push(...materialized.changes);
        citations = materialized.sources;
      }
      const sourceFields =
        type === "source"
          ? {
              kind,
              authors: splitList(authors),
              url: url.trim(),
              published: published.trim(),
              file: file.trim(),
            }
          : undefined;
      let targetId: string;
      let message: string;
      let pageDir: string;
      if (props.mode === "new" && parent) {
        const created = createPage(
          workspace,
          {
            parentPath: parent.path,
            parentIsPublic: parent.isPublic,
            title: finalTitle,
            type,
            body: pageBody(),
            tags: tagList,
            ...(citations ? { sources: citations } : {}),
            ...(sourceFields
              ? {
                  kind: sourceFields.kind,
                  authors: sourceFields.authors,
                  ...(sourceFields.url ? { url: sourceFields.url } : {}),
                  ...(sourceFields.published ? { published: sourceFields.published } : {}),
                  ...(sourceFields.file ? { file: sourceFields.file } : {}),
                }
              : {}),
            ...(orderValue !== null && Number.isFinite(orderValue) ? { order: orderValue } : {}),
          },
          reserved,
        );
        reserved.push(created.indexPath);
        changes.push(created.change);
        targetId = created.id;
        pageDir = created.path;
        // First flashcard of a new knowledge item, in the same commit.
        if (type === "knowledge" && question.trim() && answer.trim()) {
          const card = createFlashcard(
            workspace,
            { path: created.path, isPublic: parent.isPublic },
            { question, answer },
            reserved,
          );
          changes.push(card.change);
        }
        message = `Create "${finalTitle}"`;
      } else {
        targetId = node!.id;
        pageDir = node!.path;
        if (finalTitle !== node!.title) await workspace.prefetchMarkdown();
        changes.push(
          ...(await updatePage(workspace, node!.id, {
            title: finalTitle,
            body: pageBody(),
            tags: tagList,
            order: orderValue !== null && Number.isFinite(orderValue) ? orderValue : null,
            ...(citations ? { sources: citations } : {}),
            ...(sourceFields ? { ...sourceFields } : {}),
          })),
        );
        message =
          finalTitle !== node!.title
            ? `Rename "${node!.title}" to "${finalTitle}"`
            : `Edit "${finalTitle}"`;
      }
      if (props.mode === "new") {
        changes.push(
          ...uploads.map((u) => ({
            op: "write-binary" as const,
            path: joinPath(pageDir, u.name),
            base64: u.base64,
          })),
        );
      }
      await stage(changes, message);
      if (props.mode === "edit" && uploads.length > 0) {
        const moved = useWiki.getState().derived?.tree.nodes.get(targetId);
        if (moved) {
          await stage(
            uploads.map((u) => ({
              op: "write-binary" as const,
              path: joinPath(moved.path, u.name),
              base64: u.base64,
            })),
            `Attach ${uploads.length} file(s) to "${moved.title}"`,
          );
        }
      }
      toast("Changes pending: remember to save them to the repository.", "success");
      navigate({ name: "node", id: targetId });
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setSaving(false);
    }
  };

  const context = node ?? parent!;
  const cancelHref = node
    ? href({ name: "node", id: node.id })
    : parent!.id === derived.tree.libraryId
      ? href({ name: "library" })
      : href({ name: "node", id: parent!.id });

  const markdownBody = (label: string, placeholder: string) => (
    <div className="section">
      <span className="oe-label">{label}</span>
      <Toolbar
        editor={bodyEditor}
        onLink={() => setPicker("body")}
        onPreview={() => setPreview((v) => !v)}
        preview={preview}
      />
      {preview ? (
        <div className="oe-card">
          <Markdown text={body || "_(vide)_"} path={filePath} />
        </div>
      ) : (
        <MarkdownEditor
          ref={bodyEditor}
          value={body}
          onChange={setBody}
          ariaLabel={label}
          linkCompletions={linkCompletions}
          placeholder={placeholder}
        />
      )}
    </div>
  );

  const flashcardFields = (required: boolean) => (
    <>
      <Field id="question" label={required ? "Question" : "Question (optional)"}>
        <textarea
          id="question"
          className="oe-textarea"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="What is the name of the female demon…?"
          required={required}
        />
      </Field>
      <Field id="answer" label={required ? "Expected answer" : "Expected answer (optional)"}>
        <textarea
          id="answer"
          className="oe-textarea"
          style={{ minHeight: "3rem" }}
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Lilith"
          required={required}
        />
      </Field>
    </>
  );

  return (
    <form className="page" onSubmit={(e) => void save(e)}>
      <Breadcrumb tree={derived.tree} node={context} />
      <h1>{props.mode === "new" ? NEW_TITLES[type] : `Edit "${node!.title}"`}</h1>
      {props.mode === "new" && (
        <p className="muted">
          {type === "source"
            ? "In the library."
            : type === "flashcard"
              ? `For the knowledge item "${parent!.title}".`
              : `In "${parent!.title}".`}{" "}
          A new page is private by default; you can make it public afterwards.
          {type === "source" &&
            " The bibliographic record of a private source (title, kind, authors, date, URL) is still published, so that public knowledge can cite it."}
        </p>
      )}

      <div className="form-grid section">
        <Field
          id="title"
          label={type === "flashcard" ? "Title (optional: taken from the question)" : "Title"}
          {...(props.mode === "edit" && title.trim() !== node!.title
            ? {
                help: "The page's folder will be renamed and the links that point to it will be rewritten.",
              }
            : {})}
        >
          <input
            id="title"
            className="oe-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required={type !== "flashcard"}
            autoFocus={props.mode === "new"}
          />
        </Field>
        {type !== "flashcard" && (
          <div className="form-row">
            <Field id="tags" label="Tags">
              <input
                id="tags"
                className="oe-input"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="astronomy, moon"
              />
            </Field>
            {type !== "source" && (
              <Field id="order" label="Order (optional)">
                <input
                  id="order"
                  className="oe-input"
                  type="number"
                  value={order}
                  onChange={(e) => setOrder(e.target.value)}
                />
              </Field>
            )}
          </div>
        )}
        {node && (
          <p className="small muted">
            Visibility: <VisibilityBadge visibility={node.isPublic ? "public" : "private"} /> — can
            be changed from the page, following the publication rules.
            {type === "source" &&
              !node.isPublic &&
              " Only the bibliographic record (title, kind, authors, date, URL) of a private source is published."}
          </p>
        )}
      </div>

      {type === "category" &&
        markdownBody(
          "Introduction (optional)",
          "Introduce this category. Type [[ to link another page.",
        )}

      {type === "knowledge" && (
        <>
          <div className="form-grid section">
            <Field
              label="Statement"
              help="A simple, precise statement, understandable without context; put the learning target in bold."
            >
              <div>
                <Toolbar editor={statementEditor} onLink={() => setPicker("statement")} />
                <MarkdownEditor
                  ref={statementEditor}
                  value={statement}
                  onChange={setStatement}
                  small
                  ariaLabel="Statement"
                  linkCompletions={linkCompletions}
                  placeholder="**Lilith** is a female demon of Jewish tradition…"
                />
              </div>
              {statement && !/\*\*[^*]+\*\*/.test(statement) && (
                <InfoBox kind="warning">
                  No bold part: select the learning target and click "Bold".
                </InfoBox>
              )}
            </Field>
            <details>
              <summary className="small">Notes (cross-references, details)</summary>
              <MarkdownEditor
                value={notes}
                onChange={setNotes}
                small
                ariaLabel="Notes"
                linkCompletions={linkCompletions}
                placeholder="## Notes\nSee also…"
              />
            </details>
          </div>
          <section className="section">
            <div className="section__head">
              <h2>Sources</h2>
            </div>
            <SourcesEditor
              tree={derived.tree}
              sources={sources}
              onChange={setSources}
              drafts={drafts}
              onDraftsChange={setDrafts}
            />
          </section>
          {props.mode === "new" && (
            <section className="section form-grid">
              <div className="section__head">
                <h2>First flashcard</h2>
              </div>
              <p className="muted small">
                A question to review this knowledge item. You can add others from its page.
              </p>
              {flashcardFields(false)}
            </section>
          )}
        </>
      )}

      {type === "flashcard" && (
        <div className="form-grid section">
          {flashcardFields(true)}
          <details>
            <summary className="small">Additional notes</summary>
            <MarkdownEditor
              value={notes}
              onChange={setNotes}
              small
              ariaLabel="Additional notes"
              linkCompletions={linkCompletions}
            />
          </details>
        </div>
      )}

      {type === "source" && (
        <>
          <div className="form-grid section">
            <div className="form-row">
              <Field id="kind" label="Kind">
                <select
                  id="kind"
                  className="oe-select"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as SourceKind)}
                >
                  {SOURCE_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {SOURCE_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field id="authors" label="Authors">
                <input
                  id="authors"
                  className="oe-input"
                  value={authors}
                  onChange={(e) => setAuthors(e.target.value)}
                  placeholder="René Descartes"
                />
              </Field>
              <Field id="published" label="Published">
                <input
                  id="published"
                  className="oe-input"
                  value={published}
                  onChange={(e) => setPublished(e.target.value)}
                  placeholder="1637"
                />
              </Field>
            </div>
            <Field id="url" label="URL">
              <input
                id="url"
                className="oe-input"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
              />
            </Field>
            <Field
              label="Personal file"
              help="The document itself (PDF…): it stays in your private repository and is never published."
            >
              <div className="actions actions--start">
                {file && (
                  <span className="small">
                    <Paperclip aria-hidden="true" className="inline-icon" /> {file}
                  </span>
                )}
                <label className="oe-button oe-button--ghost oe-button--sm">
                  <Paperclip aria-hidden="true" /> {file ? "Replace" : "Attach a file"}
                  <input
                    type="file"
                    hidden
                    onChange={(e) => e.target.files?.[0] && void attach(e.target.files[0], true)}
                  />
                </label>
                {file && (
                  <button
                    type="button"
                    className="oe-button oe-button--ghost oe-button--sm"
                    onClick={() => setFile("")}
                  >
                    Detach
                  </button>
                )}
              </div>
            </Field>
          </div>
          {markdownBody(
            "Content (summary, excerpts, reading notes)",
            "Paste an excerpt or summarize the source: you can then extract knowledge from it.",
          )}
        </>
      )}

      {type !== "flashcard" && (
        <section className="section">
          <label className="oe-button oe-button--ghost oe-button--sm">
            <Paperclip aria-hidden="true" /> Attach a file to the page (image, PDF…)
            <input
              type="file"
              hidden
              onChange={(e) => e.target.files?.[0] && void attach(e.target.files[0], false)}
            />
          </label>
          {uploads.length > 0 && (
            <p className="small muted">To attach: {uploads.map((u) => u.name).join(", ")}</p>
          )}
        </section>
      )}

      <div className="actions section">
        <a className="oe-button oe-button--ghost" href={cancelHref}>
          Cancel
        </a>
        <button type="submit" className="oe-button" disabled={saving}>
          <Save aria-hidden="true" /> {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {picker && (
        <NodePicker
          open
          title="Link a page"
          tree={derived.tree}
          filter={(n) => !n.virtual}
          onClose={() => setPicker(null)}
          onSelect={insertLink}
          hint="The relative link is computed automatically and rewritten if the target page moves."
        />
      )}
    </form>
  );
}
