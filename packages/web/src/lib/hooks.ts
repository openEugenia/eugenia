/** Access to the wiki data from components. */
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { WikiNode } from "@openeugenia/core";
import { canEdit, useWiki } from "../store/wiki.ts";
import type { Derived } from "./workspace.ts";

export function useDerived(): Derived {
  const derived = useWiki((s) => s.derived);
  if (!derived) throw new Error("Wiki not loaded.");
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

/**
 * Brings the start of the referenced element to the top of the visible area, after the render
 * that follows each call to `reveal()`: used to show a new answer from Eugenia as soon as it
 * appears, without following the rest of the text while it is being read.
 */
export function useReveal<T extends HTMLElement>(): {
  ref: RefObject<T | null>;
  reveal: () => void;
} {
  const ref = useRef<T>(null);
  const [requests, setRequests] = useState(0);
  useEffect(() => {
    if (requests === 0) return;
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    ref.current?.scrollIntoView({ block: "start", behavior: still ? "auto" : "smooth" });
  }, [requests]);
  const reveal = useCallback(() => setRequests((n) => n + 1), []);
  return { ref, reveal };
}

export interface AsyncState<T> {
  data: T | undefined;
  loading: boolean;
  error: string | undefined;
}

/** Text content of a file of the working view; reloads when the wiki changes. */
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

/** Local URL (Blob object) of an attached file, released on unmount. */
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

/** Opens an attached file in a new tab. */
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
