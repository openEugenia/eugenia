/** Folder naming from titles (§5.2). */

const LIGATURES: Record<string, string> = {
  œ: "oe",
  Œ: "oe",
  æ: "ae",
  Æ: "ae",
  ß: "ss",
  ø: "o",
  Ø: "o",
  đ: "d",
  Đ: "d",
  ł: "l",
  Ł: "l",
  þ: "th",
  ð: "d",
};

export const FALLBACK_SLUG = "page";

/**
 * Derives a folder name from a title: lowercase, accents removed, non-alphanumeric
 * characters replaced with `-`, truncated to `maxLength` characters without cutting a word
 * when possible.
 */
export function slugify(title: string, maxLength = 32): string {
  let s = title.replace(/[œŒæÆßøØđĐłŁþð]/g, (c) => LIGATURES[c] ?? c);
  s = s.normalize("NFKD").replace(/\p{M}+/gu, "");
  s = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (s.length > maxLength) {
    const cut = s.slice(0, maxLength);
    const breaksWord = s[maxLength] !== "-";
    const lastDash = cut.lastIndexOf("-");
    // "When possible": back up to the last whole word; a first word longer than the
    // limit is cut.
    s = breaksWord && lastDash > 0 ? cut.slice(0, lastDash) : cut;
    s = s.replace(/-+$/g, "");
  }
  return s === "" ? FALLBACK_SLUG : s;
}

/** Adds a `-2`, `-3`… suffix if the name is already taken by a sibling. */
export function uniqueName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Folder name for a title. If the current name already matches the title (up to the
 * collision suffix) and is not taken by another sibling, it is kept.
 */
export function folderNameFor(
  title: string,
  taken: ReadonlySet<string>,
  maxLength = 32,
  current?: string,
): string {
  const base = slugify(title, maxLength);
  if (current !== undefined && !taken.has(current)) {
    if (current === base || new RegExp(`^${escapeRegExp(base)}-\\d+$`).test(current)) {
      return current;
    }
  }
  return uniqueName(base, taken);
}

/** Readable title from a folder name (pages without `index.md`). */
export function humanize(name: string): string {
  const s = name.replace(/[-_]+/g, " ").trim();
  return s === "" ? name : s.charAt(0).toUpperCase() + s.slice(1);
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
