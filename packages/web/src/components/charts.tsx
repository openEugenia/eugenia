/**
 * Visualizations: mastery gauge (meter), stat tile, line chart and bar chart. Thin strokes,
 * discreet grid, tooltip on hover and with the keyboard, and a table view for each chart (no
 * value is conveyed by color alone).
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { AlertTriangle, Table2 } from "lucide-react";
import { formatPercent } from "../lib/format.ts";

// ---------------------------------------------------------------------------
// Mastery gauge
// ---------------------------------------------------------------------------

export function MasteryMeter({
  value,
  threshold,
  compact = false,
  label,
}: {
  value: number | undefined;
  threshold?: number;
  compact?: boolean;
  label?: string;
}) {
  if (value === undefined) return null;
  const low = threshold !== undefined && value < threshold;
  const text = formatPercent(value);
  const description = `${label ?? "Mastery"}: ${text}${low ? ", below the reminder threshold" : ""}`;
  return (
    <span
      className={`meter${low ? " is-low" : ""}${compact ? " meter--compact" : ""}`}
      role="img"
      aria-label={description}
      title={description}
    >
      <span className="meter__track" aria-hidden="true">
        <span
          className="meter__fill"
          style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }}
        />
      </span>
      {!compact && (
        <span className="meter__label" aria-hidden="true">
          {low && <AlertTriangle style={{ color: "var(--status-warning)" }} />}
          {text}
        </span>
      )}
      {compact && low && (
        <AlertTriangle
          aria-hidden="true"
          style={{ color: "var(--status-warning)", width: "0.85em" }}
        />
      )}
    </span>
  );
}

export function StatTile({
  label,
  value,
  note,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
}) {
  return (
    <div className="stat-tile">
      <span className="stat-tile__label">{label}</span>
      <span className="stat-tile__value">{value}</span>
      {note && <span className="stat-tile__note">{note}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.max(240, Math.floor(entry.contentRect.width)));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

function ChartFrame({
  title,
  subtitle,
  table,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  table: ReactNode;
  children: ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <figure className="chart">
      <figcaption className="chart__head">
        <span>
          <span className="chart__title">{title}</span>
          {subtitle && <span className="muted small"> · {subtitle}</span>}
        </span>
        <button
          type="button"
          className="oe-button oe-button--ghost oe-button--sm"
          aria-pressed={showTable}
          onClick={() => setShowTable((v) => !v)}
        >
          <Table2 aria-hidden="true" /> {showTable ? "Chart" : "Table"}
        </button>
      </figcaption>
      {showTable ? <div className="table-scroll">{table}</div> : children}
    </figure>
  );
}

function ticks(min: number, max: number, count: number): number[] {
  if (max <= min) return [min];
  const step = Math.max(1, Math.round((max - min) / Math.max(1, count - 1)));
  const out: number[] = [];
  for (let v = min; v <= max; v += step) out.push(v);
  if (out[out.length - 1] !== max && max - out[out.length - 1]! > step / 2) out.push(max);
  return out;
}

// ---------------------------------------------------------------------------
// Line charts
// ---------------------------------------------------------------------------

export interface LineSeries {
  id: string;
  label: string;
  /** Color of the series (CSS variable `--viz-series-n`). */
  color: string;
  points: { x: number; y: number }[];
}

interface LineChartProps {
  title: string;
  subtitle?: ReactNode;
  series: LineSeries[];
  xFormat(x: number): string;
  yFormat?(y: number): string;
  height?: number;
  threshold?: { value: number; label: string };
}

/** Lines on a single [0, 1] axis (mastery). */
export function LineChart({
  title,
  subtitle,
  series,
  xFormat,
  yFormat = (y) => formatPercent(y),
  height = 220,
  threshold,
}: LineChartProps) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const xs = useMemo(
    () => [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b),
    [series],
  );
  const byX = useMemo(() => series.map((s) => new Map(s.points.map((p) => [p.x, p.y]))), [series]);
  const direct = series.length <= 4;
  const margin = { top: 12, right: direct ? 112 : 16, bottom: 26, left: 40 };
  const plotW = Math.max(40, width - margin.left - margin.right);
  const plotH = height - margin.top - margin.bottom;
  const minX = xs[0] ?? 0;
  const maxX = xs[xs.length - 1] ?? 1;
  const sx = (x: number): number =>
    margin.left + (maxX === minX ? plotW / 2 : ((x - minX) / (maxX - minX)) * plotW);
  const sy = (y: number): number => margin.top + (1 - Math.min(1, Math.max(0, y))) * plotH;

  // Direct labels at the end of the lines, unless they overlap.
  const ends = series
    .map((s) => ({ s, last: s.points[s.points.length - 1] }))
    .filter((e): e is { s: LineSeries; last: { x: number; y: number } } => e.last !== undefined)
    .sort((a, b) => sy(a.last.y) - sy(b.last.y));
  const labelsFit =
    direct && ends.every((e, i) => i === 0 || sy(e.last.y) - sy(ends[i - 1]!.last.y) >= 15);

  const xTicks = ticks(minX, maxX, Math.max(2, Math.min(6, Math.floor(plotW / 110))));
  const activeX = active !== null ? xs[active] : undefined;

  const onKey = (e: KeyboardEvent<SVGSVGElement>): void => {
    if (xs.length === 0) return;
    if (e.key === "ArrowRight") setActive((a) => Math.min(xs.length - 1, (a ?? -1) + 1));
    else if (e.key === "ArrowLeft") setActive((a) => Math.max(0, (a ?? xs.length) - 1));
    else if (e.key === "Escape") setActive(null);
    else return;
    e.preventDefault();
  };

  const table = (
    <table className="chart-table">
      <thead>
        <tr>
          <th>Date</th>
          {series.map((s) => (
            <th key={s.id}>{s.label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {xs.map((x) => (
          <tr key={x}>
            <td>{xFormat(x)}</td>
            {series.map((s, j) => (
              <td key={s.id}>{byX[j]!.has(x) ? yFormat(byX[j]!.get(x)!) : "—"}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );

  const tooltipLeft = activeX !== undefined ? Math.min(sx(activeX) + 12, width - 170) : 0;

  return (
    <ChartFrame title={title} {...(subtitle ? { subtitle } : {})} table={table}>
      <div className="chart__plot" ref={ref}>
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`${title}. Left and right arrows to browse the values.`}
          tabIndex={0}
          onKeyDown={onKey}
          onPointerLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
        >
          <g className="grid">
            {[0, 0.25, 0.5, 0.75, 1].map((v) => (
              <g key={v}>
                <line x1={margin.left} x2={margin.left + plotW} y1={sy(v)} y2={sy(v)} />
                <text x={margin.left - 6} y={sy(v)} dy="0.32em" textAnchor="end">
                  {Math.round(v * 100)}%
                </text>
              </g>
            ))}
          </g>
          <g className="axis">
            {xTicks.map((x) => (
              <text key={x} x={sx(x)} y={height - 6} textAnchor="middle">
                {xFormat(x)}
              </text>
            ))}
          </g>
          {threshold && (
            <g>
              <line
                className="threshold"
                x1={margin.left}
                x2={margin.left + plotW}
                y1={sy(threshold.value)}
                y2={sy(threshold.value)}
              />
              <text
                className="label-text"
                x={margin.left + 4}
                y={sy(threshold.value) - 4}
                style={{ fill: "var(--oe-color-text-muted)", fontSize: 11 }}
              >
                {threshold.label}
              </text>
            </g>
          )}
          {series.length === 1 && series[0]!.points.length > 1 && (
            <path
              className="series-area"
              fill={series[0]!.color}
              d={`M${series[0]!.points.map((p) => `${sx(p.x)},${sy(p.y)}`).join("L")}L${sx(series[0]!.points[series[0]!.points.length - 1]!.x)},${sy(0)}L${sx(series[0]!.points[0]!.x)},${sy(0)}Z`}
            />
          )}
          {series.map((s) => (
            <path
              key={s.id}
              className="series-line"
              stroke={s.color}
              d={`M${s.points.map((p) => `${sx(p.x)},${sy(p.y)}`).join("L")}`}
            />
          ))}
          {ends.map(({ s, last }) => (
            <g key={s.id}>
              <circle className="marker" cx={sx(last.x)} cy={sy(last.y)} r={4} fill={s.color} />
              {labelsFit && (
                <text className="label-text" x={sx(last.x) + 8} y={sy(last.y)} dy="0.32em">
                  {s.label.length > 14 ? `${s.label.slice(0, 13)}…` : s.label} {yFormat(last.y)}
                </text>
              )}
            </g>
          ))}
          {activeX !== undefined && (
            <g>
              <line
                className="crosshair"
                x1={sx(activeX)}
                x2={sx(activeX)}
                y1={margin.top}
                y2={margin.top + plotH}
              />
              {series.map((s, j) =>
                byX[j]!.has(activeX) ? (
                  <circle
                    key={s.id}
                    className="marker"
                    cx={sx(activeX)}
                    cy={sy(byX[j]!.get(activeX)!)}
                    r={4}
                    fill={s.color}
                  />
                ) : null,
              )}
            </g>
          )}
          <rect
            x={margin.left}
            y={margin.top}
            width={plotW}
            height={plotH}
            fill="transparent"
            onPointerMove={(e) => {
              const rect = (e.currentTarget as SVGRectElement).getBoundingClientRect();
              const x = minX + ((e.clientX - rect.left) / rect.width) * (maxX - minX);
              let best = 0;
              for (let i = 1; i < xs.length; i++)
                if (Math.abs(xs[i]! - x) < Math.abs(xs[best]! - x)) best = i;
              setActive(xs.length ? best : null);
            }}
          />
        </svg>
        {activeX !== undefined && (
          <div className="chart-tooltip" style={{ left: tooltipLeft, top: margin.top }}>
            <div className="chart-tooltip__date">{xFormat(activeX)}</div>
            {series.map((s, j) =>
              byX[j]!.has(activeX) ? (
                <div className="chart-tooltip__row" key={s.id}>
                  <span className="line-key" style={{ background: s.color }} />
                  <strong>{yFormat(byX[j]!.get(activeX)!)}</strong>
                  <span className="muted">{s.label}</span>
                </div>
              ) : null,
            )}
          </div>
        )}
      </div>
      {series.length >= 2 && (
        <div className="legend">
          {series.map((s) => (
            <span className="legend__item" key={s.id}>
              <span className="line-key" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </ChartFrame>
  );
}

// ---------------------------------------------------------------------------
// Bar chart (columns)
// ---------------------------------------------------------------------------

export interface ColumnDatum {
  key: string;
  label: string;
  value: number;
}

export function ColumnChart({
  title,
  subtitle,
  data,
  height = 170,
  valueLabel = "value",
}: {
  title: string;
  subtitle?: ReactNode;
  data: ColumnDatum[];
  height?: number;
  valueLabel?: string;
}) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const margin = { top: 18, right: 8, bottom: 24, left: 32 };
  const plotW = Math.max(40, width - margin.left - margin.right);
  const plotH = height - margin.top - margin.bottom;
  const max = Math.max(1, ...data.map((d) => d.value));
  const niceMax = max <= 4 ? max : Math.ceil(max / 5) * 5;
  const band = plotW / Math.max(1, data.length);
  const barW = Math.min(24, Math.max(2, band - 2));
  const sy = (v: number): number => margin.top + plotH - (v / niceMax) * plotH;
  const maxIndex = data.reduce((best, d, i) => (d.value > (data[best]?.value ?? -1) ? i : best), 0);
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(plotW / 70))));

  const bar = (x: number, v: number): string => {
    const h = Math.max(0, (v / niceMax) * plotH);
    if (h <= 0) return "";
    const r = Math.min(4, h, barW / 2);
    const y = margin.top + plotH - h;
    const b = margin.top + plotH;
    return `M${x},${b}V${y + r}Q${x},${y} ${x + r},${y}H${x + barW - r}Q${x + barW},${y} ${x + barW},${y + r}V${b}Z`;
  };

  const table = (
    <table className="chart-table">
      <thead>
        <tr>
          <th>Day</th>
          <th>{valueLabel}</th>
        </tr>
      </thead>
      <tbody>
        {data.map((d) => (
          <tr key={d.key}>
            <td>{d.label}</td>
            <td>{d.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const activeDatum = active !== null ? data[active] : undefined;
  return (
    <ChartFrame title={title} {...(subtitle ? { subtitle } : {})} table={table}>
      <div className="chart__plot" ref={ref}>
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={title}
          onPointerLeave={() => setActive(null)}
        >
          <g className="grid">
            {[0, niceMax / 2, niceMax].map((v) => (
              <g key={v}>
                <line x1={margin.left} x2={margin.left + plotW} y1={sy(v)} y2={sy(v)} />
                <text x={margin.left - 6} y={sy(v)} dy="0.32em" textAnchor="end">
                  {Number.isInteger(v) ? v : v.toFixed(1)}
                </text>
              </g>
            ))}
          </g>
          {data.map((d, i) => {
            const x = margin.left + i * band + (band - barW) / 2;
            return (
              <g
                key={d.key}
                tabIndex={0}
                role="img"
                aria-label={`${d.label}: ${d.value} ${valueLabel}`}
                onPointerEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
              >
                <rect
                  x={margin.left + i * band}
                  y={margin.top}
                  width={band}
                  height={plotH}
                  fill="transparent"
                />
                <path className={`bar${active === i ? " is-active" : ""}`} d={bar(x, d.value)} />
                {i === maxIndex && d.value > 0 && (
                  <text
                    className="label-text"
                    x={x + barW / 2}
                    y={sy(d.value) - 5}
                    textAnchor="middle"
                    style={{ fontSize: 11 }}
                  >
                    {d.value}
                  </text>
                )}
                {i % labelEvery === 0 && (
                  <text
                    x={x + barW / 2}
                    y={height - 6}
                    textAnchor="middle"
                    style={{ fill: "var(--oe-color-text-muted)", fontSize: 11 }}
                  >
                    {d.label}
                  </text>
                )}
              </g>
            );
          })}
          <line
            x1={margin.left}
            x2={margin.left + plotW}
            y1={sy(0)}
            y2={sy(0)}
            stroke="var(--viz-axis)"
          />
        </svg>
        {activeDatum && (
          <div
            className="chart-tooltip"
            style={{
              left: Math.min(margin.left + (active ?? 0) * band + band, width - 160),
              top: margin.top,
            }}
          >
            <div className="chart-tooltip__date">{activeDatum.label}</div>
            <div className="chart-tooltip__row">
              <strong>{activeDatum.value}</strong>
              <span className="muted">{valueLabel}</span>
            </div>
          </div>
        )}
      </div>
    </ChartFrame>
  );
}
