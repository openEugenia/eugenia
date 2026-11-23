/** Text normalization for comparisons (without accents, in lowercase). */
export function normalizeTerm(term: string): string {
  return term
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase();
}
