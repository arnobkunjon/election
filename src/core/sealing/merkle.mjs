/**
 * merkle.mjs — SECURITY-SENSITIVE: Merkle root and proofs (Promise Format v0.1).
 *
 * Exactly these rules, so any language can re-implement them:
 *  - leaf(i)          = sha256("leaf:" + promiseId + ":" + version + ":" + hash)
 *  - inner(left,right)= sha256("node:" + leftHex + rightHex)
 *  - leaves are ordered by promiseId (plain string comparison, ascending).
 *  - At each level, pairs are combined left-to-right. If a level has an odd
 *    number of nodes, the LAST node is carried up unchanged (never duplicated).
 *  - The root of zero leaves is defined as null.
 *
 * Proofs are arrays of {hash, side} entries ("side" is this node's own side at
 * that level: "L" or "R"), bottom-up. verifyProof re-computes the root.
 */

import { sha256Hex, isHex64 } from "./hash.mjs";

/** Compute the leaf hash for one promise head {promiseId, version, hash}. */
export async function merkleLeaf(head) {
  return sha256Hex(`leaf:${head.promiseId}:${head.version}:${head.hash}`);
}

async function combine(left, right) {
  return sha256Hex(`node:${left}${right}`);
}

/** Sort heads by promiseId (string order). */
export function sortHeads(heads) {
  return [...heads].sort((a, b) => (a.promiseId < b.promiseId ? -1 : a.promiseId > b.promiseId ? 1 : 0));
}

/** Compute all leaf hashes, in order (heads must already be sorted by promiseId). */
export async function merkleLeaves(heads) {
  const leaves = [];
  for (const h of heads) leaves.push(await merkleLeaf(h));
  return leaves;
}

/** Compute the Merkle root over ordered leaf hashes. Empty list -> null. */
export async function merkleRoot(leaves) {
  if (leaves.length === 0) return null;
  let level = [...leaves];
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) next.push(await combine(level[i], level[i + 1]));
      else next.push(level[i]); // odd tail carried up unchanged
    }
    level = next;
  }
  return level[0];
}

/** Build a proof for leaves[index] against the same tree as merkleRoot(). */
export async function merkleProof(leaves, index) {
  if (!Array.isArray(leaves) || index < 0 || index >= leaves.length) {
    throw new RangeError(`merkleProof: index ${index} out of range for ${leaves?.length ?? 0} leaves`);
  }
  const proof = [];
  let level = [...leaves];
  let idx = index;
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      if (i + 1 < level.length) {
        if (idx === i) proof.push({ hash: level[i + 1], side: "L" });
        else if (idx === i + 1) proof.push({ hash: level[i], side: "R" });
        next.push(await combine(level[i], level[i + 1]));
      } else {
        next.push(level[i]); // odd tail carried up
      }
    }
    idx = Math.floor(idx / 2);
    level = next;
  }
  return proof;
}

/**
 * Verify that `leaf` (a leaf hash) is included under `root` given `proof`.
 * Returns true/false; never throws on malformed proof data.
 */
export async function verifyProof(leaf, proof, root) {
  if (!isHex64(leaf) || !isHex64(root)) return false;
  if (!Array.isArray(proof)) return false;
  let computed = leaf;
  for (const step of proof) {
    if (!step || typeof step !== "object") return false;
    if (!isHex64(step.hash)) return false;
    if (step.side === "L") computed = await combine(computed, step.hash);
    else if (step.side === "R") computed = await combine(step.hash, computed);
    else return false;
  }
  return computed === root;
}
