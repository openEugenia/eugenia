/** Reading files chosen by the user. */
import { bytesToBase64 } from "@openeugenia/core";

export async function fileToBase64(file: File): Promise<string> {
  return bytesToBase64(new Uint8Array(await file.arrayBuffer()));
}

/** Safe file name for the repository (without path or reserved characters). */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
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
  return `${stem || "file"}${ext}`;
}
