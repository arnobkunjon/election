/**
 * merkle.test.mjs — roots and inclusion proofs for 1..5 leaves.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { merkleLeaf, merkleRoot, merkleProof, verifyProof, sortHeads } from "../src/core/sealing/merkle.mjs";

const LETTERS = ["a", "b", "c", "d", "e"];
const heads = LETTERS.map((s) => ({ promiseId: `p-${s}`, version: 1, hash: s.repeat(64) }));

async function leaves(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(await merkleLeaf(heads[i]));
  return out;
}

for (const n of [1, 2, 3, 4, 5]) {
  test(`proofs verify for every leaf in a ${n}-leaf tree`, async () => {
    const lvs = await leaves(n);
    const root = await merkleRoot(lvs);
    assert.match(root, /^[0-9a-f]{64}$/);
    for (let i = 0; i < n; i++) {
      const proof = await merkleProof(lvs, i);
      assert.equal(await verifyProof(lvs[i], proof, root), true, `leaf ${i} should verify`);
    }
  });
}

test("proof fails for a wrong leaf", async () => {
  const lvs = await leaves(5);
  const root = await merkleRoot(lvs);
  const proof = await merkleProof(lvs, 2);
  assert.equal(await verifyProof(lvs[3], proof, root), false);
  assert.equal(await verifyProof("f".repeat(64), proof, root), false);
});

test("proof fails against a different root", async () => {
  const lvs4 = await leaves(4);
  const lvs5 = await leaves(5);
  const proof = await merkleProof(lvs4, 1);
  assert.equal(await verifyProof(lvs4[1], proof, await merkleRoot(lvs5)), false);
});

test("odd level carries the last node up unchanged (no duplication)", async () => {
  // With 3 leaves: root must equal node(node(l0,l1), l2).
  const lvs = await leaves(3);
  const { sha256Hex } = await import("../src/core/sealing/hash.mjs");
  const pair = await sha256Hex(`node:${lvs[0]}${lvs[1]}`);
  const expected = await sha256Hex(`node:${pair}${lvs[2]}`);
  assert.equal(await merkleRoot(lvs), expected);
});

test("single leaf is its own root; empty tree root is null", async () => {
  const lvs = await leaves(1);
  assert.equal(await merkleRoot(lvs), lvs[0]);
  assert.equal(await merkleRoot([]), null);
});

test("sortHeads orders by promiseId", () => {
  const sorted = sortHeads([
    { promiseId: "p-c" }, { promiseId: "p-a" }, { promiseId: "p-b" },
  ]);
  assert.deepEqual(sorted.map((h) => h.promiseId), ["p-a", "p-b", "p-c"]);
});

test("verifyProof never throws on garbage", async () => {
  assert.equal(await verifyProof("zz", [], "a".repeat(64)), false);
  assert.equal(await verifyProof("a".repeat(64), [{ hash: "bad", side: "L" }], "a".repeat(64)), false);
  assert.equal(await verifyProof("a".repeat(64), [{ hash: "b".repeat(64), side: "X" }], "a".repeat(64)), false);
  assert.equal(await verifyProof("a".repeat(64), "not-an-array", "a".repeat(64)), false);
});
