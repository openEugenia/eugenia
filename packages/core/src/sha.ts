/** Git fingerprints: SHA-1 of a blob (`blob <size>\0<content>`), via WebCrypto. */

const encoder = new TextEncoder();

export function utf8(content: string): Uint8Array {
  return encoder.encode(content);
}

export async function gitBlobSha(content: string | Uint8Array): Promise<string> {
  const bytes = typeof content === "string" ? utf8(content) : content;
  const header = utf8(`blob ${bytes.byteLength}\0`);
  const buffer = new Uint8Array(header.byteLength + bytes.byteLength);
  buffer.set(header, 0);
  buffer.set(bytes, header.byteLength);
  const digest = await globalThis.crypto.subtle.digest("SHA-1", buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Short form stored in summaries (7 characters, like `git log --oneline`). */
export function shortSha(sha: string): string {
  return sha.slice(0, 7).toLowerCase();
}

/** Compares a stored fingerprint (possibly abbreviated) with a full SHA. */
export function shaMatches(stored: string | undefined, actual: string | undefined): boolean {
  if (!stored || !actual) return false;
  const s = String(stored).toLowerCase();
  return s.length >= 7 && actual.toLowerCase().startsWith(s);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
