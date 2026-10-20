/**
 * seal.mjs — SECURITY-SENSITIVE: create and verify seals (Promise Format v0.1).
 *
 * A seal freezes the state of one candidate's promises in one election at a
 * point in time:
 *  - promiseHeads = latest version of every promise of that candidate/election
 *    as of `sealedAt` (a withdrawn promise's head is its withdraw version),
 *    sorted by promiseId;
 *  - merkleRoot   = Merkle root over those heads;
 *  - sealHash     = sha256(canonical({id, kind, electionId, candidateId,
 *                    sealedAt, promiseHeads, merkleRoot, prevSealHash})).
 *
 * Only ONE "final" seal per candidate per election is allowed.
 */

import { canonical } from "./canonical.mjs";
import { sha256Hex, isHex64 } from "./hash.mjs";
import { computeVersionHash, verifyChain, groupByPromise } from "./chain.mjs";
import { merkleLeaf, merkleRoot, sortHeads } from "./merkle.mjs";

/** The canonical pre-image object of a seal's hash. */
export function sealHashObject(seal) {
  return {
    id: seal.id,
    kind: seal.kind,
    electionId: seal.electionId,
    candidateId: seal.candidateId,
    sealedAt: seal.sealedAt,
    promiseHeads: seal.promiseHeads,
    merkleRoot: seal.merkleRoot,
    prevSealHash: seal.prevSealHash,
  };
}

/** Recompute a seal's hash. */
export async function computeSealHash(seal) {
  return sha256Hex(canonical(sealHashObject(seal)));
}

/**
 * Build promiseHeads for one candidate/election from all versions, using only
 * versions created at or before `sealedAt`. A withdrawn promise's head is its
 * withdraw version. Result is sorted by promiseId.
 */
export function headsAsOf(versions, electionId, candidateId, sealedAt) {
  const groups = groupByPromise(
    versions.filter((v) => v.electionId === electionId && v.candidateId === candidateId)
  );
  const heads = [];
  for (const [promiseId, chain] of groups) {
    const visible = chain.filter((v) => String(v.createdAt) <= String(sealedAt));
    if (visible.length === 0) continue;
    const head = visible[visible.length - 1];
    heads.push({ promiseId, version: head.version, hash: head.hash });
  }
  return sortHeads(heads);
}

/**
 * Create a seal object (async because hashing is WebCrypto-based).
 * `versions` is the full list of promise versions in the ledger.
 */
export async function createSeal({ id, kind, electionId, candidateId, sealedAt, versions, prevSealHash = null }) {
  const promiseHeads = headsAsOf(versions, electionId, candidateId, sealedAt);
  const leaves = [];
  for (const h of promiseHeads) leaves.push(await merkleLeaf(h));
  const root = await merkleRoot(leaves);
  const seal = {
    id,
    kind,
    electionId,
    candidateId,
    sealedAt,
    promiseHeads,
    merkleRoot: root,
    prevSealHash,
    anchors: [],
  };
  seal.sealHash = await computeSealHash(seal);
  return seal;
}

function fail(reason) {
  return { ok: false, reason };
}

/**
 * Verify a seal against the actual promise versions. Never throws on bad data.
 * Checks: schema-ish field shapes, recomputed hashes, heads match the chains as
 * of sealedAt, exactly one final seal per candidate per election (when the
 * surrounding set is provided via `allSeals`).
 */
export async function verifySeal(seal, versions, allSeals = [seal]) {
  if (!seal || typeof seal !== "object") return fail("seal is not an object");
  if (!isHex64(seal.sealHash)) return fail("sealHash is not 64-char lowercase hex");

  // 1. Every version referenced by a head must exist, belong to this
  //    candidate/election, be visible at sealedAt, and have a correct hash.
  const byPromise = new Map();
  for (const v of versions) {
    if (v.electionId !== seal.electionId || v.candidateId !== seal.candidateId) continue;
    if (!byPromise.has(v.promiseId)) byPromise.set(v.promiseId, []);
    byPromise.get(v.promiseId).push(v);
  }
  for (const head of seal.promiseHeads ?? []) {
    const chain = byPromise.get(head.promiseId);
    if (!chain) return fail(`head ${head.promiseId}: no versions for this candidate/election`);
    const ver = chain.find((v) => v.version === head.version);
    if (!ver) return fail(`head ${head.promiseId}: version ${head.version} does not exist`);
    if (String(ver.createdAt) > String(seal.sealedAt)) {
      return fail(`head ${head.promiseId} v${head.version}: created after sealedAt`);
    }
    const chainCheck = await verifyChain(chain.sort((a, b) => a.version - b.version));
    if (!chainCheck.ok) return fail(`chain ${head.promiseId} broken at version ${chainCheck.brokenAtVersion}: ${chainCheck.reason}`);
    const recomputed = await computeVersionHash(ver);
    if (recomputed !== head.hash || recomputed !== ver.hash) {
      return fail(`head ${head.promiseId} v${head.version}: hash mismatch`);
    }
  }

  // 2. Heads must be EXACTLY the latest versions as of sealedAt (nothing added,
  //    nothing removed).
  const expectedHeads = headsAsOf(versions, seal.electionId, seal.candidateId, seal.sealedAt);
  const actualHeads = sortHeads(seal.promiseHeads ?? []);
  if (expectedHeads.length !== actualHeads.length) {
    return fail(`promiseHeads do not match the chains as of sealedAt (${actualHeads.length} heads vs ${expectedHeads.length} expected)`);
  }
  for (let i = 0; i < expectedHeads.length; i++) {
    const a = expectedHeads[i], b = actualHeads[i];
    if (a.promiseId !== b.promiseId || a.version !== b.version || a.hash !== b.hash) {
      return fail(`promiseHeads differ at ${b.promiseId}: seal says v${b.version}, actual latest is v${a.version}`);
    }
  }

  // 3. Recompute merkle root over the heads.
  const leaves = [];
  for (const h of actualHeads) leaves.push(await merkleLeaf(h));
  const root = await merkleRoot(leaves);
  if ((root === null ? null : root) !== (seal.merkleRoot === null ? null : seal.merkleRoot)) {
    // empty tree: merkleRoot is null; a seal with zero heads may store null.
    if (!(actualHeads.length === 0 && (seal.merkleRoot === null))) {
      return fail("merkleRoot does not match the promiseHeads");
    }
  }

  // 4. Recompute sealHash.
  const recomputedSealHash = await computeSealHash(seal);
  if (recomputedSealHash !== seal.sealHash) {
    return fail("sealHash does not match recomputed hash (seal tampered?)");
  }

  // 5. Only one final seal per candidate per election.
  const finals = allSeals.filter(
    (s) => s.kind === "final" && s.electionId === seal.electionId && s.candidateId === seal.candidateId
  );
  if (finals.length > 1) {
    return fail(`more than one final seal for candidate ${seal.candidateId} in election ${seal.electionId}`);
  }

  return { ok: true, reason: null };
}
