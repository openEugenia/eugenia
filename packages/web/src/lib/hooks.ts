/** Accès aux données du wiki depuis les composants. */
import { useEffect, useState } from "react";
import type { WikiNode } from "@openeugenia/core";
import { canEdit, useWiki } from "../store/wiki.ts";
import type { Derived } from "./workspace.ts";

export function useDerived(): Derived {
  const derived = useWiki((s) => s.derived);
  if (!derived) throw new Error("Wiki non chargé.");
  return derived;
}

export function useNode(id: string | undefined): WikiNode | undefined {
  const derived = useWiki((s) => s.derived);
  if (!derived || !id) return undefined;
  return derived.tree.nodes.get(id);
}

export function useCanEdit(): boolean {
  return useWiki((s) => canEdit(s));
}

export function useIsOwner(): boolean {
  return useWiki((s) => s.workspace?.mode === "owner");
}

export interface AsyncState<T> {
  data: T | undefined;
  loading: boolean;
  error: string | undefined;
}

/** Contenu texte d'un fichier de la vue de travail ; se recharge quand le wiki change. */
export function useText(path: string | undefined): AsyncState<string> {
  const workspace = useWiki((s) => s.workspace);
  const version = useWiki((s) => s.version);
  const [state, setState] = useState<AsyncState<string>>({
    data: undefined,
    loading: Boolean(path),
    error: undefined,
  });
  useEffect(() => {
    if (!workspace || !path) {
      setState({ data: undefined, loading: false, error: undefined });
      return;
    }
    const known = workspace.peekText(path);
    if (known !== undefined) {
      setState({ data: known, loading: false, error: undefined });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: undefined }));
    workspace.readText(path).then(
      (data) => !cancelled && setState({ data, loading: false, error: undefined }),
      (error: unknown) =>
        !cancelled &&
        setState({
          data: undefined,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        }),
    );
    return () => {
      cancelled = true;
    };
  }, [workspace, path, version]);
  return state;
}

/** Adresse locale (objet Blob) d'un fichier joint, libérée au démontage. */
export function useBinaryUrl(path: string | undefined): AsyncState<string> {
  const workspace = useWiki((s) => s.workspace);
  const [state, setState] = useState<AsyncState<string>>({
    data: undefined,
    loading: Boolean(path),
    error: undefined,
  });
  useEffect(() => {
    if (!workspace || !path) return;
    const direct =
      workspace.backend.directUrl && !workspace.pending.changes[path]
        ? workspace.backend.directUrl(path)
        : undefined;
    if (direct) {
      setState({ data: direct, loading: false, error: undefined });
      return;
    }
    let url: string | undefined;
    let cancelled = false;
    workspace.readBinary(path).then(
      (blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setState({ data: url, loading: false, error: undefined });
      },
      (error: unknown) =>
        !cancelled &&
        setState({
          data: undefined,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        }),
    );
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [workspace, path]);
  return state;
}

/** Ouvre un fichier joint dans un nouvel onglet. */
export async function openAttachment(path: string): Promise<void> {
  const workspace = useWiki.getState().workspace;
  if (!workspace) return;
  const direct =
    workspace.backend.directUrl && !workspace.pending.changes[path]
      ? workspace.backend.directUrl(path)
      : undefined;
  if (direct) {
    window.open(direct, "_blank", "noopener");
    return;
  }
  const blob = await workspace.readBinary(path);
  const typed = blob.type
    ? blob
    : new Blob([blob], { type: (await import("./backend.ts")).mimeType(path) });
  const url = URL.createObjectURL(typed);
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
