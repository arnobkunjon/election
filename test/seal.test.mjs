/**
 * seal.test.mjs — seal creation, verification, and tamper detection.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeVersionHash } from "../src/core/sealing/chain.mjs";
import { createSeal, verifySeal } from "../src/core/sealing/seal.mjs";

async function makeVersions() {
  const raw = [
    { promiseId: "p-a", candidateId: "c1", version: 1, type: "publish",
      content: { title: { en: "A" }, description: { en: "aa" }, category: "health",
        successCriteria: { en: "done" }, deadline: "2027-06-30" }, createdAt: "2026-01-01T00:00:00Z" },
    { promiseId: "p-a", candidateId: "c1", version: 2, type: "amend",
      content: { title: { en: "A2" }, description: { en: "aa2" }, category: "health",
        successCriteria: { en: "done better" }, deadline: "2027-06-30" }, createdAt: "2026-01-02T00:00:00Z" },
    { promiseId: "p-b", candidateId: "c1", version: 1, type: "publish",
      content: { title: { en: "B" }, description: { en: "bb" }, category: "education",
        successCriteria: { en: "built" }, deadline: "2028-06-30" }, createdAt: "2026-01-03T00:00:00Z" },
    { promiseId: "p-c", candidateId: "c1", version: 1, type: "publish",
      content: { title: { en: "C" }, description: { en: "cc" }, category: "water_sanitation",
        successCriteria: { en: "clean" }, deadline: "2028-06-30" }, createdAt: "2026-01-04T00:00:00Z" },
    { promiseId: "p-c", candidateId: "c1", version: 2, type: "withdraw", content: null,
      reason: { en: "no permit" }, createdAt: "2026-01-05T00:00:00Z" },
    // another candidate, same election — must not leak into c1's seal
    { promiseId: "p-z", candidateId: "c2", version: 1, type: "publish",
      content: { title: { en: "Z" }, description: { en: "zz" }, category: "other",
        successCriteria: { en: "?" }, deadline: "2028-06-30" }, createdAt: "2026-01-04T00:00:00Z" },
  ];
  const versions = [];
  const prevByPromise = new Map();
  for (const v of raw) {
    const prev = prevByPromise.get(v.promiseId);
    const full = { ...v, electionId: "e1", prevHash: prev ? prev.hash : null, hash: "0".repeat(64) };
    full.hash = await computeVersionHash(full);
    prevByPromise.set(v.promiseId, full);
    versions.push(full);
  }
  return versions;
}

test("clean final seal verifies", async () => {
  const versions = await makeVersions();
  const seal = await createSeal({ id: "s1", kind: "final", electionId: "e1", candidateId: "c1",
    sealedAt: "2026-02-01T00:00:00Z", versions, prevSealHash: null });
  // heads: p-a v2, p-b v1, p-c v2 (withdraw head), nothing from c2
  assert.deepEqual(seal.promiseHeads.map((h) => [h.promiseId, h.version]),
    [["p-a", 2], ["p-b", 1], ["p-c", 2]]);
  const res = await verifySeal(seal, versions);
  assert.equal(res.ok, true, res.reason ?? "");
});

test("tamper: change a seal's promiseHeads is detected", async () => {
  const versions = await makeVersions();
  const seal = await createSeal({ id: "s1", kind: "final", electionId: "e1", candidateId: "c1",
    sealedAt: "2026-02-01T00:00:00Z", versions });
  seal.promiseHeads[0].version = 1; // pretend the amendment never happened
  const res = await verifySeal(seal, versions);
  assert.equal(res.ok, false);
});

test("tamper: remove a promise from a seal is detected", async () => {
  const versions = await makeVersions();
  const seal = await createSeal({ id: "s1", kind: "final", electionId: "e1", candidateId: "c1",
    sealedAt: "2026-02-01T00:00:00Z", versions });
  seal.promiseHeads.splice(1, 1); // drop p-b
  const res = await verifySeal(seal, versions);
  assert.equal(res.ok, false);
});

test("tamper: silently edit a version after sealing is detected via chain recheck", async () => {
  const versions = await makeVersions();
  const seal = await createSeal({ id: "s1", kind: "final", electionId: "e1", candidateId: "c1",
    sealedAt: "2026-02-01T00:00:00Z", versions });
  versions.find((v) => v.promiseId === "p-a" && v.version === 1).content.title.en = "HACKED";
  const res = await verifySeal(seal, versions);
  assert.equal(res.ok, false);
});

test("only one final seal per candidate per election", async () => {
  const versions = await makeVersions();
  const s1 = await createSeal({ id: "s1", kind: "final", electionId: "e1", candidateId: "c1",
    sealedAt: "2026-02-01T00:00:00Z", versions });
  const s2 = await createSeal({ id: "s2", kind: "final", electionId: "e1", candidateId: "c1",
    sealedAt: "2026-02-02T00:00:00Z", versions });
  const res = await verifySeal(s2, versions, [s1, s2]);
  assert.equal(res.ok, false);
  assert.match(res.reason, /more than one final seal/);
});

test("interim seals may repeat; sealedAt cutoff excludes later versions", async () => {
  const versions = await makeVersions();
  const early = await createSeal({ id: "s-int", kind: "interim", electionId: "e1", candidateId: "c1",
    sealedAt: "2026-01-02T12:00:00Z", versions });
  // As of 2026-01-02T12:00:00Z only p-a v1 exists.
  assert.deepEqual(early.promiseHeads.map((h) => [h.promiseId, h.version]), [["p-a", 1]]);
  const late = await createSeal({ id: "s-int2", kind: "interim", electionId: "e1", candidateId: "c1",
    sealedAt: "2026-01-03T12:00:00Z", versions, prevSealHash: early.sealHash });
  const all = [early, late];
  assert.equal((await verifySeal(early, versions, all)).ok, true);
  assert.equal((await verifySeal(late, versions, all)).ok, true);
});

test("seal with zero heads has null merkleRoot and still verifies", async () => {
  const versions = await makeVersions();
  const seal = await createSeal({ id: "s-empty", kind: "interim", electionId: "e1", candidateId: "nobody",
    sealedAt: "2026-02-01T00:00:00Z", versions });
  assert.equal(seal.merkleRoot, null);
  assert.deepEqual(seal.promiseHeads, []);
  const res = await verifySeal(seal, versions);
  assert.equal(res.ok, true, res.reason ?? "");
});
