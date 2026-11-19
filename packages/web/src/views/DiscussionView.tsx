/**
 * Discussion personnelle avec Eugenia (§8.4) : discussion libre (à partir d'une page ou non),
 * note rapide (Eugenia répond aussitôt par des connaissances candidates et des pistes de
 * sources), question enregistrée ou quiz (en lecture). Réponse en continu, résumé de
 * l'échange, extraction de connaissances, enregistrement dans le dossier des discussions.
 */
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, FileText, GraduationCap, Highlighter, Send, Square } from "lucide-react";
import {
  discussionEntries,
  librarySources,
  newDiscussionDocument,
  newDiscussionPath,
  parseDiscussion,
  parsePage,
  writeDiscussion,
  type DiscussionDocument,
  type DiscussionKind,
} from "@openeugenia/core";
import { isAbortError, streamDiscussion, summarizeDiscussion } from "@openeugenia/ai";
import {
  Breadcrumb,
  DiscussionKindIcon,
  DISCUSSION_KIND_LABELS,
  ErrorBox,
  InfoBox,
  Loading,
  Spinner,
} from "../components/common.tsx";
import { Markdown } from "../components/Markdown.tsx";
import { taskContext } from "../lib/ai.ts";
import {
  adoptDiscussionPath,
  pathTitles,
  portableLinks,
  relatedPages,
} from "../lib/discussions.ts";
import { formatDateTime } from "../lib/format.ts";
import { useCanEdit, useDerived, useReveal, useText } from "../lib/hooks.ts";
import { href, navigate } from "../lib/router.ts";
import { errorMessage, toast } from "../store/ui.ts";
import { useWiki } from "../store/wiki.ts";

const now = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

export function DiscussionView({
  path,
  about,
  kind: newKind,
}: {
  path?: string;
  about?: string;
  kind?: "note";
}) {
  const derived = useDerived();
  const editable = useCanEdit();
  const existing = useText(path);
  const [doc, setDoc] = useState<DiscussionDocument | null>(null);
  const kind: DiscussionKind =
    doc?.fields.kind ?? (path ? "discussion" : (newKind ?? "discussion"));
  const aboutId = doc ? (doc.fields.about ?? doc.fields.scope_node) : about;
  const node = aboutId ? derived.tree.nodes.get(aboutId) : undefined;
  const page = useText(node && !node.virtual ? node.indexPath : undefined);
  const [filePath, setFilePath] = useState<string | undefined>(path);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const dirty = useRef(false);
  const latest = useReveal<HTMLDivElement>();
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

  if (about && !node && !path)
    return (
      <div className="page">
        <ErrorBox title="Page introuvable">Cette page n'existe pas.</ErrorBox>
      </div>
    );
  if (path && existing.loading) return <Loading message="Chargement de la discussion…" />;
  if (path && existing.error)
    return (
      <div className="page">
        <ErrorBox title="Discussion introuvable">{existing.error}</ErrorBox>
      </div>
    );
  if (!editable && !path)
    return (
      <div className="page">
        <InfoBox>
          Les discussions sont enregistrées dans votre dépôt privé : ouvrez votre wiki avec un
          jeton.
        </InfoBox>
      </div>
    );
  // Un quiz est une trace de révision : il se relit, il ne se prolonge pas.
  const readOnly = !editable || kind === "quiz";

  // Une discussion est personnelle et privée : son contenu compte toujours comme privé.
  const involvesPrivate = true;
  // Dernière réponse d'Eugenia : celle en cours de diffusion, sinon la dernière enregistrée.
  const lastReply =
    streaming === null ? (doc?.messages.findLastIndex((m) => m.role === "eugenia") ?? -1) : -1;

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
      const firstLine =
        text
          .split("\n")[0]!
          .replace(/[#*_>`]/g, "")
          .trim() || text;
      const title = firstLine.length > 70 ? `${firstLine.slice(0, 67)}…` : firstLine;
      current = newDiscussionDocument({
        title,
        kind,
        ...(node ? { about: node.id } : {}),
      });
      target = newDiscussionPath(workspace.config, title, discussionEntries(workspace));
      setFilePath(target);
      adoptDiscussionPath(target, {
        ...(about ? { about } : {}),
        ...(newKind ? { kind: newKind } : {}),
      });
      navigate({ name: "discussion", path: target }, { replace: true });
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
      latest.reveal();
      const sources = librarySources(derived.tree)
        .slice(0, 60)
        .map((n) =>
          n.description
            ? { id: n.id, title: n.title, description: n.description }
            : { id: n.id, title: n.title },
        );
      for await (const chunk of streamDiscussion(context, {
        kind,
        ...(node
          ? {
              page: {
                id: node.id,
                title: node.title,
                type: node.type,
                path: pathTitles(derived.tree, node),
                content: body,
              },
            }
          : {}),
        related: relatedPages(derived.tree, node, text),
        sources,
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
      latest.reveal();
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
        .commit(`Discussion — ${doc?.fields.title ?? node?.title ?? "note"}`, [filePath]);
      dirty.current = false;
    }
    navigate(node ? { name: "node", id: node.id } : { name: "discussions" });
  };

  const heading =
    doc?.fields.title ??
    (kind === "note"
      ? "Nouvelle note rapide"
      : node
        ? `Discussion sur « ${node.title} »`
        : "Nouvelle discussion");
  const reference = filePath ?? node?.indexPath ?? `${derived.config.discussions}/index.md`;

  return (
    <div className="page">
      <Breadcrumb
        tree={derived.tree}
        trail={[
          { label: "Discussions", href: href({ name: "discussions" }) },
          ...(node ? [{ label: node.title, href: href({ name: "node", id: node.id }) }] : []),
        ]}
      />
      <h1>{heading}</h1>
      <p className="muted small discussion-meta">
        <span className="oe-badge">
          <DiscussionKindIcon kind={kind} /> {DISCUSSION_KIND_LABELS[kind]}
        </span>{" "}
        {kind === "quiz" ? "Trace de révision" : "Échange personnel (privé) avec Eugenia"}
        {node ? (
          <>
            {kind === "quiz" || kind === "question" ? ", sur " : ", à partir de "}
            <a href={href({ name: "node", id: node.id })}>{node.title}</a>
          </>
        ) : null}
        {doc?.fields.created ? ` · commencé le ${formatDateTime(doc.fields.created)}` : ""}.
      </p>
      <div className="conversation section">
        {(doc?.messages ?? []).length === 0 && !streaming && (
          <InfoBox>
            {kind === "note"
              ? "Notez une idée, un fait entendu, une lecture en cours : Eugenia y repère aussitôt les connaissances atomiques à retenir, signale ce qui mérite d'être vérifié et vous suggère des sources pour les appuyer."
              : node
                ? "Posez une question sur cette page : Eugenia peut clarifier une notion, suggérer des liens vers vos autres pages, résumer l'échange et proposer d'en extraire des connaissances."
                : "Discutez librement avec Eugenia : elle peut clarifier une notion, suggérer des liens vers vos pages, résumer l'échange et proposer d'en extraire des connaissances."}
          </InfoBox>
        )}
        {doc?.messages.map((m, i) => (
          <div
            key={i}
            ref={i === lastReply ? latest.ref : undefined}
            className={`message message--${m.role}`}
          >
            <span className="message__who">
              {m.role === "eugenia"
                ? m.meta?.role === "summary"
                  ? "Eugenia · résumé"
                  : "Eugenia"
                : "Vous"}{" "}
              · {formatDateTime(m.timestamp)}
            </span>
            <div className="message__bubble">
              <Markdown text={m.content} path={reference} />
            </div>
          </div>
        ))}
        {streaming !== null && (
          <div ref={latest.ref} className="message message--eugenia">
            <span className="message__who">
              Eugenia <Spinner small label="Eugenia répond" />
            </span>
            <div className="message__bubble">
              <Markdown text={streaming || "…"} path={reference} />
            </div>
          </div>
        )}
      </div>
      {readOnly ? (
        <div className="actions actions--start">
          {kind === "quiz" && node && (
            <a className="oe-button" href={href({ name: "quiz", id: node.id })}>
              <GraduationCap aria-hidden="true" /> Relancer un quiz sur « {node.title} »
            </a>
          )}
          <a className="oe-button oe-button--ghost" href={href({ name: "discussions" })}>
            Toutes les discussions
          </a>
        </div>
      ) : (
        <div className="composer">
          <textarea
            className="oe-textarea"
            placeholder={
              kind === "note" && !doc
                ? "Votre note… (Ctrl+Entrée pour l'envoyer à Eugenia)"
                : "Votre message… (Ctrl+Entrée pour envoyer)"
            }
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
                disabled={
                  busy || !filePath || !doc || doc.messages.length < (kind === "note" ? 1 : 2)
                }
                onClick={() =>
                  filePath &&
                  navigate({
                    name: "extract",
                    ...(node && node.type === "source" ? { id: node.id } : {}),
                    discussion: filePath,
                  })
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
      )}
    </div>
  );
}
