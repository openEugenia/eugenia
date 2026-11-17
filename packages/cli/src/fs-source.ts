/** Lecture d'un wiki sur disque (dépôt git local ou dossier extrait). */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import {
  gitBlobSha,
  loadWiki,
  type LoadedWiki,
  type RepoFile,
  type WikiView,
} from "@openeugenia/core";

const IGNORED_DIRS = new Set([".git", "node_modules"]);

export interface DiskWiki extends LoadedWiki {
  dir: string;
  view: WikiView;
  readText(path: string): Promise<string>;
  readBytes(path: string): Promise<Uint8Array>;
}

/** Liste récursive des fichiers, chemins POSIX relatifs au dossier. */
export async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (current: string): Promise<void> => {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) await walk(full);
      } else if (entry.isFile()) {
        out.push(relative(dir, full).split(sep).join("/"));
      }
    }
  };
  await walk(dir);
  return out.sort();
}

export async function repoFiles(dir: string): Promise<RepoFile[]> {
  const paths = await listFiles(dir);
  return Promise.all(
    paths.map(async (path) => {
      const bytes = await readFile(join(dir, path));
      return { path, sha: await gitBlobSha(bytes), size: bytes.byteLength };
    }),
  );
}

export async function loadDiskWiki(dir: string): Promise<DiskWiki> {
  const info = await stat(dir).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`Dossier introuvable : ${dir}`);
  const files = await repoFiles(dir);
  const cache = new Map<string, string>();
  const readText = async (path: string): Promise<string> => {
    const cached = cache.get(path);
    if (cached !== undefined) return cached;
    const text = await readFile(join(dir, path), "utf8");
    cache.set(path, text);
    return text;
  };
  const readBytes = async (path: string): Promise<Uint8Array> => readFile(join(dir, path));
  const wiki = await loadWiki({ files, readText });
  return {
    ...wiki,
    dir,
    readText,
    readBytes,
    view: { config: wiki.config, tree: wiki.tree, files: wiki.files, readText },
  };
}
