/**
 * chain.mjs — SECURITY-SENSITIVE: promise version chains (Promise Format v0.1).
 *
 * A promise is identified by `promiseId`. Each version is an append-only record.
 * The version hash covers exactly these fields (the "hash" field itself is
 * excluded; "reason" is omitted from the object when absent):
 *
 *   hash = sha256(canonical({
 *     promiseId, electionId, candidateId, version, type, content,
 *     reason?, createdAt, prevHash
 *   }))
 *
 * See spec/promise-format.md for the exact rules and test vectors.
 */

import { canonical } from "./canonical.mjs";
import { sha256Hex, isHex64 } from "./hash.mjs";

/** The canonical pre-image object of a version's hash. */
export function versionHashObject(v) {
  const obj = {
    promiseId: v.promiseId,
    electionId: v.electionId,
    candidateId: v.candidateId,
    version: v.version,
    type: v.type,
    content: v.content,
    createdAt: v.createdAt,
    prevHash: v.prevHash,
  };
  if (v.reason !== undefined && v.reason !== null) obj.reason = v.reason;
  return obj;
}

/** Recompute the hash of a single promise version. */
export async function computeVersionHash(v) {
  return sha256Hex(canonical(versionHashObject(v)));
}

/** Group versions by promiseId, sorted by version number inside each group. */
export function groupByPromise(versions) {
  const groups = new Map();
  for (const v of versions) {
    if (!groups.has(v.promiseId)) groups.set(v.promiseId, []);
    groups.get(v.promiseId).push(v);
  }
  for (const list of groups.values()) {
    list.sort((a, b) => a.version - b.version);
  }
  return groups;
}

// Timestamps are compared as plain strings inside the chain rules, so the
// exact format must be enforced here too — verifyChain has to stay safe even
// when it is used WITHOUT JSON Schema validation.
const CREATED_AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/**
 * Structural shape check for one version, independent of the schema:
 *  - publish/amend: content must be a non-null object and reason absent/null;
 *  - withdraw:      content must be null and reason a non-null object.
 * Returns null when fine, otherwise a short reason string.
 */
export function versionShapeProblem(v) {
  if (v.type === "publish" || v.type === "amend") {
    if (v.content === null || typeof v.content !== "object" || Array.isArray(v.content)) {
      return `"${v.type}" requires a non-null object content`;
    }
    if (v.reason !== undefined && v.reason !== null) {
      return `"${v.type}" must not have a reason`;
    }
    return null;
  }
  if (v.type === "withdraw") {
    if (v.content !== null) return `"withdraw" requires content null`;
    if (v.reason === null || typeof v.reason !== "object" || Array.isArray(v.reason)) {
      return `"withdraw" requires a non-null reason object`;
    }
    return null;
  }
  return `unknown version type "${String(v.type)}"`;
}

function bad(brokenAtVersion, reason) {
  return { ok: false, brokenAtVersion, reason };
}

/**
 * Verify one promise's chain of versions. Never throws on bad data.
 * Rules (Promise Format v0.1):
 *  - all versions share the same electionId and candidateId;
 *  - contiguous versions 1..n, no duplicates;
 *  - version 1 has type "publish" and prevHash null;
 *  - every later version links via prevHash to the previous version's hash;
 *  - "publish" only allowed as version 1;
 *  - no versions after a "withdraw";
 *  - every stored hash recomputes correctly;
 *  - createdAt never decreases along the chain;
 *  - createdAt matches ^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$ exactly;
 *  - structural shape per type (see versionShapeProblem).
 * Returns { ok, brokenAtVersion, reason }.
 */
export async function verifyChain(chain) {
  if (!Array.isArray(chain) || chain.length === 0) {
    return bad(null, "empty chain");
  }
  const first = chain[0];
  let prev = null;
  for (let i = 0; i < chain.length; i++) {
    const v = chain[i];
    const expectedNumber = i + 1;
    if (v.electionId !== first.electionId || v.candidateId !== first.candidateId) {
      return bad(expectedNumber, "promise mixes candidates/elections");
    }
    if (!Number.isSafeInteger(v.version) || v.version !== expectedNumber) {
      return bad(expectedNumber, `version must be ${expectedNumber}, got ${JSON.stringify(v.version)}`);
    }
    if (typeof v.createdAt !== "string" || !CREATED_AT_RE.test(v.createdAt)) {
      return bad(expectedNumber, `createdAt must match YYYY-MM-DDTHH:mm:ssZ, got ${JSON.stringify(v.createdAt)}`);
    }
    const shape = versionShapeProblem(v);
    if (shape) return bad(expectedNumber, shape);
    if (i === 0) {
      if (v.type !== "publish") return bad(1, `first version must have type "publish", got "${v.type}"`);
      if (v.prevHash !== null) return bad(1, `version 1 must have prevHash null`);
    } else {
      if (v.type === "publish") return bad(v.version, `"publish" is only allowed as version 1`);
      if (prev && !isHex64(prev.hash)) {
        return bad(prev.version, `previous version hash is not 64-char lowercase hex`);
      }
      if (v.prevHash !== prev.hash) return bad(v.version, `prevHash does not match the previous version's hash`);
    }
    if (!isHex64(v.hash)) return bad(v.version, `hash is not 64-char lowercase hex`);
    const recomputed = await computeVersionHash(v);
    if (recomputed !== v.hash) return bad(v.version, `stored hash does not match recomputed hash (content tampered?)`);
    if (prev && String(v.createdAt) < String(prev.createdAt)) {
      return bad(v.version, `createdAt decreases along the chain`);
    }
    if (prev && prev.type === "withdraw") {
      return bad(v.version, `versions are not allowed after a "withdraw"`);
    }
    prev = v;
  }
  return { ok: true, brokenAtVersion: null, reason: null };
}

/** Verify every chain in a list of versions. Returns problems per promiseId. */
export async function verifyAllChains(versions) {
  const results = [];
  for (const [promiseId, chain] of groupByPromise(versions)) {
    const res = await verifyChain(chain);
    results.push({ promiseId, ...res });
  }
  return results;
}

/** Latest version of each promiseId among `versions` (assumes valid chains). */
export function latestVersions(versions) {
  const latest = new Map();
  for (const v of versions) {
    const cur = latest.get(v.promiseId);
    if (!cur || v.version > cur.version) latest.set(v.promiseId, v);
  }
  return latest;
}
