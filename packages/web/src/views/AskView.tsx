/**
 * Questions sur l'arbre (§8.5) : Eugenia lit les descriptions du premier niveau, descend
 * dans les branches pertinentes jusqu'aux contenus, puis répond en citant les pages.
 */
import { useRef, useState, type FormEvent } from "react";
import { BookOpen, FolderSearch, Save, Send, Square } from "lucide-react";
import {
  descendants,
  newDiscussionDocument,
  newDiscussionPath,
  reservedEntries,
  writeDiscussion,
} from "@openeugenia/core";
import { askTree, isAbortError, treeNavigator } from "@openeugenia/ai";
import { Breadcrumb, InfoBox, Spinner } from "../components/common.tsx";
import { Markdown } from "../components/Markdown.tsx";
import { NodePicker } from "../components/NodePicker.tsx";
import { taskContext } from "../lib/ai.ts";
import { portableLinks } from "../lib/discussions.ts";
import { useCanEdit, useDerived, useIsOwner, useReveal } from "../lib/hooks.ts";
import { href, navigate } from "../lib/router.ts";
import { errorMessage, toast } from "../store/ui.ts";
import { useWiki } from "../store/wiki.ts";

interface Step {
  kind: "explore" | "read";
  titles: string[];
}

const now = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

export function AskView({ id }: { id?: string }) {
  const derived = useDerived();
  const owner = useIsOwner();
  const editable = useCanEdit();
  const scope =
    derived.tree.nodes.get(id ?? derived.tree.rootId) ??
    derived.tree.nodes.get(derived.tree.rootId)!;
  const [question, setQuestion] = useState("");
  const [asked, setAsked] = useState("");
  const [steps, setSteps] = useState<Step[]>([]);
  const [answer, setAnswer] = useState("");
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [picker, setPicker] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const response = useReveal<HTMLElement>();

  const run = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const text = question.trim();
    const workspace = useWiki.getState().workspace;
    if (!text || running || !workspace) return;
    setAsked(text);
    setSteps([]);
    setAnswer("");
    setDone(false);
    setRunning(true);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const involvesPrivate =
        owner && (!scope.isPublic || descendants(derived.tree, scope.id).some((d) => !d.isPublic));
      const context = await taskContext(involvesPrivate, controller.signal);
      const navigator = treeNavigator(workspace, owner ? "private" : "public", derived.summaries);
      const title = (nid: string): string => derived.tree.nodes.get(nid)?.title ?? nid;
      let answering = false;
      for await (const event of askTree(context, {
        question: text,
        scopeId: scope.id,
        navigator,
      })) {
        if (event.type === "explore" || event.type === "read")
          setSteps((s) => [...s, { kind: event.type, titles: event.ids.map(title) }]);
        else if (event.type === "answer") {
          setAnswer((a) => a + event.text);
          if (!answering) response.reveal();
          answering = true;
        } else if (event.type === "done") setDone(true);
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
    const path = newDiscussionPath(
      scope.path,
      title,
      reservedEntries(workspace, `${scope.path}/_discussions`),
    );
    const doc = newDiscussionDocument({ title, about: scope.id });
    doc.messages = [
      { role: "user", timestamp: now(), content: asked },
      { role: "eugenia", timestamp: now(), content: portableLinks(answer, path, derived.tree) },
    ];
    await stage([writeDiscussion(path, doc)], `Question — ${title}`);
    await commit(`Question — ${title}`, [path]);
    toast("Échange enregistré comme discussion.", "success");
    navigate({ name: "discussion", id: scope.id, path });
  };

  return (
    <div className="page">
      <Breadcrumb tree={derived.tree} node={scope} />
      <h1>Questions sur le wiki</h1>
      <p className="muted">
        Périmètre : <strong>{scope.title}</strong>{" "}
        <button
          type="button"
          className="oe-button oe-button--ghost oe-button--sm"
          onClick={() => setPicker(true)}
        >
          Changer
        </button>
      </p>
      {!owner && <InfoBox>Seule la partie publique de ce wiki est consultée.</InfoBox>}
      <form className="composer" style={{ position: "static" }} onSubmit={(e) => void run(e)}>
        <textarea
          className="oe-textarea"
          placeholder="Que dit mon wiki sur… ?"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          aria-label="Votre question"
        />
        <div className="actions">
          {running ? (
            <button
              type="button"
              className="oe-button oe-button--secondary"
              onClick={() => abort.current?.abort()}
            >
              <Square aria-hidden="true" /> Arrêter
            </button>
          ) : (
            <button type="submit" className="oe-button" disabled={!question.trim()}>
              <Send aria-hidden="true" /> Demander à Eugenia
            </button>
          )}
        </div>
      </form>
      {(steps.length > 0 || running) && (
        <section className="section">
          <h2>Exploration</h2>
          <ul className="steps-log">
            <li>
              <BookOpen aria-hidden="true" /> Lecture des descriptions de « {scope.title} »
            </li>
            {steps.map((s, i) => (
              <li key={i}>
                {s.kind === "explore" ? (
                  <FolderSearch aria-hidden="true" />
                ) : (
                  <BookOpen aria-hidden="true" />
                )}
                {s.kind === "explore" ? "Descend dans" : "Lit"}{" "}
                {s.titles.map((t) => `« ${t} »`).join(", ")}
              </li>
            ))}
            {running && !answer && (
              <li>
                <Spinner small /> Eugenia réfléchit…
              </li>
            )}
          </ul>
        </section>
      )}
      {answer && (
        <section ref={response.ref} className="section oe-card">
          <span className="oe-eyebrow" style={{ fontSize: "var(--oe-font-size-xs)" }}>
            Réponse
          </span>
          <Markdown text={answer} path={scope.indexPath} />
          {done && editable && (
            <div className="actions">
              <button
                type="button"
                className="oe-button oe-button--secondary oe-button--sm"
                onClick={() => void save()}
              >
                <Save aria-hidden="true" /> Enregistrer comme discussion
              </button>
            </div>
          )}
        </section>
      )}
      {picker && (
        <NodePicker
          open
          title="Périmètre de la question"
          tree={derived.tree}
          filter={(n) => n.childIds.length > 0 || n.id === derived.tree.rootId}
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
