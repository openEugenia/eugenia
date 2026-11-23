/**
 * Personal discussion with Eugenia (§8.4): free discussion (from a page or not), quick note
 * (Eugenia immediately answers with candidate knowledge and source leads), saved question or
 * quiz (read-only). Streamed answer, summary of the exchange, knowledge extraction, saving in the
 * discussions folder.
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

  // When leaving the discussion, the exchange is committed.
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
        <ErrorBox title="Page not found">This page does not exist.</ErrorBox>
      </div>
    );
  if (path && existing.loading) return <Loading message="Loading the discussion…" />;
  if (path && existing.error)
    return (
      <div className="page">
        <ErrorBox title="Discussion not found">{existing.error}</ErrorBox>
      </div>
    );
  if (!editable && !path)
    return (
      <div className="page">
        <InfoBox>
          Discussions are saved in your private repository: open your wiki with a token.
        </InfoBox>
      </div>
    );
  // A quiz is a review trace: it can be read again, not continued.
  const readOnly = !editable || kind === "quiz";

  // A discussion is personal and private: its content always counts as private.
  const involvesPrivate = true;
  // Eugenia's last answer: the one being streamed, otherwise the last saved one.
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
      ? "New quick note"
      : node
        ? `Discussion about "${node.title}"`
        : "New discussion");
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
        {kind === "quiz" ? "Review trace" : "Personal (private) exchange with Eugenia"}
        {node ? (
          <>
            {kind === "quiz" || kind === "question" ? ", about " : ", started from "}
            <a href={href({ name: "node", id: node.id })}>{node.title}</a>
          </>
        ) : null}
        {doc?.fields.created ? ` · started on ${formatDateTime(doc.fields.created)}` : ""}.
      </p>
      <div className="conversation section">
        {(doc?.messages ?? []).length === 0 && !streaming && (
          <InfoBox>
            {kind === "note"
              ? "Write down an idea, a fact you heard, something you are reading: Eugenia right away spots the atomic knowledge worth keeping, points out what deserves checking and suggests sources to back it."
              : node
                ? "Ask a question about this page: Eugenia can clarify a notion, suggest links to your other pages, summarize the exchange and offer to extract knowledge from it."
                : "Talk freely with Eugenia: she can clarify a notion, suggest links to your pages, summarize the exchange and offer to extract knowledge from it."}
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
                  ? "Eugenia · summary"
                  : "Eugenia"
                : "You"}{" "}
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
              Eugenia <Spinner small label="Eugenia is answering" />
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
              <GraduationCap aria-hidden="true" /> Start another quiz on "{node.title}"
            </a>
          )}
          <a className="oe-button oe-button--ghost" href={href({ name: "discussions" })}>
            All discussions
          </a>
        </div>
      ) : (
        <div className="composer">
          <textarea
            className="oe-textarea"
            placeholder={
              kind === "note" && !doc
                ? "Your note… (Ctrl+Enter to send it to Eugenia)"
                : "Your message… (Ctrl+Enter to send)"
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send();
            }}
            aria-label="Your message"
          />
          <div className="actions" style={{ justifyContent: "space-between" }}>
            <div className="actions actions--start">
              <button
                type="button"
                className="oe-button oe-button--ghost oe-button--sm"
                disabled={busy || !doc || doc.messages.length < 2}
                onClick={() => void summarize()}
              >
                <FileText aria-hidden="true" /> Summarize the exchange
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
                <Highlighter aria-hidden="true" /> Extract knowledge
              </button>
              <button
                type="button"
                className="oe-button oe-button--ghost oe-button--sm"
                disabled={busy}
                onClick={() => void finish()}
              >
                <CheckCircle2 aria-hidden="true" /> Finish
              </button>
            </div>
            {busy && streaming !== null ? (
              <button
                type="button"
                className="oe-button oe-button--secondary"
                onClick={() => abort.current?.abort()}
              >
                <Square aria-hidden="true" /> Stop
              </button>
            ) : (
              <button
                type="button"
                className="oe-button"
                disabled={busy || !input.trim()}
                onClick={() => void send()}
              >
                <Send aria-hidden="true" /> Send
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
