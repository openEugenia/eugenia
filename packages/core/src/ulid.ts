/** ULID identifiers: 48-bit timestamp + 80 random bits, in Crockford's base32. */

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
  // 256 is a multiple of 32: the modulo introduces no bias.
  for (let i = 0; i < 16; i++) randomPart += ENCODING[(bytes[i] ?? 0) % 32]!;
  return timePart + randomPart;
}

export function isUlid(value: unknown): value is string {
  return typeof value === "string" && ULID_RE.test(value);
}

/** Date encoded in a ULID. */
export function ulidTime(id: string): number {
  let t = 0;
  for (const c of id.slice(0, 10)) t = t * 32 + ENCODING.indexOf(c);
  return t;
}
