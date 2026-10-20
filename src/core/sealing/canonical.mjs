/**
 * canonical.mjs — SECURITY-SENSITIVE: canonical JSON serialization (Promise Format v0.1).
 *
 * Like RFC 8785 (JCS) but stricter:
 *  - every string is normalized to Unicode NFC first (important for Bangla text);
 *  - object keys are sorted by UTF-16 code unit order;
 *  - no whitespace; arrays keep their order;
 *  - numbers must be safe integers only (floats, NaN, Infinity are rejected);
 *  - undefined values, functions, symbols, bigint, and non-plain objects are rejected;
 *  - lone surrogates are rejected (valid surrogate pairs, e.g. emoji, are fine);
 *  - object keys are normalized to NFC BEFORE sorting; two keys that collide
 *    after normalization are rejected;
 *  - circular structures and nesting deeper than 100 levels are rejected with a
 *    CanonicalError (never a stack overflow).
 *
 * Throws CanonicalError on any violation. The same rules must apply in every
 * language re-implementation (see spec/promise-format.md).
 */

export class CanonicalError extends Error {
  constructor(message) {
    super(message);
    this.name = "CanonicalError";
  }
}

const MAX_DEPTH = 100;

// Matches a high surrogate NOT followed by a low surrogate, or a low surrogate
// NOT preceded by a high surrogate — i.e. LONE surrogates only. Valid surrogate
// pairs (emoji, rare characters) do not match. Re-implementation note: use your
// platform's well-formedness check (JS: String.prototype.isWellFormed()).
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function isPlainObject(value) {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertNoLoneSurrogate(str, what) {
  const bad = typeof str.isWellFormed === "function" ? !str.isWellFormed() : LONE_SURROGATE.test(str);
  if (bad) {
    throw new CanonicalError(`${what}: string contains a lone surrogate and cannot be encoded as valid UTF-8`);
  }
}

function describe(n) {
  if (typeof n !== "number") return String(n);
  if (Number.isNaN(n)) return "NaN";
  if (!Number.isFinite(n)) return n > 0 ? "Infinity" : "-Infinity";
  return String(n);
}

function encode(value, path, seen, depth) {
  if (depth > MAX_DEPTH) {
    throw new CanonicalError(`${path}: nesting deeper than ${MAX_DEPTH} levels is not allowed`);
  }
  if (value === null) return "null";

  const type = typeof value;

  if (type === "string") {
    assertNoLoneSurrogate(value, path);
    return JSON.stringify(value.normalize("NFC"));
  }
  if (type === "boolean") {
    return value ? "true" : "false";
  }
  if (type === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new CanonicalError(`${path}: number ${describe(value)} is not a safe integer (floats, NaN and Infinity are rejected)`);
    }
    return String(value);
  }
  if (type === "undefined" || type === "function" || type === "symbol" || type === "bigint") {
    throw new CanonicalError(`${path}: value of type "${type}" is not allowed in canonical JSON`);
  }
  if (type !== "object") {
    throw new CanonicalError(`${path}: unsupported type "${type}"`);
  }

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new CanonicalError(`${path}: circular structure detected`);
    }
    seen.add(value);
    if (value.length === 0) {
      seen.delete(value);
      return "[]";
    }
    const items = [];
    for (let i = 0; i < value.length; i++) {
      if (i in value) {
        items.push(encode(value[i], `${path}[${i}]`, seen, depth + 1));
      } else {
        throw new CanonicalError(`${path}[${i}]: missing array element (hole)`);
      }
    }
    seen.delete(value);
    return `[${items.join(",")}]`;
  }

  if (!isPlainObject(value)) {
    throw new CanonicalError(`${path}: only plain JSON objects are allowed (got a ${value.constructor?.name ?? "non-plain"} object)`);
  }

  if (seen.has(value)) {
    throw new CanonicalError(`${path}: circular structure detected`);
  }
  seen.add(value);

  // Keys are normalized to NFC BEFORE sorting so the order is deterministic
  // for every re-implementation; keys that collide after normalization would
  // silently overwrite data, so they are rejected.
  const normKeys = Object.keys(value).map((k) => {
    assertNoLoneSurrogate(k, `${path}: object key`);
    return k.normalize("NFC");
  });
  normKeys.sort(); // JS default sort = UTF-16 code unit order
  for (let i = 1; i < normKeys.length; i++) {
    if (normKeys[i] === normKeys[i - 1]) {
      throw new CanonicalError(`${path}: two object keys become equal after NFC normalization ("${normKeys[i]}")`);
    }
  }
  const originalByKey = new Map();
  for (const k of Object.keys(value)) {
    const nk = k.normalize("NFC");
    if (!originalByKey.has(nk)) originalByKey.set(nk, k);
  }
  if (normKeys.length === 0) {
    seen.delete(value);
    return "{}";
  }
  const parts = [];
  for (const key of normKeys) {
    const origKey = originalByKey.get(key);
    if (value[origKey] === undefined) {
      throw new CanonicalError(`${path}.${key}: property value is undefined (omit the key instead)`);
    }
    parts.push(`${JSON.stringify(key)}:${encode(value[origKey], `${path}.${key}`, seen, depth + 1)}`);
  }
  const out = `{${parts.join(",")}}`;
  seen.delete(value);
  return out;
}

/** Serialize a JSON-compatible value to its canonical string form. */
export function canonical(value) {
  return encode(value, "$", new Set(), 0);
}
