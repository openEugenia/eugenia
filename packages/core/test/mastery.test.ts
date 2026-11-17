import { describe, expect, it } from "vitest";
import {
  applyEvaluation,
  currentMastery,
  dayNumber,
  DEFAULT_MASTERY,
  initialCardState,
  masteryCurve,
  quizOrder,
  reminders,
  replayMastery,
  type QuizEvent,
} from "../src/index.ts";
import { CONFIG, memoryWiki, page } from "./helpers.ts";

const D0 = dayNumber("2026-11-01T09:00:00Z");

describe("algorithme de maîtrise", () => {
  it("initialise une flashcard (m = 0,5, β = 0,95)", () => {
    const s = initialCardState(D0);
    expect(s).toMatchObject({ mastery: 0.5, failureDay: D0, lastEvalDay: D0, evaluations: 0 });
    expect(s.decay).toBeCloseTo(0.95);
  });

  it("applique le déclin quotidien m · β^(d − e)", () => {
    const s = initialCardState(D0);
    expect(currentMastery(s, D0)).toBe(0.5);
    expect(currentMastery(s, D0 + 10)).toBeCloseTo(0.5 * 0.95 ** 10);
  });

  it("met à jour après une réussite puis un échec", () => {
    let s = applyEvaluation(initialCardState(D0), 1, D0 + 2);
    const m1 = (0.5 * 0.95 ** 2 + 1) / 2;
    expect(s.mastery).toBeCloseTo(m1);
    expect(s.decay).toBeCloseTo(1 - 0.05 / (1 + 2));
    expect(s.failureDay).toBe(D0);
    expect(s.lastEvalDay).toBe(D0 + 2);

    s = applyEvaluation(s, 0.3, D0 + 5);
    const m2 = (m1 * (1 - 0.05 / 3) ** 3 + 0.3) / 2;
    expect(s.mastery).toBeCloseTo(m2);
    expect(s.decay).toBeCloseTo(0.95);
    expect(s.failureDay).toBe(D0 + 5);
  });

  it("un score de 0,5 exactement est un échec", () => {
    expect(applyEvaluation(initialCardState(D0), 0.5, D0 + 1).failureDay).toBe(D0 + 1);
  });

  it("retrouve la moyenne mobile de la documentation fonctionnelle (α = ½, sans déclin)", () => {
    const params = { ...DEFAULT_MASTERY, initial: 0, decay_rate: 0 };
    let s = initialCardState(D0, params);
    const xs = [1.0, 0.8, 0.6, 1.0, 0.0, 0.5, 0.9, 0.7, 0.4, 1.0];
    const seen = xs.map((x) => {
      s = applyEvaluation(s, x, D0, params);
      return Math.floor(s.mastery * 100) / 100;
    });
    expect(seen).toEqual([0.5, 0.65, 0.62, 0.81, 0.4, 0.45, 0.67, 0.68, 0.54, 0.77]);
  });

  it("ralentit l'oubli quand les réussites s'enchaînent loin du dernier échec", () => {
    let s = initialCardState(D0);
    for (const d of [1, 3, 7, 15, 31]) s = applyEvaluation(s, 1, D0 + d);
    expect(s.decay).toBeCloseTo(1 - 0.05 / 32);
    expect(currentMastery(s, D0 + 61)).toBeGreaterThan(0.75);
  });
});

describe("rejeu des quiz", async () => {
  const wiki = await memoryWiki({
    ".notes/config.yml": CONFIG,
    "wiki/index.md": page({ id: "R", title: "Racine" }),
    "wiki/philo/index.md": page({ id: "P", title: "Philosophie et pensée" }),
    "wiki/philo/a/index.md": page({
      id: "A",
      type: "flashcard",
      title: "A",
      created: "2026-11-01T09:00:00Z",
    }),
    "wiki/philo/b/index.md": page({
      id: "B",
      type: "flashcard",
      title: "B",
      created: "2026-11-01T09:00:00Z",
    }),
    "wiki/philo/c/index.md": page({
      id: "C",
      type: "flashcard",
      title: "C",
      created: "2026-11-01T09:00:00Z",
    }),
  });
  const events: QuizEvent[] = [
    { card: "B", score: 1, at: "2026-11-05T10:00:00Z" },
    { card: "A", score: 0.2, at: "2026-11-03T10:00:00Z" },
    { card: "A", score: 0.9, at: "2026-11-04T10:00:00Z" },
    { card: "inconnue", score: 1, at: "2026-11-04T10:00:00Z" },
  ];
  const today = dayNumber("2026-11-06T12:00:00Z");
  const states = replayMastery(
    [...wiki.tree.nodes.values()]
      .filter((n) => n.type === "flashcard")
      .map((n) => ({ id: n.id, created: n.created })),
    events,
    DEFAULT_MASTERY,
    today,
  );

  it("rejoue les évaluations dans l'ordre chronologique", () => {
    let a = initialCardState(D0);
    a = applyEvaluation(a, 0.2, D0 + 2);
    a = applyEvaluation(a, 0.9, D0 + 3);
    expect(states.get("A")!.mastery).toBeCloseTo(a.mastery);
    expect(states.get("A")!.evaluations).toBe(2);
    expect(states.has("inconnue")).toBe(false);
  });

  it("ordonne le quiz par maîtrise actuelle croissante", () => {
    expect(quizOrder(wiki.tree, "P", states, today).map((n) => n.id)).toEqual(["C", "A", "B"]);
  });

  it("signale les connaissances qui risquent d'être oubliées", () => {
    const groups = reminders(wiki.tree, states, 0.42, today);
    expect(groups.map((g) => [g.category.title, g.cards.map((c) => c.id)])).toEqual([
      ["Philosophie et pensée", ["C"]],
    ]);
  });

  it("trace la courbe de maîtrise jour par jour", () => {
    const curve = masteryCurve(
      { id: "B", created: "2026-11-01T09:00:00Z" },
      events,
      DEFAULT_MASTERY,
      today,
    );
    expect(curve.length).toBe(6);
    expect(curve[0]!.mastery).toBe(0.5);
    expect(curve[4]!.mastery).toBeCloseTo(states.get("B")!.mastery);
  });
});
