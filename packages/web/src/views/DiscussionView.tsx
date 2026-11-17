/**
 * Discussion personnelle avec Eugenia à partir d'une page (§8.4) : réponse en continu,
 * résumé de l'échange, extraction de connaissances, enregistrement dans `_discussions/`.
 */
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, FileText, Highlighter, Send, Square } from "lucide-react";
import {
  newDiscussionDocument,
  newDiscussionPath,
  parseDiscussion,
  parsePage,
  reservedEntries,
  writeDiscussion,
  type DiscussionDocument,
} from "@openeugenia/core";
import { isAbortError, streamDiscussion, summarizeDiscussion } from "@openeugenia/ai";
import { Breadcrumb, ErrorBox, InfoBox, Loading, Spinner } from "../components/common.tsx";
import { Markdown } from "../components/Markdown.tsx";
import { taskContext } from "../lib/ai.ts";
import { pathTitles, portableLinks, relatedPages } from "../lib/discussions.ts";
import { formatDateTime } from "../lib/format.ts";
import { useCanEdit, useDerived, useText } from "../lib/hooks.ts";
import { href, navigate } from "../lib/router.ts";
import { errorMessage, toast } from "../store/ui.ts";
import { useWiki } from "../store/wiki.ts";

const now = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

export function DiscussionView({ id, path }: { id: string; path?: string }) {
  const derived = useDerived();
  const editable = useCanEdit();
  const node = derived.tree.nodes.get(id);
  const existing = useText(path);
  const page = useText(node && !node.virtual ? node.indexPath : undefined);
  const [doc, setDoc] = useState<DiscussionDocument | null>(null);
  const [filePath, setFilePath] = useState<string | undefined>(path);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const dirty = useRef(false);
  const live = useRef<{ filePath: string | undefined; title: string }>({ filePath, title: "" });
  live.current = { filePath, title: doc?.fields.title ?? "" };

  useEffect(() => {
    if (path && existing.data !== undefined && !doc) setDoc(parseDiscussion(existing.data));
  }, [path, existing.data, doc]);

  // En quittant la discussion, l'échange est commité.
  useEffect(
    () => () => {
      abort.current?.abort();
      const { filePath: p, title } = live.current;
      if (p && dirty.current) void useWiki.getState().commit(`Discussion — ${title}`, [p]);
    },
    [],
  );

  if (!node)
    return (
      <div className="page">
        <ErrorBox title="Page introuvable">Cette page n'existe pas.</ErrorBox>
      </div>
    );
  if (!editable)
    return (
      <div className="page">
        <InfoBox>
          Les discussions sont enregistrées dans votre dépôt privé : ouvrez votre wiki avec un
          jeton.
        </InfoBox>
      </div>
    );
  if (path && existing.loading) return <Loading message="Chargement de la discussion…" />;

  // Une discussion est personnelle et privée : son contenu compte toujours comme privé.
  const involvesPrivate = true;

  const persist = async (next: DiscussionDocument, target: string): Promise<void> => {
    const tree = useWiki.getState().derived?.tree ?? derived.tree;
    const stored: DiscussionDocument = {
      ...next,
      messages: next.messages.map((m) => ({
        ...m,
        content: portableLinks(m.content, target, tree),
      })),
    };
    await useWiki
      .getState()
      .stage([writeDiscussion(target, stored)], `Discussion — ${next.fields.title}`);
    dirty.current = true;
  };

  const send = async (): Promise<void> => {
    const text = input.trim();
    if (!text || busy) return;
    const workspace = useWiki.getState().workspace;
    if (!workspace) return;
    let current = doc;
    let target = filePath;
    if (!current || !target) {
      const title = text.length > 70 ? `${text.slice(0, 67)}…` : text;
      current = newDiscussionDocument({ title, about: node.id });
      target = newDiscussionPath(
        node.path,
        title,
        reservedEntries(workspace, `${node.path}/_discussions`),
      );
      setFilePath(target);
      navigate({ name: "discussion", id: node.id, path: target }, { replace: true });
    }
    const withQuestion: DiscussionDocument = {
      ...current,
      fields: { ...current.fields, updated: now() },
      messages: [...current.messages, { role: "user", timestamp: now(), content: text }],
    };
    setDoc(withQuestion);
    setInput("");
    setBusy(true);
    await persist(withQuestion, target);
    const controller = new AbortController();
    abort.current = controller;
    let reply = "";
    try {
      const context = await taskContext(involvesPrivate, controller.signal);
      const body = page.data ? parsePage(page.data).body : "";
      setStreaming("");
      for await (const chunk of streamDiscussion(context, {
        page: {
          id: node.id,
          title: node.title,
          type: node.type,
          path: pathTitles(derived.tree, node),
          content: body,
        },
        related: relatedPages(derived.tree, node, text),
        history: withQuestion.messages.map((m) => ({ role: m.role, content: m.content })),
      })) {
        reply += chunk;
        setStreaming(reply);
      }
    } catch (error) {
      if (!isAbortError(error)) toast(errorMessage(error), "error");
    } finally {
      setStreaming(null);
      setBusy(false);
      abort.current = null;
    }
    if (reply.trim()) {
      const withReply: DiscussionDocument = {
        ...withQuestion,
        fields: { ...withQuestion.fields, updated: now() },
        messages: [
          ...withQuestion.messages,
          { role: "eugenia", timestamp: now(), content: reply.trim() },
        ],
      };
      setDoc(withReply);
      await persist(withReply, target);
    }
  };

  const summarize = async (): Promise<void> => {
    if (!doc || !filePath) return;
    setBusy(true);
    try {
      const context = await taskContext(involvesPrivate);
      const summary = await summarizeDiscussion(context, {
        title: doc.fields.title,
        messages: doc.messages,
      });
      const next: DiscussionDocument = {
        ...doc,
        messages: [
          ...doc.messages,
          { role: "eugenia", timestamp: now(), content: summary, meta: { role: "summary" } },
        ],
      };
      setDoc(next);
      await persist(next, filePath);
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const finish = async (): Promise<void> => {
    if (filePath && dirty.current) {
      await useWiki
        .getState()
        .commit(`Discussion — ${doc?.fields.title ?? node.title}`, [filePath]);
      dirty.current = false;
    }
    navigate({ name: "node", id: node.id });
  };

  return (
    <div className="page">
      <Breadcrumb tree={derived.tree} node={node} />
      <h1>{doc?.fields.title ?? `Discussion sur « ${node.title} »`}</h1>
      <p className="muted small">
        Discussion personnelle (privée) avec Eugenia, à partir de{" "}
        <a href={href({ name: "node", id: node.id })}>{node.title}</a>
        {doc?.fields.created ? ` · commencée le ${formatDateTime(doc.fields.created)}` : ""}.
      </p>
      <div className="conversation section">
        {(doc?.messages ?? []).length === 0 && !streaming && (
          <InfoBox>
            Posez une question sur cette page : Eugenia peut clarifier une notion, suggérer des
            liens vers vos autres pages, résumer l'échange et proposer d'en extraire des
            connaissances.
          </InfoBox>
        )}
        {doc?.messages.map((m, i) => (
          <div key={i} className={`message message--${m.role}`}>
            <span className="message__who">
              {m.role === "eugenia"
                ? m.meta?.role === "summary"
                  ? "Eugenia · résumé"
                  : "Eugenia"
                : "Vous"}{" "}
              · {formatDateTime(m.timestamp)}
            </span>
            <div className="message__bubble">
              <Markdown text={m.content} path={filePath ?? node.indexPath} />
            </div>
          </div>
        ))}
        {streaming !== null && (
          <div className="message message--eugenia">
            <span className="message__who">
              Eugenia <Spinner small label="Eugenia répond" />
            </span>
            <div className="message__bubble">
              <Markdown text={streaming || "…"} path={filePath ?? node.indexPath} />
            </div>
          </div>
        )}
      </div>
      <div className="composer">
        <textarea
          className="oe-textarea"
          placeholder="Votre message… (Ctrl+Entrée pour envoyer)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
          }}
          aria-label="Votre message"
        />
        <div className="actions" style={{ justifyContent: "space-between" }}>
          <div className="actions actions--start">
            <button
              type="button"
              className="oe-button oe-button--ghost oe-button--sm"
              disabled={busy || !doc || doc.messages.length < 2}
              onClick={() => void summarize()}
            >
              <FileText aria-hidden="true" /> Résumer l'échange
            </button>
            <button
              type="button"
              className="oe-button oe-button--ghost oe-button--sm"
              disabled={busy || !filePath || !doc || doc.messages.length < 2}
              onClick={() =>
                filePath && navigate({ name: "extract", id: node.id, discussion: filePath })
              }
            >
              <Highlighter aria-hidden="true" /> Extraire des connaissances
            </button>
            <button
              type="button"
              className="oe-button oe-button--ghost oe-button--sm"
              disabled={busy}
              onClick={() => void finish()}
            >
              <CheckCircle2 aria-hidden="true" /> Terminer
            </button>
          </div>
          {busy && streaming !== null ? (
            <button
              type="button"
              className="oe-button oe-button--secondary"
              onClick={() => abort.current?.abort()}
            >
              <Square aria-hidden="true" /> Arrêter
            </button>
          ) : (
            <button
              type="button"
              className="oe-button"
              disabled={busy || !input.trim()}
              onClick={() => void send()}
            >
              <Send aria-hidden="true" /> Envoyer
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
