/**
 * Stockage local (IndexedDB) : copie hors ligne des wikis consultés, modifications en
 * attente, paramètres. Rien de tout cela ne quitte l'appareil.
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { DiscussionMeta, PageMeta, RepoFile } from "@openeugenia/core";
import type { PendingState } from "./pending.ts";
import type { Settings } from "./settings.ts";

export interface Snapshot {
  /** Dépôt réellement lu (le dépôt privé en mode propriétaire). */
  repo: string;
  mode: "owner" | "anonymous";
  branch: string;
  /** Commit lu (mode propriétaire). */
  headSha?: string;
  treeSha?: string;
  /** Le dépôt est privé (mode propriétaire) : écriture autorisée. */
  isPrivate?: boolean;
  files: RepoFile[];
  /** Métadonnées issues de `index.json` (mode anonyme). */
  metas?: Record<string, PageMeta>;
  /** Discussions publiées, d'après `index.json` (mode anonyme). */
  discussions?: Record<string, DiscussionMeta>;
  /** Dépôt public associé, si connu. */
  publicRepo?: string;
  fetchedAt: string;
}

export interface RecentWiki {
  key: string;
  repo: string;
  title: string;
  mode: "owner" | "anonymous";
  openedAt: string;
}

interface EugeniaDB extends DBSchema {
  blobs: {
    key: string;
    value: { key: string; repo: string; sha: string; content: string };
    indexes: { repo: string };
  };
  snapshots: { key: string; value: Snapshot };
  pending: { key: string; value: PendingState & { repo: string } };
  settings: { key: string; value: Settings };
  recents: { key: string; value: RecentWiki };
}

let dbPromise: Promise<IDBPDatabase<EugeniaDB>> | null = null;

export function db(): Promise<IDBPDatabase<EugeniaDB>> {
  dbPromise ??= openDB<EugeniaDB>("eugenia", 1, {
    upgrade(database) {
      const blobs = database.createObjectStore("blobs", { keyPath: "key" });
      blobs.createIndex("repo", "repo");
      database.createObjectStore("snapshots", { keyPath: "repo" });
      database.createObjectStore("pending", { keyPath: "repo" });
      database.createObjectStore("settings");
      database.createObjectStore("recents", { keyPath: "key" });
    },
  });
  return dbPromise;
}

const blobKey = (repo: string, sha: string): string => `${repo}|${sha}`;

export async function getBlobs(
  repo: string,
  shas: readonly string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (shas.length === 0) return out;
  const tx = (await db()).transaction("blobs");
  await Promise.all(
    shas.map(async (sha) => {
      const entry = await tx.store.get(blobKey(repo, sha));
      if (entry) out.set(sha, entry.content);
    }),
  );
  await tx.done;
  return out;
}

export async function putBlobs(repo: string, blobs: ReadonlyMap<string, string>): Promise<void> {
  if (blobs.size === 0) return;
  const tx = (await db()).transaction("blobs", "readwrite");
  await Promise.all(
    [...blobs].map(([sha, content]) =>
      tx.store.put({ key: blobKey(repo, sha), repo, sha, content }),
    ),
  );
  await tx.done;
}

export async function getSnapshot(repo: string): Promise<Snapshot | undefined> {
  return (await db()).get("snapshots", repo);
}

export async function putSnapshot(snapshot: Snapshot): Promise<void> {
  await (await db()).put("snapshots", snapshot);
}

export async function getPending(repo: string): Promise<PendingState | undefined> {
  const value = await (await db()).get("pending", repo);
  if (!value) return undefined;
  const { repo: _repo, ...state } = value;
  return state;
}

export async function putPending(repo: string, state: PendingState): Promise<void> {
  await (await db()).put("pending", { ...state, repo });
}

export async function getSettingsRecord(): Promise<Settings | undefined> {
  return (await db()).get("settings", "settings");
}

export async function putSettingsRecord(settings: Settings): Promise<void> {
  await (await db()).put("settings", settings, "settings");
}

export async function listRecents(): Promise<RecentWiki[]> {
  const all = await (await db()).getAll("recents");
  return all.sort((a, b) => b.openedAt.localeCompare(a.openedAt));
}

export async function putRecent(recent: RecentWiki): Promise<void> {
  await (await db()).put("recents", recent);
}

/** Oublie un wiki sur cet appareil : copie locale, modifications en attente, historique. */
export async function forgetRepo(repo: string): Promise<void> {
  const database = await db();
  const tx = database.transaction(["blobs", "snapshots", "pending", "recents"], "readwrite");
  const keys = await tx.objectStore("blobs").index("repo").getAllKeys(repo);
  await Promise.all([
    ...keys.map((key) => tx.objectStore("blobs").delete(key)),
    tx.objectStore("snapshots").delete(repo),
    tx.objectStore("pending").delete(repo),
    tx.objectStore("recents").delete(repo),
  ]);
  await tx.done;
}

/** Taille approximative de la copie locale d'un wiki (octets). */
export async function localSize(repo: string): Promise<number> {
  const entries = await (await db()).getAllFromIndex("blobs", "repo", repo);
  return entries.reduce((n, e) => n + e.content.length * 2, 0);
}
