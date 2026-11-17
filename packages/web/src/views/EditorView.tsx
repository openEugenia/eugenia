/**
 * Éditeur d'une page (§9.2, vue 10) : Markdown pour les notes, trois champs pour une
 * connaissance atomique ; métadonnées sous forme de formulaire, jamais de frontmatter brut.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Bold, Eye, Heading2, Italic, Link2, Paperclip, Plus, Save, Trash2 } from "lucide-react";
import {
  createPage,
  dirname,
  joinPath,
  parseFlashcardBody,
  parsePage,
  relativePath,
  serializeFlashcardBody,
  updatePage,
  encodeLinkPath,
  type FileChange,
  type PageType,
  type SourceRef,
  type WikiNode,
} from "@openeugenia/core";
import { Breadcrumb, ErrorBox, InfoBox, Loading, VisibilityBadge } from "../components/common.tsx";
import { Markdown } from "../components/Markdown.tsx";
import {
  MarkdownEditor,
  type LinkCompletion,
  type MarkdownEditorHandle,
} from "../components/MarkdownEditor.tsx";
import { NodePicker } from "../components/NodePicker.tsx";
import { fileToBase64, safeFileName } from "../lib/files.ts";
import { useDerived, useText } from "../lib/hooks.ts";
import { href, navigate } from "../lib/router.ts";
import { normalizeTerm } from "../lib/text.ts";
import { errorMessage, toast } from "../store/ui.ts";
import { useWiki } from "../store/wiki.ts";

type EditorProps = { mode: "edit"; id: string } | { mode: "new"; parentId: string; type: PageType };

interface Upload {
  name: string;
  base64: string;
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
  const parent = props.mode === "new" ? derived.tree.nodes.get(props.parentId) : undefined;
  const content = useText(node && !node.virtual ? node.indexPath : undefined);

  const [loaded, setLoaded] = useState(props.mode === "new");
  const [title, setTitle] = useState("");
  const [type, setType] = useState<PageType>(props.mode === "new" ? props.type : "note");
  const [tags, setTags] = useState("");
  const [order, setOrder] = useState("");
  const [body, setBody] = useState("");
  const [knowledge, setKnowledge] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [extra, setExtra] = useState("");
  const [sources, setSources] = useState<SourceRef[]>([]);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [preview, setPreview] = useState(false);
  const [picker, setPicker] = useState<"body" | "knowledge" | null>(null);
  const [saving, setSaving] = useState(false);
  const bodyEditor = useRef<MarkdownEditorHandle>(null);
  const knowledgeEditor = useRef<MarkdownEditorHandle>(null);

  useEffect(() => {
    if (props.mode !== "edit" || loaded || !node) return;
    if (node.virtual) {
      setTitle(node.title);
      setLoaded(true);
      return;
    }
    if (content.data === undefined) return;
    const doc = parsePage(content.data);
    setTitle(doc.fields.title || node.title);
    setType(node.type);
    setTags((doc.fields.tags ?? []).join(", "));
    setOrder(doc.fields.order !== undefined ? String(doc.fields.order) : "");
    setSources(doc.fields.sources ?? []);
    if (node.type === "flashcard") {
      const card = parseFlashcardBody(doc.body);
      setKnowledge(card.knowledge);
      setQuestion(card.question);
      setAnswer(card.answer);
      setExtra([card.preamble, card.others].filter(Boolean).join("\n\n"));
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
        .filter((n) => n.id !== node?.id && normalizeTerm(n.title).includes(q))
        .slice(0, 12)
        .map((n) => ({
          label: n.title,
          detail: n.type === "flashcard" ? "connaissance" : "page",
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
    (picker === "knowledge" ? knowledgeEditor : bodyEditor).current?.insert(link);
    setPicker(null);
  };

  const addUpload = async (file: File, index?: number): Promise<void> => {
    const name = safeFileName(file.name);
    const base64 = await fileToBase64(file);
    setUploads((list) => [...list.filter((u) => u.name !== name), { name, base64 }]);
    if (index !== undefined)
      setSources((list) => list.map((s, i) => (i === index ? { ...s, file: name } : s)));
    else setSources((list) => [...list, { description: file.name, file: name }]);
  };

  const save = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!workspace) return;
    if (!title.trim()) {
      toast("Le titre est obligatoire.", "error");
      return;
    }
    if (type === "flashcard" && !knowledge.trim()) {
      toast("Une connaissance atomique doit avoir un énoncé.", "error");
      return;
    }
    setSaving(true);
    try {
      const tagList = tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const orderValue = order.trim() === "" ? null : Number(order);
      const cleanSources = sources
        .map(
          (s) =>
            Object.fromEntries(
              Object.entries(s).filter(([, v]) => typeof v === "string" && v.trim() !== ""),
            ) as SourceRef,
        )
        .filter((s) => s.description || s.url || s.file);
      const text =
        type === "flashcard"
          ? serializeFlashcardBody({
              knowledge,
              question,
              answer,
              ...(extra.trim() ? { others: extra } : {}),
            })
          : body;
      let targetId: string;
      let changes: FileChange[];
      let description: string;
      if (props.mode === "new" && parent) {
        const created = createPage(workspace, {
          parentPath: parent.path,
          parentIsPublic: parent.isPublic,
          title,
          type,
          body: text,
          tags: tagList,
          sources: cleanSources,
          ...(orderValue !== null && Number.isFinite(orderValue) ? { order: orderValue } : {}),
        });
        targetId = created.id;
        changes = [
          created.change,
          ...uploads.map((u) => ({
            op: "write-binary" as const,
            path: joinPath(created.path, u.name),
            base64: u.base64,
          })),
        ];
        description = `Créer « ${title.trim()} »`;
      } else {
        targetId = node!.id;
        if (title.trim() !== node!.title) await workspace.prefetchMarkdown();
        changes = await updatePage(workspace, node!.id, {
          title,
          type,
          body: text,
          tags: tagList,
          sources: cleanSources,
          order: orderValue !== null && Number.isFinite(orderValue) ? orderValue : null,
        });
        description =
          title.trim() !== node!.title
            ? `Renommer « ${node!.title} » en « ${title.trim()} »`
            : `Modifier « ${title.trim()} »`;
      }
      await stage(changes, description);
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
  const attachments = node ? node.attachments.map((f) => f.path.slice(node.path.length + 1)) : [];

  return (
    <form className="page" onSubmit={(e) => void save(e)}>
      <Breadcrumb tree={derived.tree} node={context} />
      <h1>
        {props.mode === "new"
          ? type === "flashcard"
            ? "Nouvelle connaissance"
            : "Nouvelle page"
          : `Modifier « ${node!.title} »`}
      </h1>
      {props.mode === "new" && (
        <p className="muted">
          Sous « {parent!.title} ». Une nouvelle page est privée par défaut ; vous pourrez la rendre
          publique ensuite.
        </p>
      )}

      <div className="form-grid section">
        <div className="oe-field">
          <label className="oe-label" htmlFor="title">
            Titre
          </label>
          <input
            id="title"
            className="oe-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            autoFocus={props.mode === "new"}
          />
          {props.mode === "edit" && title.trim() !== node!.title && (
            <span className="oe-help">
              Le dossier de la page sera renommé et les liens qui pointent vers elle seront
              réécrits.
            </span>
          )}
        </div>
        <div className="form-row">
          <div className="oe-field">
            <label className="oe-label" htmlFor="type">
              Type
            </label>
            <select
              id="type"
              className="oe-select"
              value={type}
              onChange={(e) => setType(e.target.value as PageType)}
            >
              <option value="note">Note</option>
              <option value="flashcard">Connaissance atomique</option>
            </select>
          </div>
          <div className="oe-field">
            <label className="oe-label" htmlFor="tags">
              Étiquettes
            </label>
            <input
              id="tags"
              className="oe-input"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="astronomie, lune"
            />
          </div>
          <div className="oe-field">
            <label className="oe-label" htmlFor="order">
              Ordre (facultatif)
            </label>
            <input
              id="order"
              className="oe-input"
              type="number"
              value={order}
              onChange={(e) => setOrder(e.target.value)}
            />
          </div>
        </div>
        {node && (
          <p className="small muted">
            Visibilité : <VisibilityBadge visibility={node.isPublic ? "public" : "private"} /> —
            modifiable depuis la page, selon les règles de publication.
          </p>
        )}
      </div>

      {type === "flashcard" ? (
        <div className="form-grid section">
          <div className="oe-field">
            <span className="oe-label">Connaissance</span>
            <span className="oe-help">
              Un énoncé autonome ; mettez en gras la cible d'apprentissage, sur laquelle vous serez
              interrogé.
            </span>
            <div>
              <Toolbar editor={knowledgeEditor} onLink={() => setPicker("knowledge")} />
              <MarkdownEditor
                ref={knowledgeEditor}
                value={knowledge}
                onChange={setKnowledge}
                small
                ariaLabel="Connaissance"
                linkCompletions={linkCompletions}
                placeholder="**Lilith** est un démon féminin de la tradition juive…"
              />
            </div>
            {knowledge && !/\*\*[^*]+\*\*/.test(knowledge) && (
              <InfoBox kind="warning">
                Aucune partie en gras : sélectionnez la cible d'apprentissage et cliquez sur « Gras
                ».
              </InfoBox>
            )}
          </div>
          <div className="oe-field">
            <label className="oe-label" htmlFor="question">
              Question
            </label>
            <textarea
              id="question"
              className="oe-textarea"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Quel est le nom du démon féminin… ?"
            />
          </div>
          <div className="oe-field">
            <label className="oe-label" htmlFor="answer">
              Réponse attendue
            </label>
            <textarea
              id="answer"
              className="oe-textarea"
              style={{ minHeight: "3rem" }}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Lilith"
            />
          </div>
          <details>
            <summary className="small">Notes complémentaires</summary>
            <MarkdownEditor
              value={extra}
              onChange={setExtra}
              small
              ariaLabel="Notes complémentaires"
              linkCompletions={linkCompletions}
            />
          </details>
        </div>
      ) : (
        <div className="section">
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
              ariaLabel="Contenu de la page"
              linkCompletions={linkCompletions}
              placeholder="Écrivez en Markdown. Tapez [[ pour lier une autre page."
            />
          )}
        </div>
      )}

      <section className="section">
        <div className="section__head">
          <h2>Sources</h2>
          <button
            type="button"
            className="oe-button oe-button--ghost oe-button--sm"
            onClick={() => setSources((s) => [...s, { description: "" }])}
          >
            <Plus aria-hidden="true" /> Ajouter une source
          </button>
        </div>
        <p className="muted small">
          La description et l'adresse suivent la visibilité de la page ; un fichier personnel joint
          n'est jamais publié.
        </p>
        <div className="form-grid">
          {sources.map((source, i) => (
            <div key={i} className="oe-card" style={{ padding: "0.75rem" }}>
              <div className="form-row">
                <input
                  className="oe-input"
                  placeholder="Description (ex. Wikipédia, article « Lilith »)"
                  value={source.description ?? ""}
                  onChange={(e) =>
                    setSources((list) =>
                      list.map((s, j) => (j === i ? { ...s, description: e.target.value } : s)),
                    )
                  }
                  aria-label="Description de la source"
                />
                <input
                  className="oe-input"
                  placeholder="https://…"
                  value={source.url ?? ""}
                  onChange={(e) =>
                    setSources((list) =>
                      list.map((s, j) => (j === i ? { ...s, url: e.target.value } : s)),
                    )
                  }
                  aria-label="Adresse de la source"
                />
              </div>
              <div className="actions actions--start" style={{ marginTop: "0.5rem" }}>
                {source.file ? (
                  <span className="small">
                    <Paperclip
                      aria-hidden="true"
                      style={{ display: "inline", verticalAlign: "-0.15em" }}
                    />{" "}
                    {source.file} (fichier personnel)
                  </span>
                ) : (
                  <>
                    {attachments.length > 0 && (
                      <select
                        className="oe-select"
                        style={{ width: "auto" }}
                        value=""
                        onChange={(e) =>
                          e.target.value &&
                          setSources((list) =>
                            list.map((s, j) => (j === i ? { ...s, file: e.target.value } : s)),
                          )
                        }
                        aria-label="Fichier joint existant"
                      >
                        <option value="">Fichier existant…</option>
                        {attachments.map((a) => (
                          <option key={a} value={a}>
                            {a}
                          </option>
                        ))}
                      </select>
                    )}
                    <label className="oe-button oe-button--ghost oe-button--sm">
                      <Paperclip aria-hidden="true" /> Joindre un fichier personnel
                      <input
                        type="file"
                        hidden
                        onChange={(e) =>
                          e.target.files?.[0] && void addUpload(e.target.files[0], i)
                        }
                      />
                    </label>
                  </>
                )}
                <button
                  type="button"
                  className="oe-button oe-button--ghost oe-button--sm"
                  onClick={() => setSources((list) => list.filter((_, j) => j !== i))}
                  aria-label="Retirer la source"
                >
                  <Trash2 aria-hidden="true" /> Retirer
                </button>
              </div>
            </div>
          ))}
        </div>
        <label
          className="oe-button oe-button--ghost oe-button--sm"
          style={{ marginTop: "0.75rem" }}
        >
          <Paperclip aria-hidden="true" /> Joindre un fichier à la page (image, PDF…)
          <input
            type="file"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              void fileToBase64(file).then((base64) => {
                const name = safeFileName(file.name);
                setUploads((list) => [...list.filter((u) => u.name !== name), { name, base64 }]);
                if (type !== "flashcard" && /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(name))
                  bodyEditor.current?.insert(`\n![${file.name}](${encodeLinkPath(name)})\n`);
              });
            }}
          />
        </label>
        {uploads.length > 0 && (
          <p className="small muted">À joindre : {uploads.map((u) => u.name).join(", ")}</p>
        )}
      </section>

      <div className="actions section">
        <a
          className="oe-button oe-button--ghost"
          href={href(node ? { name: "node", id: node.id } : { name: "node", id: parent!.id })}
        >
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
          onClose={() => setPicker(null)}
          onSelect={insertLink}
          hint="Le lien relatif est calculé automatiquement et réécrit si la page cible est déplacée."
        />
      )}
    </form>
  );
}
