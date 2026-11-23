/** ISO 8601 dates (UTC, to the second) used in frontmatters. */

export function isoTimestamp(date: Date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** `2026-11-17` (UTC). */
export function isoDay(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** `2026-11-17-1030` (UTC), for discussion file names. */
export function fileStamp(date: Date = new Date()): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}`;
}

export function parseTime(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const t = Date.parse(value);
  return Number.isNaN(t) ? undefined : t;
}
