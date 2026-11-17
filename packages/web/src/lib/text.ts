/** Normalisation de texte pour les comparaisons (sans accents, en minuscules). */
export function normalizeTerm(term: string): string {
  return term
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase();
}
