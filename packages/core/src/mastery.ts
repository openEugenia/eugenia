/** Maîtrise et déclin des connaissances, recalculés en rejouant les quiz (§8.3). */
import { DEFAULT_MASTERY, type MasteryParams } from "./config.ts";
import type { QuizEvent } from "./discussion.ts";
import { parseTime } from "./time.ts";
import { flashcardsUnder, type WikiNode, type WikiTree } from "./tree.ts";
import { isUlid, ulidTime } from "./ulid.ts";

export const DAY_MS = 86_400_000;

/** État dérivé d'une flashcard (jamais saisi). */
export interface CardState {
  /** Maîtrise m à la date de la dernière évaluation. */
  mastery: number;
  /** Jour du dernier échec f. */
  failureDay: number;
  /** Facteur de déclin quotidien β. */
  decay: number;
  /** Jour de la dernière évaluation e. */
  lastEvalDay: number;
  evaluations: number;
  lastScore?: number;
  lastEvalAt?: string;
}

/** Numéro de jour (jours entiers depuis l'époque Unix, en UTC). */
export function dayNumber(date: string | number | Date): number {
  const t =
    typeof date === "number" ? date : date instanceof Date ? date.getTime() : Date.parse(date);
  return Math.floor(t / DAY_MS);
}

export function dayToDate(day: number): Date {
  return new Date(day * DAY_MS);
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

export function initialCardState(
  createdDay: number,
  params: MasteryParams = DEFAULT_MASTERY,
): CardState {
  return {
    mastery: params.initial,
    failureDay: createdDay,
    decay: 1 - params.decay_rate / (1 + 0),
    lastEvalDay: createdDay,
    evaluations: 0,
  };
}

/** Maîtrise actuelle au jour `day` : m · β^(d − e). */
export function currentMastery(state: CardState, day: number): number {
  return clamp01(state.mastery * state.decay ** Math.max(0, day - state.lastEvalDay));
}

/** Mise à jour après une évaluation de score `score` au jour `day`. */
export function applyEvaluation(
  state: CardState,
  score: number,
  day: number,
  params: MasteryParams = DEFAULT_MASTERY,
): CardState {
  const x = clamp01(score);
  // 1. Le déclin est d'abord appliqué.
  let m = currentMastery(state, day);
  // 2. Moyenne mobile exponentielle (α = ½ par défaut), réussite ou échec.
  m = (1 - params.alpha) * m + params.alpha * x;
  let failureDay = state.failureDay;
  let decay: number;
  if (x > params.success_threshold) {
    // 3. Réussite : l'oubli ralentit avec le temps écoulé depuis le dernier échec.
    const t = Math.max(0, day - failureDay);
    decay = 1 - params.decay_rate / (1 + t);
  } else {
    // 4. Échec : le déclin repart à son rythme le plus rapide.
    failureDay = day;
    decay = 1 - params.decay_rate;
  }
  // 5. Date de la dernière évaluation.
  return {
    mastery: clamp01(m),
    failureDay,
    decay,
    lastEvalDay: Math.max(day, state.lastEvalDay),
    evaluations: state.evaluations + 1,
    lastScore: x,
  };
}

export interface CardRef {
  id: string;
  created?: string;
}

/** Jour de création d'une flashcard : champ `created`, sinon date de son ULID. */
export function creationDay(card: CardRef, fallback: number): number {
  const t = parseTime(card.created);
  if (t !== undefined) return dayNumber(t);
  if (isUlid(card.id)) return dayNumber(ulidTime(card.id));
  return fallback;
}

export function sortEvents(events: readonly QuizEvent[]): QuizEvent[] {
  return [...events].sort((a, b) => (parseTime(a.at) ?? 0) - (parseTime(b.at) ?? 0));
}

/**
 * Rejoue chronologiquement toutes les évaluations des quiz pour reconstruire l'état
 * de chaque flashcard. Les évaluations de flashcards inconnues sont ignorées.
 */
export function replayMastery(
  cards: readonly CardRef[],
  events: readonly QuizEvent[],
  params: MasteryParams = DEFAULT_MASTERY,
  today: number = dayNumber(Date.now()),
): Map<string, CardState> {
  const states = new Map<string, CardState>();
  for (const card of cards) states.set(card.id, initialCardState(creationDay(card, today), params));
  for (const event of sortEvents(events)) {
    const state = states.get(event.card);
    const t = parseTime(event.at);
    if (!state || t === undefined) continue;
    const next = applyEvaluation(state, event.score, dayNumber(t), params);
    next.lastEvalAt = event.at;
    states.set(event.card, next);
  }
  return states;
}

export interface MasteryPoint {
  day: number;
  mastery: number;
}

/** Courbe de maîtrise d'une flashcard, jour par jour, de sa création à `toDay`. */
export function masteryCurve(
  card: CardRef,
  events: readonly QuizEvent[],
  params: MasteryParams = DEFAULT_MASTERY,
  toDay: number = dayNumber(Date.now()),
): MasteryPoint[] {
  const start = creationDay(card, toDay);
  const byDay = new Map<number, QuizEvent[]>();
  for (const event of sortEvents(events.filter((e) => e.card === card.id))) {
    const t = parseTime(event.at);
    if (t === undefined) continue;
    const day = Math.max(start, dayNumber(t));
    byDay.set(day, [...(byDay.get(day) ?? []), event]);
  }
  const points: MasteryPoint[] = [];
  let state = initialCardState(start, params);
  for (let day = start; day <= toDay; day++) {
    for (const event of byDay.get(day) ?? [])
      state = applyEvaluation(state, event.score, day, params);
    points.push({ day, mastery: currentMastery(state, day) });
  }
  return points;
}

/** Courbe moyenne d'un ensemble de flashcards (une flashcard compte à partir de sa création). */
export function averageCurve(
  cards: readonly CardRef[],
  events: readonly QuizEvent[],
  params: MasteryParams = DEFAULT_MASTERY,
  fromDay: number,
  toDay: number = dayNumber(Date.now()),
): MasteryPoint[] {
  const sums = new Map<number, { sum: number; count: number }>();
  const byCard = new Map<string, QuizEvent[]>();
  for (const e of events) byCard.set(e.card, [...(byCard.get(e.card) ?? []), e]);
  for (const card of cards) {
    for (const point of masteryCurve(card, byCard.get(card.id) ?? [], params, toDay)) {
      if (point.day < fromDay) continue;
      const s = sums.get(point.day) ?? { sum: 0, count: 0 };
      s.sum += point.mastery;
      s.count += 1;
      sums.set(point.day, s);
    }
  }
  const out: MasteryPoint[] = [];
  for (let day = fromDay; day <= toDay; day++) {
    const s = sums.get(day);
    if (s && s.count > 0) out.push({ day, mastery: s.sum / s.count });
  }
  return out;
}

/** Maîtrise d'une branche : moyenne de la maîtrise actuelle de ses flashcards. */
export function branchMastery(
  tree: WikiTree,
  nodeId: string,
  states: ReadonlyMap<string, CardState>,
  day: number = dayNumber(Date.now()),
): { value: number | undefined; count: number } {
  const cards = flashcardsUnder(tree, nodeId);
  let sum = 0;
  let count = 0;
  for (const card of cards) {
    const state = states.get(card.id);
    if (!state) continue;
    sum += currentMastery(state, day);
    count++;
  }
  return { value: count > 0 ? sum / count : undefined, count };
}

/** Flashcards d'une branche triées par maîtrise actuelle croissante (ordre du quiz). */
export function quizOrder(
  tree: WikiTree,
  nodeId: string,
  states: ReadonlyMap<string, CardState>,
  day: number = dayNumber(Date.now()),
): WikiNode[] {
  const cards = flashcardsUnder(tree, nodeId);
  const value = (n: WikiNode): number => {
    const s = states.get(n.id);
    return s ? currentMastery(s, day) : Number.POSITIVE_INFINITY;
  };
  return cards.sort(
    (a, b) =>
      value(a) - value(b) ||
      (states.get(a.id)?.lastEvalDay ?? 0) - (states.get(b.id)?.lastEvalDay ?? 0) ||
      a.title.localeCompare(b.title, "fr"),
  );
}

export interface ReminderGroup {
  /** Catégorie de premier niveau (ou la racine). */
  category: WikiNode;
  cards: WikiNode[];
}

/** Rappels de révision : flashcards sous le seuil, regroupées par catégorie de premier niveau. */
export function reminders(
  tree: WikiTree,
  states: ReadonlyMap<string, CardState>,
  threshold: number,
  day: number = dayNumber(Date.now()),
): ReminderGroup[] {
  const groups = new Map<string, ReminderGroup>();
  for (const node of tree.nodes.values()) {
    if (node.type !== "flashcard") continue;
    const state = states.get(node.id);
    if (!state || currentMastery(state, day) >= threshold) continue;
    let category: WikiNode = node;
    while (category.parentId && category.parentId !== tree.rootId) {
      category = tree.nodes.get(category.parentId)!;
    }
    if (category.id === node.id) category = tree.nodes.get(tree.rootId)!;
    const group = groups.get(category.id) ?? { category, cards: [] };
    group.cards.push(node);
    groups.set(category.id, group);
  }
  return [...groups.values()].sort((a, b) => b.cards.length - a.cards.length);
}
