import { randomBytes, randomUUID } from "node:crypto";

/** No 0/O/1/I/L: avoids characters that are easy to mishear or misread aloud. */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export function randomCode(length = 4): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

/** Spells a code with spaces for speech, e.g. "CNQE" -> "C N Q E". */
export function speakCode(code: string): string {
  return code.split("").join(" ");
}
