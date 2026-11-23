/**
 * State of the open wiki: loading (online or from the local copy), pending changes, commits
 * and synchronization (§10).
 */
import { create } from "zustand";
import { gitBlobSha, type FileChange } from "@openeugenia/core";
import {
  AnonymousBackend,
  OwnerBackend,
  pushCommit,
  resolveSource,
  type Backend,
  type ResolvedSource,
} from "../lib/backend.ts";
import {
  forgetRepo,
  getPending,
  getSnapshot,
  putPending,
  putRecent,
  putSnapshot,
  type Snapshot,
} from "../lib/db.ts";
import { GitHubError } from "../lib/github.ts";
import {
  discardChanges,
  emptyPending,
  generatedMessage,
  queueCommit,
  stageChanges,
  uncommittedPaths,
  type PendingState,
} from "../lib/pending.ts";
import { repoKey, repoLabel, type RepoRef } from "../lib/repo.ts";
import { Workspace, type Derived } from "../lib/workspace.ts";
import { useSettings } from "./settings.ts";
import { errorMessage, toast } from "./ui.ts";

export type Status = "idle" | "loading" | "ready" | "error";

export type ConflictResolution =
  { kind: "local" } | { kind: "remote" } | { kind: "merged"; content: string };

interface WikiState {
  requested: RepoRef | null;
  resolved: ResolvedSource | null;
  workspace: Workspace | null;
  derived: Derived | null;
  pending: PendingState;
  version: number;
  status: Status;
  message: string | null;
  error: string | null;
  /** Showing the local copy, for lack of network. */
  offline: boolean;
  online: boolean;
  syncing: boolean;

  open(ref: RepoRef): Promise<void>;
  close(): void;
  refresh(): Promise<void>;
  stage(changes: readonly FileChange[], description: string): Promise<void>;
  commit(message?: string, paths?: readonly string[]): Promise<void>;
  flush(): Promise<void>;
  discard(paths?: readonly string[]): Promise<void>;
  resolveConflict(path: string, resolution: ConflictResolution): Promise<void>;
  forget(): Promise<void>;
}

const QUIZ_PATH = /\/_quizzes\/[^/]+\.md$/;

/** Owner mode keeps local writing offline (queue). */
export function canEdit(state: Pick<WikiState, "resolved" | "workspace">): boolean {
  return state.workspace?.mode === "owner" && (state.resolved?.canWrite ?? false);
}

export const useWiki = create<WikiState>((set, get) => {
  let openToken = 0;

  async function rederive(): Promise<void> {
    const ws = get().workspace;
    if (!ws) return;
    const derived = await ws.derive();
    set((s) => ({ derived, pending: ws.pending, version: s.version + 1 }));
  }

  async function savePending(ws: Workspace, pending: PendingState): Promise<void> {
    ws.update(ws.snapshot, pending);
    await putPending(ws.key, pending);
  }

  return {
    requested: null,
    resolved: null,
    workspace: null,
    derived: null,
    pending: emptyPending(),
    version: 0,
    status: "idle",
    message: null,
    error: null,
    offline: false,
    online: typeof navigator === "undefined" ? true : navigator.onLine,
    syncing: false,

    async open(ref) {
      const token = ++openToken;
      const stale = (): boolean => token !== openToken;
      set({
        requested: ref,
        status: "loading",
        message: "Connecting to the repository…",
        error: null,
        workspace: null,
        derived: null,
        resolved: null,
        offline: false,
      });
      const settings = useSettings.getState().settings;
      let resolved: ResolvedSource | null = null;
      let networkError: unknown = null;
      try {
        resolved = await resolveSource(ref, settings.githubToken);
      } catch (error) {
        networkError = error;
      }
      if (stale()) return;

      // Offline (or GitHub unreachable): local copy if there is one.
      let cached: Snapshot | undefined;
      if (!resolved) {
        cached = await getSnapshot(repoKey(ref)).catch(() => undefined);
        if (!cached) {
          set({
            status: "error",
            error:
              networkError instanceof GitHubError && networkError.code !== "network"
                ? networkError.message
                : `Cannot reach GitHub, and there is no local copy of ${repoLabel(ref)} on this device.`,
          });
          return;
        }
        resolved = {
          mode: cached.mode,
          source: ref,
          branch: cached.branch,
          isPrivate: cached.isPrivate ?? false,
          canWrite: cached.mode === "owner" && (cached.isPrivate ?? false),
        };
      }

      const key = repoKey(resolved.source);
      let backend: Backend;
      if (resolved.mode === "owner" && settings.githubToken)
        backend = new OwnerBackend(resolved, settings.githubToken);
      else backend = new AnonymousBackend(resolved.source);
      cached ??= await getSnapshot(key).catch(() => undefined);
      const pending = (await getPending(key).catch(() => undefined)) ?? emptyPending();
      if (stale()) return;

      // Show the local copy right away, then update it from the network.
      if (cached && cached.mode === resolved.mode) {
        const ws = new Workspace(key, cached, pending, backend);
        try {
          const derived = await ws.derive();
          if (stale()) return;
          set((s) => ({
            resolved,
            workspace: ws,
            derived,
            pending,
            status: "ready",
            message: null,
            offline: networkError !== null,
            version: s.version + 1,
          }));
        } catch {
          // incomplete local copy: wait for the network
        }
      }
      if (networkError !== null) {
        if (get().status !== "ready") set({ status: "error", error: errorMessage(networkError) });
        return;
      }

      try {
        set({ message: "Reading the tree…" });
        const snapshot = await backend.fetchSnapshot(
          cached?.mode === resolved.mode ? cached : undefined,
        );
        if (stale()) return;
        await putSnapshot(snapshot);
        const ws =
          get().workspace?.key === key
            ? get().workspace!
            : new Workspace(key, snapshot, pending, backend);
        ws.update(snapshot, ws.pending);
        set({ message: "Loading the pages…" });
        const derived = await ws.derive();
        if (stale()) return;
        set((s) => ({
          resolved,
          workspace: ws,
          derived,
          pending: ws.pending,
          status: "ready",
          message: null,
          offline: false,
          version: s.version + 1,
        }));
        await putRecent({
          key,
          repo: repoLabel(ref),
          title: derived.config.title,
          mode: resolved.mode,
          openedAt: new Date().toISOString(),
        }).catch(() => undefined);
        // Interrupted quizzes (page closed): automatic commit.
        const orphanQuizzes = uncommittedPaths(ws.pending).filter((p) => QUIZ_PATH.test(p));
        if (orphanQuizzes.length > 0)
          await get().commit("Interrupted quiz: saving the answers", orphanQuizzes);
        else if (ws.pending.queue.length > 0) await get().flush();
      } catch (error) {
        if (stale()) return;
        if (get().status === "ready") {
          set({ offline: true });
          toast(`Showing the local copy: ${errorMessage(error)}`, "error");
        } else {
          set({ status: "error", error: errorMessage(error), message: null });
        }
      }
    },

    close() {
      openToken++;
      set({
        requested: null,
        resolved: null,
        workspace: null,
        derived: null,
        status: "idle",
        error: null,
        message: null,
      });
    },

    async refresh() {
      const ws = get().workspace;
      if (!ws || !get().online) return;
      try {
        const snapshot = await ws.backend.fetchSnapshot(ws.snapshot);
        await putSnapshot(snapshot);
        ws.update(snapshot, ws.pending);
        await rederive();
        set({ offline: false });
      } catch (error) {
        toast(`Cannot refresh: ${errorMessage(error)}`, "error");
      }
    },

    async stage(changes, description) {
      const ws = get().workspace;
      if (!ws || !canEdit(get())) throw new Error("This wiki is read-only.");
      const remote = new Map(ws.snapshot.files.map((f) => [f.path, f]));
      const pending = await stageChanges(ws.pending, changes, remote, description);
      await savePending(ws, pending);
      await rederive();
    },

    async commit(message, paths) {
      const ws = get().workspace;
      if (!ws) return;
      const text = message?.trim() || generatedMessage(ws.pending, paths);
      const pending = queueCommit(ws.pending, text, paths);
      if (pending === ws.pending) return;
      await savePending(ws, pending);
      set({ pending });
      if (get().online) await get().flush();
      else toast("Offline: the commit will be sent when the network is back.");
    },

    async flush() {
      const state = get();
      const ws = state.workspace;
      if (
        !ws ||
        state.syncing ||
        !state.online ||
        !(ws.backend instanceof OwnerBackend) ||
        !canEdit(state)
      )
        return;
      if (ws.pending.queue.length === 0 || ws.pending.conflicts.length > 0) return;
      set({ syncing: true });
      let pending = ws.pending;
      let committedCount = 0;
      try {
        while (pending.queue.length > 0 && pending.conflicts.length === 0) {
          const commit = pending.queue[0]!;
          const outcome = await pushCommit(ws.backend, ws.snapshot, pending, commit);
          if (outcome.status === "conflicts") {
            pending = { ...pending, conflicts: outcome.conflicts };
            ws.update(outcome.snapshot, pending);
            await putSnapshot(outcome.snapshot);
            await putPending(ws.key, pending);
            toast(`${outcome.conflicts.length} conflict(s) to resolve before saving.`, "error");
            break;
          }
          await ws.remember(outcome.committed);
          const changes = { ...pending.changes };
          for (const path of commit.paths) delete changes[path];
          pending = {
            ...pending,
            changes,
            queue: pending.queue.slice(1),
            log: pending.log
              .map((e) => ({ ...e, paths: e.paths.filter((p) => p in changes) }))
              .filter((e) => e.paths.length > 0),
            lastSyncAt: new Date().toISOString(),
          };
          delete pending.lastError;
          ws.update(outcome.snapshot, pending);
          await putSnapshot(outcome.snapshot);
          await putPending(ws.key, pending);
          committedCount++;
        }
        if (committedCount > 0)
          toast(
            committedCount === 1
              ? "Changes saved to the repository."
              : `${committedCount} commits saved.`,
            "success",
          );
      } catch (error) {
        pending = { ...pending, lastError: errorMessage(error) };
        await savePending(ws, pending);
        toast(`Cannot synchronize: ${errorMessage(error)}`, "error");
      } finally {
        set({ syncing: false });
        await rederive();
      }
    },

    async discard(paths) {
      const ws = get().workspace;
      if (!ws) return;
      await savePending(ws, discardChanges(ws.pending, paths));
      await rederive();
    },

    async resolveConflict(path, resolution) {
      const ws = get().workspace;
      if (!ws) return;
      const conflict = ws.pending.conflicts.find((c) => c.path === path);
      if (!conflict) return;
      let pending: PendingState = {
        ...ws.pending,
        changes: { ...ws.pending.changes },
        conflicts: ws.pending.conflicts.filter((c) => c.path !== path),
      };
      const change = pending.changes[path];
      if (resolution.kind === "remote" || !change) {
        pending = discardChanges(pending, [path]);
      } else if (resolution.kind === "local") {
        pending.changes[path] = { ...change, baseSha: conflict.remoteSha };
      } else {
        pending.changes[path] = {
          path,
          kind: "write",
          content: resolution.content,
          sha: await gitBlobSha(resolution.content),
          baseSha: conflict.remoteSha,
          updatedAt: new Date().toISOString(),
        };
      }
      await savePending(ws, pending);
      await rederive();
      if (pending.conflicts.length === 0) await get().flush();
    },

    async forget() {
      const ws = get().workspace;
      if (!ws) return;
      await forgetRepo(ws.key);
      if (get().requested && repoKey(get().requested!) !== ws.key)
        await forgetRepo(repoKey(get().requested!));
      get().close();
    },
  };
});

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    useWiki.setState({ online: true });
    void useWiki
      .getState()
      .refresh()
      .then(() => useWiki.getState().flush());
  });
  window.addEventListener("offline", () => useWiki.setState({ online: false }));
}
