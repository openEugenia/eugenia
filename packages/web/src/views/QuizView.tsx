/**
 * Quiz conversationnel (§8.3) : questions par maîtrise croissante, évaluation par
 * Eugenia (ou auto-évaluation hors ligne), maîtrise mise à jour aussitôt, quiz commité
 * en une fois à la fin de la session.
 */
import { useEffect, useRef, useState } from "react";
import {
  Brain,
  Check,
  CircleStop,
  ExternalLink,
  Eye,
  Pencil,
  RotateCcw,
  Send,
  Sparkles,
} from "lucide-react";
import {
  applyEvaluation,
  currentMastery,
  dayNumber,
  discussionEntries,
  knowledgeOf,
  learningTargets,
  newDiscussionDocument,
  newDiscussionPath,
  parseFlashcardBody,
  parseKnowledgeBody,
  parsePage,
  quizOrder,
  writeDiscussion,
  type CardState,
  type DiscussionDocument,
  type DiscussionMessage,
  type WikiNode,
} from "@openeugenia/core";
import { evaluateAnswer, type Evaluation } from "@openeugenia/ai";
import { MasteryMeter } from "../components/charts.tsx";
import { Breadcrumb, EmptyState, ErrorBox, InfoBox, Spinner } from "../components/common.tsx";
import { Markdown } from "../components/Markdown.tsx";
import { taskContext } from "../lib/ai.ts";
import { formatPercent, plural } from "../lib/format.ts";
import { useCanEdit, useDerived, useReveal } from "../lib/hooks.ts";
import { href } from "../lib/router.ts";
import { hasAI } from "../lib/settings.ts";
import { useSettings } from "../store/settings.ts";
import { errorMessage, toast } from "../store/ui.ts";
import { useWiki } from "../store/wiki.ts";

interface CardContent {
  knowledge: string;
  question: string;
  answer: string;
}

interface Result {
  card: WikiNode;
  score: number;
  before: number;
  after: number;
}

const now = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

/** Question et réponse de la flashcard, énoncé de la connaissance qu'elle teste (sa page parente). */
async function loadCard(card: WikiNode): Promise<CardContent> {
  const workspace = useWiki.getState().workspace!;
  const parsed = parseFlashcardBody(parsePage(await workspace.readText(card.indexPath)).body);
  let knowledge = parsed.knowledge ?? "";
  const parent = knowledgeOf(workspace.tree, card);
  if (!knowledge && parent && parent.id !== card.id && !parent.virtual) {
    knowledge = parseKnowledgeBody(
      parsePage(await workspace.readText(parent.indexPath)).body,
    ).statement;
  }
  const targets = learningTargets(knowledge);
  const question = parsed.question || `Complétez : ${knowledge.replace(/\*\*[^*]+\*\*/g, "____")}`;
  const answer = parsed.answer || targets.join(", ") || knowledge;
  return { knowledge, question, answer };
}

/**
 * Sous le retour d'Eugenia : la réponse officielle de la fiche et la connaissance complète,
 * pour voir ce qu'on aurait pu ajouter, avec de quoi ouvrir ou retoucher la fiche dans un
 * autre onglet sans interrompre le quiz.
 */
function CardReference({
  card,
  content,
  showAnswer,
}: {
  card: WikiNode;
  content: CardContent;
  showAnswer: boolean;
}) {
  const newTab = { target: "_blank", rel: "noopener", title: "S'ouvre dans un nouvel onglet" };
  return (
    <div className="message__reference">
      {showAnswer && (
        <div>
          <span className="message__reference-label">Réponse attendue</span>
          <Markdown text={content.answer} path={card.indexPath} />
        </div>
      )}
      {content.knowledge && content.knowledge !== content.answer && (
        <div>
          <span className="message__reference-label">Connaissance</span>
          <Markdown text={content.knowledge} path={card.indexPath} />
        </div>
      )}
      <div className="actions actions--start">
        <a
          className="oe-button oe-button--ghost oe-button--sm"
          href={href({ name: "node", id: card.id })}
          {...newTab}
        >
          <ExternalLink aria-hidden="true" /> Ouvrir la fiche
        </a>
        <a
          className="oe-button oe-button--ghost oe-button--sm"
          href={href({ name: "edit", id: card.id })}
          {...newTab}
        >
          <Pencil aria-hidden="true" /> Modifier la fiche
        </a>
      </div>
    </div>
  );
}

export function QuizView({ id }: { id: string }) {
  const derived = useDerived();
  const editable = useCanEdit();
  const settings = useSettings((s) => s.settings);
  const online = useWiki((s) => s.online);
  const node = derived.tree.nodes.get(id);
  const [phase, setPhase] = useState<"intro" | "running" | "finished">("intro");
  const [mode, setMode] = useState<"ai" | "self">(hasAI(settings) ? "ai" : "self");
  const [order, setOrder] = useState<WikiNode[]>([]);
  const [index, setIndex] = useState(0);
  const [content, setContent] = useState<CardContent | null>(null);
  // Contenu des fiches déjà posées, pour afficher la réponse officielle sous chaque retour.
  const [contents, setContents] = useState<Map<string, CardContent>>(new Map());
  const [answer, setAnswer] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [doc, setDoc] = useState<DiscussionDocument | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [states, setStates] = useState<Map<string, CardState>>(new Map());
  const [lastEvaluation, setLastEvaluation] = useState<Evaluation | null>(null);
  const latest = useReveal<HTMLDivElement>();
  const live = useRef({ path, answered: 0, phase, title: node?.title ?? "" });
  live.current = { path, answered: results.length, phase, title: node?.title ?? "" };

  // Quitter la page pendant un quiz : les réponses déjà données sont commitées.
  useEffect(
    () => () => {
      const { path: p, answered, phase: ph, title } = live.current;
      if (p && answered > 0 && ph === "running")
        void useWiki.getState().commit(`Quiz — ${title} (${answered} réponse(s), interrompu)`, [p]);
    },
    [],
  );

  if (!node)
    return (
      <div className="page">
        <ErrorBox title="Page introuvable">Cette catégorie n'existe pas.</ErrorBox>
      </div>
    );
  if (!editable)
    return (
      <div className="page">
        <InfoBox>
          Les quiz enregistrent vos révisions dans votre dépôt privé : ouvrez votre wiki avec un
          jeton pour réviser.
        </InfoBox>
      </div>
    );
  const today = dayNumber(Date.now());
  const threshold = derived.config.mastery.reminder_threshold;
  const cards = quizOrder(derived.tree, node.id, derived.mastery, today);

  const save = async (next: DiscussionDocument, quizPath: string): Promise<void> => {
    await useWiki.getState().stage([writeDiscussion(quizPath, next)], `Quiz — ${node.title}`);
  };

  const ask = async (i: number, list: WikiNode[], current: DiscussionDocument): Promise<void> => {
    const card = list[i];
    if (!card) return;
    setBusy(true);
    setRevealed(false);
    setAnswer("");
    setLastEvaluation(null);
    try {
      const c = await loadCard(card);
      setContent(c);
      setContents((m) => new Map(m).set(card.id, c));
      setIndex(i);
      setDoc({
        ...current,
        messages: [
          ...current.messages,
          {
            role: "eugenia",
            timestamp: now(),
            content: c.question,
            meta: { card: card.id, role: "question" },
          },
        ],
      });
      latest.reveal();
    } catch (error) {
      toast(errorMessage(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const start = async (): Promise<void> => {
    const workspace = useWiki.getState().workspace;
    if (!workspace || cards.length === 0) return;
    const title = `Quiz — ${node.title}`;
    const quizPath = newDiscussionPath(workspace.config, title, discussionEntries(workspace));
    const fresh = newDiscussionDocument({
      title,
      kind: "quiz",
      scopeNode: node.id,
    });
    setOrder(cards);
    setPath(quizPath);
    setResults([]);
    setStates(new Map(derived.mastery));
    setPhase("running");
    await ask(0, cards, fresh);
  };

  const record = async (score: number, feedback: string, self: boolean): Promise<void> => {
    const card = order[index];
    if (!card || !doc || !path) return;
    const state = states.get(card.id);
    const before = state ? currentMastery(state, today) : derived.config.mastery.initial;
    const nextState = state
      ? applyEvaluation(state, score, today, derived.config.mastery)
      : undefined;
    const after = nextState ? currentMastery(nextState, today) : before;
    if (nextState) setStates((m) => new Map(m).set(card.id, nextState));
    const userText = answer.trim();
    const messages: DiscussionMessage[] = [
      ...doc.messages,
      ...(!self || userText
        ? [{ role: "user" as const, timestamp: now(), content: userText || "(pas de réponse)" }]
        : []),
      {
        role: "eugenia",
        timestamp: now(),
        content: feedback,
        meta: { card: card.id, role: "feedback", score, ...(self ? { self: true } : {}) },
      },
    ];
    const next = { ...doc, fields: { ...doc.fields, updated: now() }, messages };
    setDoc(next);
    latest.reveal();
    setResults((r) => [...r, { card, score, before, after }]);
    await save(next, path);
  };

  const submit = async (): Promise<void> => {
    const card = order[index];
    if (!card || !content) return;
    setBusy(true);
    try {
      const context = await taskContext(!card.isPublic);
      const evaluation = await evaluateAnswer(context, {
        knowledge: content.knowledge,
        question: content.question,
        expected: content.answer,
        answer,
      });
      const parts = [evaluation.feedback];
      if (evaluation.missing.length) parts.push(`Manquant : ${evaluation.missing.join(" ; ")}.`);
      if (evaluation.superfluous.length)
        parts.push(`En trop : ${evaluation.superfluous.join(" ; ")}.`);
      setLastEvaluation(evaluation);
      await record(evaluation.score, parts.join("\n\n"), false);
    } catch (error) {
      toast(`${errorMessage(error)} Vous pouvez passer en auto-évaluation.`, "error");
    } finally {
      setBusy(false);
    }
  };

  const selfScore = async (score: number): Promise<void> => {
    const labels: Record<number, string> = { 0: "à revoir", 0.5: "partiellement", 1: "acquise" };
    // L'auto-évaluation garde la trace de la réponse saisie, s'il y en a une.
    await record(
      score,
      `Auto-évaluation : ${labels[score]} (réponse attendue : ${content?.answer ?? ""}).`,
      true,
    );
  };

  const next = async (): Promise<void> => {
    if (!doc) return;
    if (index + 1 >= order.length) return finish();
    await ask(index + 1, order, doc);
  };

  const finish = async (): Promise<void> => {
    if (path && results.length > 0) {
      await useWiki
        .getState()
        .commit(`Quiz — ${node.title} (${plural(results.length, "réponse")})`, [path]);
    }
    setPhase("finished");
  };

  const card = order[index];
  const answered = card ? results.some((r) => r.card.id === card.id) : false;
  const lastReply = doc?.messages.findLastIndex((m) => m.role === "eugenia") ?? -1;
  const mean = results.length
    ? results.reduce((s, r) => s + r.score, 0) / results.length
    : undefined;

  return (
    <div className="page">
      <Breadcrumb tree={derived.tree} node={node} />
      <h1>Quiz — {node.title}</h1>

      {phase === "intro" && (
        <section className="oe-card">
          {cards.length === 0 ? (
            <EmptyState title="Aucune flashcard à réviser">
              Cette branche ne contient pas encore de flashcard : ajoutez-en aux connaissances
              atomiques pour les réviser.
            </EmptyState>
          ) : (
            <>
              <p>
                {plural(cards.length, "flashcard")}, posées de la moins maîtrisée à la mieux
                maîtrisée. Arrêtez quand vous voulez : chaque réponse met à jour votre maîtrise.
              </p>
              <fieldset className="oe-field" style={{ border: 0, padding: 0 }}>
                <legend className="oe-label">Évaluation des réponses</legend>
                <label className="check">
                  <input
                    type="radio"
                    name="mode"
                    checked={mode === "ai"}
                    disabled={!hasAI(settings)}
                    onChange={() => setMode("ai")}
                  />
                  <span>
                    Par Eugenia, qui compare votre réponse à la réponse attendue{" "}
                    {!hasAI(settings) && "(configurez une IA dans les paramètres)"}
                  </span>
                </label>
                <label className="check">
                  <input
                    type="radio"
                    name="mode"
                    checked={mode === "self"}
                    onChange={() => setMode("self")}
                  />
                  <span>
                    Auto-évaluation : vous révélez la réponse et notez vous-même (0, ½ ou 1), même
                    hors ligne
                  </span>
                </label>
                {!online && mode === "ai" && (
                  <span className="oe-help">
                    Hors ligne : seule une IA locale peut évaluer vos réponses.
                  </span>
                )}
              </fieldset>
              <div className="actions actions--start">
                <button type="button" className="oe-button" onClick={() => void start()}>
                  <Brain aria-hidden="true" /> Commencer
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {phase === "running" && (
        <section>
          <div
            className="actions"
            style={{ justifyContent: "space-between", marginBottom: "1rem" }}
          >
            <span className="small muted">
              Question {index + 1} sur {order.length}
            </span>
            <button
              type="button"
              className="oe-button oe-button--ghost oe-button--sm"
              onClick={() => void finish()}
            >
              <CircleStop aria-hidden="true" /> Arrêter
            </button>
          </div>
          <div className="progress" aria-hidden="true">
            <span style={{ width: `${(results.length / Math.max(1, order.length)) * 100}%` }} />
          </div>
          <div className="conversation section">
            {doc?.messages.map((m, i) => {
              const cardId = m.meta?.role === "feedback" ? String(m.meta.card) : undefined;
              const reference = cardId ? derived.tree.nodes.get(cardId) : undefined;
              const referenceContent = cardId ? contents.get(cardId) : undefined;
              return (
                <div
                  key={i}
                  ref={i === lastReply ? latest.ref : undefined}
                  className={`message message--${m.role}`}
                >
                  <span className="message__who">
                    {m.role === "eugenia" ? "Eugenia" : "Vous"}
                    {typeof m.meta?.score === "number" && (
                      <span className="score">· score {formatPercent(m.meta.score as number)}</span>
                    )}
                  </span>
                  <div className="message__bubble">
                    <Markdown text={m.content} path={path ?? node.indexPath} />
                    {reference && referenceContent && (
                      <CardReference
                        card={reference}
                        content={referenceContent}
                        // L'auto-évaluation a déjà révélé la réponse, reprise dans le message.
                        showAnswer={m.meta?.self !== true}
                      />
                    )}
                  </div>
                </div>
              );
            })}
            {busy && <Spinner label="Eugenia réfléchit" />}
          </div>
          {card && content && !answered && (
            <div className="composer">
              {mode === "self" && revealed && (
                <div className="oe-alert oe-alert--info">
                  <strong className="oe-alert__title">Réponse attendue</strong>
                  <Markdown text={content.answer} path={card.indexPath} />
                </div>
              )}
              <textarea
                className="oe-textarea"
                placeholder="Votre réponse…"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && mode === "ai") void submit();
                }}
                aria-label="Votre réponse"
                autoFocus
              />
              <div className="actions">
                {mode === "ai" ? (
                  <>
                    <button
                      type="button"
                      className="oe-button oe-button--ghost oe-button--sm"
                      onClick={() => setMode("self")}
                    >
                      Passer en auto-évaluation
                    </button>
                    <button
                      type="button"
                      className="oe-button"
                      disabled={busy}
                      onClick={() => void submit()}
                    >
                      <Send aria-hidden="true" /> Répondre
                    </button>
                  </>
                ) : !revealed ? (
                  <button type="button" className="oe-button" onClick={() => setRevealed(true)}>
                    <Eye aria-hidden="true" /> Révéler la réponse
                  </button>
                ) : (
                  <>
                    <span className="small muted">Votre note :</span>
                    <button
                      type="button"
                      className="oe-button oe-button--secondary"
                      onClick={() => void selfScore(0)}
                    >
                      0 — à revoir
                    </button>
                    <button
                      type="button"
                      className="oe-button oe-button--secondary"
                      onClick={() => void selfScore(0.5)}
                    >
                      ½ — partiellement
                    </button>
                    <button type="button" className="oe-button" onClick={() => void selfScore(1)}>
                      1 — acquise
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
          {card && answered && (
            <div className="composer">
              {(() => {
                const r = results[results.length - 1]!;
                return (
                  <p
                    className="small"
                    style={{
                      display: "flex",
                      gap: "0.75rem",
                      alignItems: "center",
                      flexWrap: "wrap",
                    }}
                  >
                    Maîtrise de « {r.card.title} » :{" "}
                    <MasteryMeter value={r.before} threshold={threshold} /> →{" "}
                    <MasteryMeter value={r.after} threshold={threshold} />
                    {lastEvaluation &&
                      lastEvaluation.score > derived.config.mastery.success_threshold && (
                        <Check aria-label="Réussite" style={{ color: "var(--oe-color-success)" }} />
                      )}
                  </p>
                );
              })()}
              <div className="actions">
                <button type="button" className="oe-button" onClick={() => void next()} autoFocus>
                  {index + 1 >= order.length ? "Terminer" : "Question suivante"}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {phase === "finished" && (
        <section className="oe-card oe-card--featured">
          <h2 className="oe-card__title">
            <Sparkles aria-hidden="true" style={{ display: "inline", verticalAlign: "-0.15em" }} />{" "}
            Quiz terminé
          </h2>
          {results.length === 0 ? (
            <p>Aucune réponse : rien n'a été enregistré.</p>
          ) : (
            <>
              <p>
                {plural(results.length, "réponse")}, score moyen{" "}
                <strong>{formatPercent(mean)}</strong>. Le quiz est enregistré dans vos{" "}
                <a href={href({ name: "discussions", kind: "quiz" })}>discussions</a> : il sert de
                trace pour recalculer votre maîtrise.
              </p>
              <table className="chart-table">
                <thead>
                  <tr>
                    <th>Flashcard</th>
                    <th>Score</th>
                    <th>Maîtrise</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr key={i}>
                      <td>
                        <a href={href({ name: "node", id: r.card.id })}>{r.card.title}</a>
                      </td>
                      <td>{formatPercent(r.score)}</td>
                      <td>
                        {formatPercent(r.before)} → {formatPercent(r.after)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <div className="actions actions--start">
            <button type="button" className="oe-button" onClick={() => setPhase("intro")}>
              <RotateCcw aria-hidden="true" /> Relancer un quiz
            </button>
            <a className="oe-button oe-button--ghost" href={href({ name: "node", id: node.id })}>
              Retour à « {node.title} »
            </a>
          </div>
        </section>
      )}
    </div>
  );
}
