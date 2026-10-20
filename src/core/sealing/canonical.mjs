/**
 * canonical.mjs — SECURITY-SENSITIVE: canonical JSON serialization (Promise Format v0.1).
 *
 * Like RFC 8785 (JCS) but stricter:
 *  - every string is normalized to Unicode NFC first (important for Bangla text);
 *  - object keys are sorted by UTF-16 code unit order;
 *  - no whitespace; arrays keep their order;
 *  - numbers must be safe integers only (floats, NaN, Infinity are rejected);
 *  - undefined values, functions, symbols, bigint, and non-plain objects are rejected.
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

function isPlainObject(value) {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function encodeString(str) {
  // Strings containing lone surrogates are rejected so the output is always
  // valid UTF-8. JSON.stringify escaping is deterministic across engines.
  if (/[\uD800-\uDFFF]/.test(str)) {
    throw new CanonicalError("strings containing lone surrogates are not allowed");
  }
  return JSON.stringify(str);
}

function describe(n) {
  if (typeof n !== "number") return String(n);
  if (Number.isNaN(n)) return "NaN";
  if (!Number.isFinite(n)) return n > 0 ? "Infinity" : "-Infinity";
  return String(n);
}

function encode(value, path) {
  if (value === null) return "null";

  const type = typeof value;

  if (type === "string") {
    return encodeString(value.normalize("NFC"));
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
    if (value.length === 0) return "[]";
    const items = [];
    for (let i = 0; i < value.length; i++) {
      if (i in value) {
        items.push(encode(value[i], `${path}[${i}]`));
      } else {
        throw new CanonicalError(`${path}[${i}]: missing array element (hole)`);
      }
    }
    return `[${items.join(",")}]`;
  }

  if (!isPlainObject(value)) {
    throw new CanonicalError(`${path}: only plain JSON objects are allowed (got a ${value.constructor?.name ?? "non-plain"} object)`);
  }

  const keys = Object.keys(value).sort(); // JS default sort = UTF-16 code unit order
  if (keys.length === 0) return "{}";
  const parts = [];
  for (const key of keys) {
    if (value[key] === undefined) {
      throw new CanonicalError(`${path}.${key}: property value is undefined (omit the key instead)`);
    }
    parts.push(`${encodeString(key.normalize("NFC"))}:${encode(value[key], `${path}.${key}`)}`);
  }
  return `{${parts.join(",")}}`;
}

/** Serialize a JSON-compatible value to its canonical string form. */
export function canonical(value) {
  return encode(value, "$");
}
