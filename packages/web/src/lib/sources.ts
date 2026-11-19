/** Sources citées par une connaissance : création à la volée de nouvelles sources de la bibliothèque. */
import {
  createPage,
  type FileChange,
  type SourceKind,
  type SourceRef,
  type WikiView,
} from "@openeugenia/core";

/** Source à créer dans la bibliothèque au moment de l'enregistrement. */
export interface NewSourceDraft {
  /** Référence provisoire utilisée dans la liste des sources (`new:…`). */
  key: string;
  title: string;
  kind: SourceKind;
  url: string;
  authors: string;
}

export const NEW_SOURCE_PREFIX = "new:";

let counter = 0;
export function newSourceKey(): string {
  counter += 1;
  return `${NEW_SOURCE_PREFIX}${Date.now().toString(36)}${counter}`;
}

export function splitList(text: string): string[] {
  return text
    .split(/[,;]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Nettoie une liste de références (champs vides retirés, références vides écartées). */
export function cleanSourceRefs(sources: readonly SourceRef[]): SourceRef[] {
  return sources
    .map(
      (s) =>
        Object.fromEntries(
          Object.entries(s).filter(([, v]) => typeof v === "string" && v.trim() !== ""),
        ) as SourceRef,
    )
    .filter((s) => s.ref || s.description || s.url);
}

/**
 * Crée les nouvelles sources référencées et remplace leurs références provisoires par leur
 * identifiant. `reserved` reçoit les chemins créés (collisions de noms dans un même lot).
 */
export function materializeSources(
  view: Pick<WikiView, "config" | "files" | "tree">,
  sources: readonly SourceRef[],
  drafts: readonly NewSourceDraft[],
  reserved: string[],
): { sources: SourceRef[]; changes: FileChange[] } {
  const library = view.tree.nodes.get(view.tree.libraryId)!;
  const ids = new Map<string, string>();
  const changes: FileChange[] = [];
  for (const draft of drafts) {
    if (!sources.some((s) => s.ref === draft.key) || !draft.title.trim()) continue;
    const created = createPage(
      view,
      {
        parentPath: library.path,
        parentIsPublic: library.isPublic,
        title: draft.title,
        type: "source",
        kind: draft.kind,
        authors: splitList(draft.authors),
        ...(draft.url.trim() ? { url: draft.url.trim() } : {}),
      },
      reserved,
    );
    reserved.push(created.indexPath);
    changes.push(created.change);
    ids.set(draft.key, created.id);
  }
  const resolved = cleanSourceRefs(
    sources
      .filter((s) => !s.ref?.startsWith(NEW_SOURCE_PREFIX) || ids.has(s.ref))
      .map((s) => (s.ref && ids.has(s.ref) ? { ...s, ref: ids.get(s.ref)! } : s)),
  );
  return { sources: resolved, changes };
}
