/**
 * hash.mjs — SECURITY-SENSITIVE: SHA-256 helper.
 *
 * Uses globalThis.crypto.subtle.digest so the exact same code runs on Node 20+
 * and in browsers. Output is lowercase hex. All hashing functions are async.
 */

const encoder = new TextEncoder();

/** sha256 over the UTF-8 bytes of `text`, as 64-char lowercase hex. */
export async function sha256Hex(text) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(text));
  return toHex(digest);
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export const HEX64 = /^[0-9a-f]{64}$/;

export function isHex64(value) {
  return typeof value === "string" && HEX64.test(value);
}
