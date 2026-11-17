/** Lecture de fichiers choisis par l'utilisateur. */
import { bytesToBase64 } from "@openeugenia/core";

export async function fileToBase64(file: File): Promise<string> {
  return bytesToBase64(new Uint8Array(await file.arrayBuffer()));
}

/** Nom de fichier sûr pour le dépôt (sans chemin ni caractères réservés). */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "fichier";
  const dot = base.lastIndexOf(".");
  const stem = (dot > 0 ? base.slice(0, dot) : base)
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-._]+|-+$/g, "")
    .slice(0, 60);
  const ext =
    dot > 0
      ? base
          .slice(dot)
          .toLowerCase()
          .replace(/[^.a-z0-9]/g, "")
      : "";
  return `${stem || "fichier"}${ext}`;
}
