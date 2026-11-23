/** POSIX path utilities with no Node dependency (usable in the browser). */

/** Normalizes a path: drops `.`, resolves `..`, removes extra `/`. */
export function normalizePath(path: string): string {
  const out: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
      else out.push("..");
      continue;
    }
    out.push(part);
  }
  return out.join("/");
}

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

export function basename(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? path : path.slice(i + 1);
}

export function extname(path: string): string {
  const base = basename(path);
  const i = base.lastIndexOf(".");
  return i <= 0 ? "" : base.slice(i).toLowerCase();
}

export function joinPath(...parts: string[]): string {
  return normalizePath(parts.filter((p) => p !== "").join("/"));
}

/** Relative path of `to` (file or folder) as seen from the folder `fromDir`. */
export function relativePath(fromDir: string, to: string): string {
  const a = fromDir === "" ? [] : fromDir.split("/");
  const b = to === "" ? [] : to.split("/");
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const parts = [...new Array<string>(a.length - i).fill(".."), ...b.slice(i)];
  return parts.length === 0 ? "." : parts.join("/");
}

/** True if `path` is `dir` or lies under `dir`. The root `""` contains everything. */
export function isUnder(dir: string, path: string): boolean {
  if (dir === "") return true;
  return path === dir || path.startsWith(dir + "/");
}

/** Replaces the `fromDir` prefix of `path` with `toDir`. */
export function rebase(path: string, fromDir: string, toDir: string): string {
  if (!isUnder(fromDir, path)) return path;
  const rest = fromDir === "" ? path : path.slice(fromDir.length).replace(/^\//, "");
  return joinPath(toDir, rest);
}

/** Segments of a path relative to `root`. */
export function segmentsUnder(root: string, path: string): string[] | null {
  if (!isUnder(root, path)) return null;
  const rest = root === "" ? path : path.slice(root.length).replace(/^\//, "");
  return rest === "" ? [] : rest.split("/");
}

/** True if a file or folder name is reserved for the application (`_x`, `.x`). */
export function isReservedName(name: string): boolean {
  return name.startsWith("_") || name.startsWith(".");
}
