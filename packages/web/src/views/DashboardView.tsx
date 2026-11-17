/** Tableau de bord (§8.3, §9.2 vue 8) : indicateurs, courbes de maîtrise, révisions, rappels. */
import { useMemo, useState } from "react";
import { AlertTriangle, Brain } from "lucide-react";
import {
  averageCurve,
  children,
  currentMastery,
  dayNumber,
  dayToDate,
  flashcardsUnder,
  reminders,
} from "@openeugenia/core";
import {
  ColumnChart,
  LineChart,
  MasteryMeter,
  StatTile,
  type LineSeries,
} from "../components/charts.tsx";
import { EmptyState, InfoBox } from "../components/common.tsx";
import { formatInteger, formatPercent, formatShortDate, plural } from "../lib/format.ts";
import { useDerived, useIsOwner } from "../lib/hooks.ts";
import { branchMasteryMap } from "../lib/mastery.ts";
import { href } from "../lib/router.ts";

const RANGES = [
  { days: 30, label: "30 jours" },
  { days: 90, label: "90 jours" },
  { days: 365, label: "1 an" },
];
const SLOTS = ["var(--viz-series-2)", "var(--viz-series-3)", "var(--viz-series-4)"];

export function DashboardView() {
  const derived = useDerived();
  const owner = useIsOwner();
  const [range, setRange] = useState(30);
  const [selected, setSelected] = useState<string[]>([]);
  const today = dayNumber(Date.now());
  const fromDay = today - range + 1;
  const { tree, mastery, quizEvents, config } = derived;
  const threshold = config.mastery.reminder_threshold;
  const cards = useMemo(
    () => [...tree.nodes.values()].filter((n) => n.type === "flashcard"),
    [tree],
  );
  const branch = useMemo(() => branchMasteryMap(tree, mastery), [tree, mastery]);
  const categories = useMemo(
    () => children(tree, tree.rootId).filter((n) => n.type !== "flashcard"),
    [tree],
  );

  const stats = useMemo(() => {
    const values = cards
      .map((c) => (mastery.get(c.id) ? currentMastery(mastery.get(c.id)!, today) : undefined))
      .filter((v): v is number => v !== undefined);
    const reviewed30 = new Set(
      quizEvents.filter((e) => dayNumber(e.at) > today - 30).map((e) => e.card),
    );
    const week = quizEvents.filter((e) => dayNumber(e.at) > today - 7).length;
    return {
      mean: values.length ? values.reduce((s, v) => s + v, 0) / values.length : undefined,
      atRisk: values.filter((v) => v < threshold).length,
      reviewRate: cards.length
        ? cards.filter((c) => reviewed30.has(c.id)).length / cards.length
        : undefined,
      week,
      notes: [...tree.nodes.values()].filter((n) => n.type === "note" && !n.virtual).length,
    };
  }, [cards, mastery, quizEvents, today, threshold, tree]);

  const series: LineSeries[] = useMemo(() => {
    const toCards = (ids: { id: string; created?: string }[]) => ids;
    const ref = (n: { id: string; created?: string }) =>
      n.created ? { id: n.id, created: n.created } : { id: n.id };
    const out: LineSeries[] = [];
    if (cards.length > 0) {
      out.push({
        id: "all",
        label: "Ensemble",
        color: "var(--viz-series-1)",
        points: averageCurve(
          toCards(cards.map(ref)),
          quizEvents,
          config.mastery,
          fromDay,
          today,
        ).map((p) => ({ x: p.day, y: p.mastery })),
      });
    }
    selected.forEach((categoryId, i) => {
      const category = tree.nodes.get(categoryId);
      if (!category) return;
      const inside = flashcardsUnder(tree, categoryId).map(ref);
      if (inside.length === 0) return;
      out.push({
        id: categoryId,
        label: category.title,
        color: SLOTS[i] ?? "var(--viz-series-4)",
        points: averageCurve(inside, quizEvents, config.mastery, fromDay, today).map((p) => ({
          x: p.day,
          y: p.mastery,
        })),
      });
    });
    return out.filter((s) => s.points.length > 0);
  }, [cards, selected, quizEvents, config.mastery, fromDay, today, tree]);

  const perDay = useMemo(() => {
    const counts = new Map<number, number>();
    for (const e of quizEvents) {
      const d = dayNumber(e.at);
      if (d >= fromDay) counts.set(d, (counts.get(d) ?? 0) + 1);
    }
    const out = [];
    for (let d = fromDay; d <= today; d++)
      out.push({ key: String(d), label: formatShortDate(dayToDate(d)), value: counts.get(d) ?? 0 });
    return out;
  }, [quizEvents, fromDay, today]);

  const groups = reminders(tree, mastery, threshold, today);

  if (!owner) {
    return (
      <div className="page">
        <h1>Tableau de bord</h1>
        <InfoBox>
          Le tableau de bord présente votre maîtrise : il est disponible quand vous ouvrez votre
          propre wiki.
        </InfoBox>
      </div>
    );
  }

  // Une catégorie garde sa couleur tant qu'elle reste sélectionnée.
  const toggle = (id: string): void =>
    setSelected((list) =>
      list.includes(id) ? list.filter((x) => x !== id) : list.length >= 3 ? list : [...list, id],
    );

  return (
    <div className="page page--wide">
      <h1>Tableau de bord</h1>
      {cards.length === 0 ? (
        <EmptyState title="Pas encore de connaissance atomique">
          Extrayez des connaissances de vos notes pour suivre ici votre maîtrise.
        </EmptyState>
      ) : (
        <>
          <section
            className="section"
            style={{ display: "flex", gap: "2rem", alignItems: "flex-end", flexWrap: "wrap" }}
          >
            <div>
              <span className="stat-tile__label">Maîtrise moyenne aujourd'hui</span>
              <div className="hero-figure">{formatPercent(stats.mean)}</div>
            </div>
            {stats.mean !== undefined && stats.mean < threshold && (
              <span
                className="muted small"
                style={{
                  display: "inline-flex",
                  gap: "0.35rem",
                  alignItems: "center",
                  paddingBottom: "0.5rem",
                }}
              >
                <AlertTriangle aria-hidden="true" style={{ color: "var(--status-warning)" }} /> sous
                le seuil de rappel ({formatPercent(threshold)})
              </span>
            )}
          </section>
          <section className="section kpi-row">
            <StatTile
              label="Connaissances atomiques"
              value={formatInteger(cards.length)}
              note={`${plural(stats.notes, "note")}`}
            />
            <StatTile
              label="Révisées sur 30 jours"
              value={formatPercent(stats.reviewRate)}
              note="part des connaissances évaluées au moins une fois"
            />
            <StatTile label="Évaluations sur 7 jours" value={formatInteger(stats.week)} />
            <StatTile
              label="À réviser"
              value={formatInteger(stats.atRisk)}
              note={`maîtrise sous ${formatPercent(threshold)}`}
            />
          </section>

          <div className="toolbar section" role="group" aria-label="Période">
            {RANGES.map((r) => (
              <button
                key={r.days}
                type="button"
                className={`oe-button oe-button--sm ${range === r.days ? "" : "oe-button--ghost"}`}
                aria-pressed={range === r.days}
                onClick={() => setRange(r.days)}
              >
                {r.label}
              </button>
            ))}
          </div>

          <section className="section oe-card">
            <LineChart
              title="Maîtrise dans le temps"
              subtitle={
                selected.length === 0 ? "ensemble des connaissances" : "comparaison par catégorie"
              }
              series={series}
              xFormat={(d) => formatShortDate(dayToDate(d))}
              threshold={{ value: threshold, label: "Seuil de rappel" }}
              height={260}
            />
            <fieldset className="oe-field" style={{ border: 0, padding: 0, marginTop: "0.75rem" }}>
              <legend className="oe-label">Comparer jusqu'à 3 catégories</legend>
              <div className="badges">
                {categories
                  .filter((c) => (branch.get(c.id)?.count ?? 0) > 0)
                  .map((c) => (
                    <label key={c.id} className="check" style={{ marginRight: "0.75rem" }}>
                      <input
                        type="checkbox"
                        checked={selected.includes(c.id)}
                        disabled={!selected.includes(c.id) && selected.length >= 3}
                        onChange={() => toggle(c.id)}
                      />
                      {c.title}
                    </label>
                  ))}
              </div>
            </fieldset>
          </section>

          <section className="section oe-card">
            <ColumnChart title="Évaluations par jour" data={perDay} valueLabel="évaluation(s)" />
          </section>

          <section className="section">
            <h2>Catégories</h2>
            <table className="chart-table">
              <thead>
                <tr>
                  <th>Catégorie</th>
                  <th>Connaissances</th>
                  <th>Maîtrise</th>
                  <th>À réviser</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((c) => {
                  const m = branch.get(c.id);
                  const group = groups.find((g) => g.category.id === c.id);
                  return (
                    <tr key={c.id}>
                      <td>
                        <a href={href({ name: "node", id: c.id })}>{c.title}</a>
                      </td>
                      <td>{m?.count ?? 0}</td>
                      <td>
                        {m?.value !== undefined ? (
                          <MasteryMeter value={m.value} threshold={threshold} />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {group ? (
                          <a
                            className="oe-button oe-button--ghost oe-button--sm"
                            href={href({ name: "quiz", id: c.id })}
                          >
                            <Brain aria-hidden="true" /> {group.cards.length}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
