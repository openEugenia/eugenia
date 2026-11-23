/** Formatting (English). */

const LOCALE = "en";

const dateFormat = new Intl.DateTimeFormat(LOCALE, {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const shortDate = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "short" });
const dateTime = new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium", timeStyle: "short" });
const relative = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });
const integer = new Intl.NumberFormat(LOCALE);

export function formatDate(value: string | number | Date | undefined): string {
  if (value === undefined) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : dateFormat.format(date);
}

export function formatShortDate(value: string | number | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : shortDate.format(date);
}

export function formatDateTime(value: string | number | Date | undefined): string {
  if (value === undefined) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : dateTime.format(date);
}

export function formatRelative(value: string | undefined): string {
  if (!value) return "";
  const t = Date.parse(value);
  if (Number.isNaN(t)) return "";
  const seconds = Math.round((t - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return relative.format(seconds, "second");
  if (abs < 3600) return relative.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return relative.format(Math.round(seconds / 3600), "hour");
  if (abs < 86400 * 30) return relative.format(Math.round(seconds / 86400), "day");
  return formatDate(value);
}

export function formatPercent(value: number | undefined, digits = 0): string {
  if (value === undefined || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatInteger(value: number): string {
  return integer.format(value);
}

/** `1 source`, `0 sources`, `2 sources`; irregular plurals are given explicitly. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${formatInteger(count)} ${count === 1 ? singular : pluralForm}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
