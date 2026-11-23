import {
  gitBlobSha,
  loadWiki,
  type FileChange,
  type LoadedWiki,
  type RepoFile,
  type WikiView,
} from "../src/index.ts";

export type Files = Record<string, string>;

export interface MemoryWiki extends LoadedWiki {
  view: WikiView;
  readText: (path: string) => Promise<string>;
  source: Files;
}

/** In-memory wiki: path → content. */
export async function memoryWiki(source: Files): Promise<MemoryWiki> {
  const files: RepoFile[] = await Promise.all(
    Object.entries(source).map(async ([path, content]) => ({
      path,
      sha: await gitBlobSha(content),
    })),
  );
  const readText = async (path: string): Promise<string> => {
    const content = source[path];
    if (content === undefined) throw new Error(`Missing file: ${path}`);
    return content;
  };
  const loaded = await loadWiki({ files, readText });
  return {
    ...loaded,
    readText,
    source,
    view: { config: loaded.config, tree: loaded.tree, files: loaded.files, readText },
  };
}

/** Applies changes to an in-memory set of files. */
export function applyChanges(source: Files, changes: readonly FileChange[]): Files {
  const out: Files = { ...source };
  const written = new Set<string>();
  for (const change of changes) {
    if (change.op === "write") {
      out[change.path] = change.content;
      written.add(change.path);
    } else if (change.op === "copy") {
      out[change.path] = source[change.from]!;
      written.add(change.path);
    } else if (change.op === "write-binary") {
      out[change.path] = atob(change.base64);
      written.add(change.path);
    }
  }
  for (const change of changes) {
    if (change.op === "delete" && !written.has(change.path)) delete out[change.path];
  }
  return out;
}

export function page(fields: Record<string, unknown>, body = ""): string {
  const lines = Object.entries(fields).map(([k, v]) =>
    Array.isArray(v) ? `${k}: [${v.join(", ")}]` : `${k}: ${String(v)}`,
  );
  return `---\n${lines.join("\n")}\n---\n${body ? `\n${body}\n` : ""}`;
}

export const CONFIG = "title: Test wiki\nroot: wiki/\n";
