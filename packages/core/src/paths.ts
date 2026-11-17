/** Utilitaires de chemins POSIX, sans dépendance à Node (utilisables dans le navigateur). */

/** Normalise un chemin : supprime `.`, résout `..`, retire les `/` superflus. */
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

/** Chemin relatif de `to` (fichier ou dossier) vu depuis le dossier `fromDir`. */
export function relativePath(fromDir: string, to: string): string {
  const a = fromDir === "" ? [] : fromDir.split("/");
  const b = to === "" ? [] : to.split("/");
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const parts = [...new Array<string>(a.length - i).fill(".."), ...b.slice(i)];
  return parts.length === 0 ? "." : parts.join("/");
}

/** Vrai si `path` est `dir` ou se trouve sous `dir`. La racine `""` contient tout. */
export function isUnder(dir: string, path: string): boolean {
  if (dir === "") return true;
  return path === dir || path.startsWith(dir + "/");
}

/** Remplace le préfixe `fromDir` de `path` par `toDir`. */
export function rebase(path: string, fromDir: string, toDir: string): string {
  if (!isUnder(fromDir, path)) return path;
  const rest = fromDir === "" ? path : path.slice(fromDir.length).replace(/^\//, "");
  return joinPath(toDir, rest);
}

/** Segments d'un chemin relatif à `root`. */
export function segmentsUnder(root: string, path: string): string[] | null {
  if (!isUnder(root, path)) return null;
  const rest = root === "" ? path : path.slice(root.length).replace(/^\//, "");
  return rest === "" ? [] : rest.split("/");
}

/** Vrai si un nom de fichier ou de dossier est réservé à l'application (`_x`, `.x`). */
export function isReservedName(name: string): boolean {
  return name.startsWith("_") || name.startsWith(".");
}
