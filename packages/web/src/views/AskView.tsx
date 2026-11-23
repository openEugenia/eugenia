/**
 * Questions about the tree (§8.5). The search covers the whole common hierarchy of the scope:
 * categories and knowledge, the sources filed in them (and the sections of their index), the
 * discussions placed in them. Eugenia goes down the tree from the descriptions (tree search),
 * starting from the elements closest in meaning to the question (exhaustive search, with search
 * by meaning set up), then answers from what she read only, citing it.
 */
import { useRef, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  BookOpen,
  FolderSearch,
  ListTree,
  Save,
  Send,
  Sparkles,
  Square,
} from "lucide-react";
import {
  discussionEntries,
  isCategory,
  newDiscussionDocument,
  newDiscussionPath,
  writeDiscussion,
} from "@openeugenia/core";
import { askTree, isAbortError, type TreeEntry } from "@openeugenia/ai";
import { Breadcrumb, InfoBox, Spinner } from "../components/common.tsx";
import { Markdown } from "../components/Markdown.tsx";
import { NodePicker } from "../components/NodePicker.tsx";
import { taskContext } from "../lib/ai.ts";
import { elementLink, portableLinks } from "../lib/discussions.ts";
import { useCanEdit, useDerived, useIsOwner, useReveal } from "../lib/hooks.ts";
import { branchInvolvesPrivate, hierarchyNavigator, semanticCandidates } from "../lib/retrieval.ts";
import { href, navigate } from "../lib/router.ts";
import { hasEmbeddings } from "../lib/settings.ts";
import { useSettings } from "../store/settings.ts";
import { errorMessage, toast } from "../store/ui.ts";
import { useWiki } from "../store/wiki.ts";

interface Step {
  kind: "found" | "explore" | "read";
  titles: string[];
}

/** Element the answer is based on. */
interface Consulted {
  id: string;
  title: string;
  type: string;
  path: string[];
  cited: boolean;
}

const now = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

const STEP_LABELS: Record<Step["kind"], string> = {
  found: "Found by meaning",
  explore: "Goes down into",
  read: "Reads",
};

export function AskView({ id }: { id?: string }) {
  const derived = useDerived();
  const owner = useIsOwner();
  const editable = useCanEdit();
  const settings = useSettings((s) => s.settings);
  const scope =
    derived.tree.nodes.get(id ?? derived.tree.rootId) ??
    derived.tree.nodes.get(derived.tree.rootId)!;
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [answer, setAnswer] = useState("");
  const [consulted, setConsulted] = useState<Consulted[]>([]);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [picker, setPicker] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const response = useReveal<HTMLElement>();

  const run = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const text = question.trim();
    if (!text || running || !useWiki.getState().workspace) return;
    setAsked(text);
    setSteps([]);
    setAnswer("");
    setConsulted([]);
    setDone(false);
    setRunning(true);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const involvesPrivate = owner && branchInvolvesPrivate(derived, scope.id);
      const context = await taskContext(involvesPrivate, controller.signal);
      const navigator = hierarchyNavigator(derived, owner);
      // Exhaustive search: without search by meaning, the tree search alone remains.
      const candidates = await semanticCandidates(derived, owner, text, scope.id, {
        limit: 10,
        signal: controller.signal,
      }).catch((error: unknown) => {
        if (isAbortError(error)) throw error;
        toast(`Search by meaning unavailable: ${errorMessage(error)}`, "error");
        return [];
      });
      const entries = new Map<string, TreeEntry>();
      const resolve = async (eid: string): Promise<TreeEntry | undefined> => {
        if (!entries.has(eid)) {
          const entry = await navigator.resolve(eid);
          if (entry) entries.set(eid, entry);
        }
        return entries.get(eid);
      };
      let answering = false;
      for await (const event of askTree(context, {
        question: text,
        scopeId: scope.id,
        navigator,
        candidates,
        autoRead: 3,
      })) {
        if (event.type === "found" || event.type === "explore" || event.type === "read") {
          const titles = await Promise.all(
            event.ids.map(async (eid) => (await resolve(eid))?.title ?? eid),
          );
          setSteps((s) => [...s, { kind: event.type, titles }]);
        } else if (event.type === "answer") {
          setAnswer((a) => a + event.text);
          if (!answering) response.reveal();
          answering = true;
        } else if (event.type === "done") {
          const cited = new Set(event.cited);
          const list = await Promise.all(
            event.consulted.map(async (eid): Promise<Consulted> => {
              const entry = await resolve(eid);
              return {
                id: eid,
                title: entry?.title ?? eid,
                type: entry?.type ?? "",
                path: entry?.path ?? [],
                cited: cited.has(eid),
              };
            }),
          );
          setConsulted(list.sort((a, b) => Number(b.cited) - Number(a.cited)));
          setDone(true);
        }
      }
    } catch (error) {
      if (!isAbortError(error)) toast(errorMessage(error), "error");
    } finally {
      setRunning(false);
      abort.current = null;
    }
  };

  const save = async (): Promise<void> => {
    const { workspace, stage, commit } = useWiki.getState();
    if (!workspace || !answer) return;
    const title = asked.length > 70 ? `${asked.slice(0, 67)}…` : asked;
    const path = newDiscussionPath(workspace.config, title, discussionEntries(workspace));
    const doc = newDiscussionDocument({ title, kind: "question", scopeNode: scope.id });
    doc.messages = [
      { role: "user", timestamp: now(), content: asked },
      {
        role: "eugenia",
        timestamp: now(),
        content: portableLinks(answer, path, derived.tree, derived.discussionById),
      },
    ];
    await stage([writeDiscussion(path, doc)], `Question — ${title}`);
    await commit(`Question — ${title}`, [path]);
    toast("Question saved in your discussions.", "success");
    navigate({ name: "discussion", path });
  };

  const cited = consulted.filter((c) => c.cited);

  return (
    <div className="page">
      <Breadcrumb tree={derived.tree} node={scope} />
      <h1>Questions about the wiki</h1>
      <p className="muted">
        Scope: <strong>{scope.title}</strong>{" "}
        <button
          type="button"
          className="oe-button oe-button--ghost oe-button--sm"
          onClick={() => setPicker(true)}
        >
          Change
        </button>
      </p>
      <p className="muted small">
        Eugenia searches the whole tree of this scope: knowledge, the sources filed in it (and the
        index of their content), the discussions. She answers from what she finds there only, and
        cites it.
        {owner && !hasEmbeddings(settings) && (
          <>
            {" "}
            Set up search by meaning in the <a href={href({ name: "settings" })}>settings</a> so
            that she also finds elements by their meaning.
          </>
        )}
      </p>
      {!owner && <InfoBox>Only the public part of this wiki is consulted.</InfoBox>}
      <form className="composer" style={{ position: "static" }} onSubmit={(e) => void run(e)}>
        <textarea
          className="oe-textarea"
          placeholder="What does my wiki say about…?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          aria-label="Your question"
        />
        <div className="actions">
          {running ? (
            <button
              type="button"
              className="oe-button oe-button--secondary"
              onClick={() => abort.current?.abort()}
            >
              <Square aria-hidden="true" /> Stop
            </button>
          ) : (
            <button type="submit" className="oe-button" disabled={!question.trim()}>
              <Send aria-hidden="true" /> Ask Eugenia
            </button>
          )}
        </div>
      </form>
      {(steps.length > 0 || running) && (
        <section className="section">
          <h2>Search</h2>
          <ul className="steps-log">
            <li>
              <BookOpen aria-hidden="true" /> Reading the descriptions of "{scope.title}"
            </li>
            {steps.map((s, i) => (
              <li key={i}>
                {s.kind === "found" ? (
                  <Sparkles aria-hidden="true" />
                ) : s.kind === "explore" ? (
                  <FolderSearch aria-hidden="true" />
                ) : (
                  <BookOpen aria-hidden="true" />
                )}
                {STEP_LABELS[s.kind]} {s.titles.map((t) => `"${t}"`).join(", ")}
              </li>
            ))}
            {running && !answer && (
              <li>
                <Spinner small /> Eugenia is searching…
              </li>
            )}
          </ul>
        </section>
      )}
      {answer && (
        <section ref={response.ref} className="section oe-card">
          <span className="oe-eyebrow" style={{ fontSize: "var(--oe-font-size-xs)" }}>
            Answer
          </span>
          <Markdown text={answer} path={scope.indexPath} />
          {done && cited.length === 0 && (
            <p className="small" style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
              <AlertTriangle aria-hidden="true" className="inline-icon" /> This answer cites no
              element of your wiki.
            </p>
          )}
          {done && consulted.length > 0 && (
            <div className="section">
              <h3 className="small">Based on</h3>
              <ul className="link-list">
                {consulted.map((c) => {
                  const link = elementLink(derived.tree, derived.discussionById, c.id);
                  return (
                    <li key={c.id}>
                      <ListTree aria-hidden="true" />
                      {link ? <a href={link.href}>{c.title}</a> : <span>{c.title}</span>}
                      <span className="muted small">
                        {[c.type, c.path.join(" › ")].filter(Boolean).join(" · ")}
                        {c.cited ? "" : " · read, not cited"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {done && editable && (
            <div className="actions">
              <button
                type="button"
                className="oe-button oe-button--secondary oe-button--sm"
                onClick={() => void save()}
              >
                <Save aria-hidden="true" /> Save as a discussion
              </button>
            </div>
          )}
        </section>
      )}
      {picker && (
        <NodePicker
          open
          title="Scope of the question"
          tree={derived.tree}
          filter={(n) => isCategory(n)}
          onClose={() => setPicker(false)}
          onSelect={(n) => {
            setPicker(false);
            navigate(href({ name: "ask", id: n.id }));
          }}
        />
      )}
    </div>
  );
}
