/**
 * Éditeur d'une page (§9.2, vue 10), selon son type : catégorie (texte d'introduction),
 * connaissance atomique (énoncé, notes, sources ; première flashcard à la création), flashcard
 * (question et réponse), source de la bibliothèque (notice, fichier personnel, contenu). Les
 * métadonnées sont un formulaire, jamais du frontmatter brut.
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
  category: "Nouvelle catégorie",
  knowledge: "Nouvelle connaissance atomique",
  flashcard: "Nouvelle flashcard",
  source: "Nouvelle source",
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
    <div className="editor-toolbar" role="toolbar" aria-label="Mise en forme">
      <button
        type="button"
        className="oe-button oe-button--ghost oe-button--sm icon-only"
        title="Gras (cible d'apprentissage)"
        aria-label="Gras"
        onClick={() => editor.current?.wrap("**")}
      >
        <Bold />
      </button>
      <button
        type="button"
        className="oe-button oe-button--ghost oe-button--sm icon-only"
        title="Italique"
        aria-label="Italique"
        onClick={() => editor.current?.wrap("*")}
      >
        <Italic />
      </button>
      <button
        type="button"
        className="oe-button oe-button--ghost oe-button--sm icon-only"
        title="Intertitre"
        aria-label="Intertitre"
        onClick={() => editor.current?.insert("\n## ")}
      >
        <Heading2 />
      </button>
      <button
        type="button"
        className="oe-button oe-button--ghost oe-button--sm"
        title="Lien vers une page (ou tapez [[)"
        onClick={onLink}
      >
        <Link2 aria-hidden="true" /> Lien vers une page
      </button>
      {onPreview && (
        <button
          type="button"
          className="oe-button oe-button--ghost oe-button--sm"
          aria-pressed={preview}
          onClick={onPreview}
          style={{ marginLeft: "auto" }}
        >
          <Eye aria-hidden="true" /> {preview ? "Éditer" : "Aperçu"}
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
  // Catégorie et source : corps Markdown ; connaissance : énoncé et notes.
  const [body, setBody] = useState("");
  const [statement, setStatement] = useState("");
  const [notes, setNotes] = useState("");
  // Flashcard (ou première flashcard d'une nouvelle connaissance).
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [legacyKnowledge, setLegacyKnowledge] = useState<string | undefined>(undefined);
  // Connaissance : sources citées et sources à créer.
  const [sources, setSources] = useState<SourceRef[]>([]);
  const [drafts, setDrafts] = useState<NewSourceDraft[]>([]);
  // Source : notice et fichier personnel.
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

  // Fichier depuis lequel les liens relatifs sont calculés.
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
              ? "connaissance"
              : n.type === "source"
                ? "source"
                : n.type === "flashcard"
                  ? "flashcard"
                  : "catégorie",
          apply: `[${n.title.replace(/([[\]])/g, "\\$1")}](${encodeLinkPath(relativePath(dirname(filePath), n.indexPath))})`,
        }));
    };
  }, [derived.tree, node?.id, filePath]);

  if (props.mode === "edit" && !node)
    return (
      <div className="page">
        <ErrorBox title="Page introuvable">Cette page n'existe pas.</ErrorBox>
      </div>
    );
  if (props.mode === "new" && !parent)
    return (
      <div className="page">
        <ErrorBox title="Parent introuvable">La page parente n'existe pas.</ErrorBox>
      </div>
    );
  if (!loaded) return <Loading message="Chargement de la page…" />;

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
    if (!finalTitle) return void toast("Le titre est obligatoire.", "error");
    if (type === "knowledge" && !statement.trim())
      return void toast("Une connaissance atomique doit avoir un énoncé.", "error");
    if (type === "flashcard" && (!question.trim() || !answer.trim()))
      return void toast("Une flashcard a une question et une réponse attendue.", "error");
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
        // Première flashcard d'une nouvelle connaissance, dans le même commit.
        if (type === "knowledge" && question.trim() && answer.trim()) {
          const card = createFlashcard(
            workspace,
            { path: created.path, isPublic: parent.isPublic },
            { question, answer },
            reserved,
          );
          changes.push(card.change);
        }
        message = `Créer « ${finalTitle} »`;
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
            ? `Renommer « ${node!.title} » en « ${finalTitle} »`
            : `Modifier « ${finalTitle} »`;
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
            `Joindre ${uploads.length} fichier(s) à « ${moved.title} »`,
          );
        }
      }
      toast("Modifications en attente : pensez à les enregistrer dans le dépôt.", "success");
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
      <Field id="question" label={required ? "Question" : "Question (facultatif)"}>
        <textarea
          id="question"
          className="oe-textarea"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Quel est le nom du démon féminin… ?"
          required={required}
        />
      </Field>
      <Field id="answer" label={required ? "Réponse attendue" : "Réponse attendue (facultatif)"}>
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
      <h1>{props.mode === "new" ? NEW_TITLES[type] : `Modifier « ${node!.title} »`}</h1>
      {props.mode === "new" && (
        <p className="muted">
          {type === "source"
            ? "Dans la bibliothèque."
            : type === "flashcard"
              ? `Pour la connaissance « ${parent!.title} ».`
              : `Dans « ${parent!.title} ».`}{" "}
          Une nouvelle page est privée par défaut ; vous pourrez la rendre publique ensuite.
        </p>
      )}

      <div className="form-grid section">
        <Field
          id="title"
          label={type === "flashcard" ? "Titre (facultatif : tiré de la question)" : "Titre"}
          {...(props.mode === "edit" && title.trim() !== node!.title
            ? {
                help: "Le dossier de la page sera renommé et les liens qui pointent vers elle seront réécrits.",
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
            <Field id="tags" label="Étiquettes">
              <input
                id="tags"
                className="oe-input"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="astronomie, lune"
              />
            </Field>
            {type !== "source" && (
              <Field id="order" label="Ordre (facultatif)">
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
            Visibilité : <VisibilityBadge visibility={node.isPublic ? "public" : "private"} /> —
            modifiable depuis la page, selon les règles de publication.
          </p>
        )}
      </div>

      {type === "category" &&
        markdownBody(
          "Introduction (facultatif)",
          "Présentez cette catégorie. Tapez [[ pour lier une autre page.",
        )}

      {type === "knowledge" && (
        <>
          <div className="form-grid section">
            <Field
              label="Énoncé"
              help="Un énoncé simple, précis, compréhensible sans contexte ; mettez en gras la cible d'apprentissage."
            >
              <div>
                <Toolbar editor={statementEditor} onLink={() => setPicker("statement")} />
                <MarkdownEditor
                  ref={statementEditor}
                  value={statement}
                  onChange={setStatement}
                  small
                  ariaLabel="Énoncé"
                  linkCompletions={linkCompletions}
                  placeholder="**Lilith** est un démon féminin de la tradition juive…"
                />
              </div>
              {statement && !/\*\*[^*]+\*\*/.test(statement) && (
                <InfoBox kind="warning">
                  Aucune partie en gras : sélectionnez la cible d'apprentissage et cliquez sur «
                  Gras ».
                </InfoBox>
              )}
            </Field>
            <details>
              <summary className="small">Notes (renvois, précisions)</summary>
              <MarkdownEditor
                value={notes}
                onChange={setNotes}
                small
                ariaLabel="Notes"
                linkCompletions={linkCompletions}
                placeholder="## Notes\nVoir aussi…"
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
                <h2>Première flashcard</h2>
              </div>
              <p className="muted small">
                Une question pour réviser cette connaissance. Vous pourrez en ajouter d'autres
                depuis sa page.
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
            <summary className="small">Notes complémentaires</summary>
            <MarkdownEditor
              value={notes}
              onChange={setNotes}
              small
              ariaLabel="Notes complémentaires"
              linkCompletions={linkCompletions}
            />
          </details>
        </div>
      )}

      {type === "source" && (
        <>
          <div className="form-grid section">
            <div className="form-row">
              <Field id="kind" label="Nature">
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
              <Field id="authors" label="Auteurs">
                <input
                  id="authors"
                  className="oe-input"
                  value={authors}
                  onChange={(e) => setAuthors(e.target.value)}
                  placeholder="René Descartes"
                />
              </Field>
              <Field id="published" label="Publication">
                <input
                  id="published"
                  className="oe-input"
                  value={published}
                  onChange={(e) => setPublished(e.target.value)}
                  placeholder="1637"
                />
              </Field>
            </div>
            <Field id="url" label="Adresse">
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
              label="Fichier personnel"
              help="Le document lui-même (PDF…) : il reste dans votre dépôt privé et n'est jamais publié."
            >
              <div className="actions actions--start">
                {file && (
                  <span className="small">
                    <Paperclip aria-hidden="true" className="inline-icon" /> {file}
                  </span>
                )}
                <label className="oe-button oe-button--ghost oe-button--sm">
                  <Paperclip aria-hidden="true" /> {file ? "Remplacer" : "Joindre un fichier"}
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
                    Détacher
                  </button>
                )}
              </div>
            </Field>
          </div>
          {markdownBody(
            "Contenu (résumé, extraits, notes de lecture)",
            "Collez un extrait ou résumez la source : vous pourrez en extraire des connaissances.",
          )}
        </>
      )}

      {type !== "flashcard" && (
        <section className="section">
          <label className="oe-button oe-button--ghost oe-button--sm">
            <Paperclip aria-hidden="true" /> Joindre un fichier à la page (image, PDF…)
            <input
              type="file"
              hidden
              onChange={(e) => e.target.files?.[0] && void attach(e.target.files[0], false)}
            />
          </label>
          {uploads.length > 0 && (
            <p className="small muted">À joindre : {uploads.map((u) => u.name).join(", ")}</p>
          )}
        </section>
      )}

      <div className="actions section">
        <a className="oe-button oe-button--ghost" href={cancelHref}>
          Annuler
        </a>
        <button type="submit" className="oe-button" disabled={saving}>
          <Save aria-hidden="true" /> {saving ? "Enregistrement…" : "Enregistrer"}
        </button>
      </div>

      {picker && (
        <NodePicker
          open
          title="Lier une page"
          tree={derived.tree}
          filter={(n) => !n.virtual}
          onClose={() => setPicker(null)}
          onSelect={insertLink}
          hint="Le lien relatif est calculé automatiquement et réécrit si la page cible est déplacée."
        />
      )}
    </form>
  );
}
