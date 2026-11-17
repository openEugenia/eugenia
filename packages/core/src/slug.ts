/** Nommage des dossiers à partir des titres (§5.2). */

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
 * Dérive un nom de dossier d'un titre : minuscules, sans accents, caractères non
 * alphanumériques remplacés par `-`, tronqué à `maxLength` caractères sans couper un
 * mot lorsque c'est possible.
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
    // « Si possible » : on recule jusqu'au dernier mot entier ; un premier mot plus
    // long que la limite est coupé.
    s = breaksWord && lastDash > 0 ? cut.slice(0, lastDash) : cut;
    s = s.replace(/-+$/g, "");
  }
  return s === "" ? FALLBACK_SLUG : s;
}

/** Ajoute un suffixe `-2`, `-3`… si le nom est déjà pris par un frère. */
export function uniqueName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Nom de dossier pour un titre. Si le nom actuel correspond déjà au titre (au suffixe
 * de collision près) et n'est pas pris par un autre frère, il est conservé.
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

/** Titre lisible à partir d'un nom de dossier (pages sans `index.md`). */
export function humanize(name: string): string {
  const s = name.replace(/[-_]+/g, " ").trim();
  return s === "" ? name : s.charAt(0).toUpperCase() + s.slice(1);
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
