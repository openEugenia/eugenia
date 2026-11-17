/** Identifiants ULID : 48 bits d'horodatage + 80 bits aléatoires, en base32 de Crockford. */

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

export function ulid(time: number = Date.now(), random?: Uint8Array): string {
  let t = Math.floor(time);
  let timePart = "";
  for (let i = 0; i < 10; i++) {
    timePart = ENCODING[t % 32]! + timePart;
    t = Math.floor(t / 32);
  }
  const bytes = random ?? globalThis.crypto.getRandomValues(new Uint8Array(16));
  let randomPart = "";
  // 256 est un multiple de 32 : le modulo n'introduit aucun biais.
  for (let i = 0; i < 16; i++) randomPart += ENCODING[(bytes[i] ?? 0) % 32]!;
  return timePart + randomPart;
}

export function isUlid(value: unknown): value is string {
  return typeof value === "string" && ULID_RE.test(value);
}

/** Date encodée dans un ULID. */
export function ulidTime(id: string): number {
  let t = 0;
  for (const c of id.slice(0, 10)) t = t * 32 + ENCODING.indexOf(c);
  return t;
}
