/**
 * chain.test.mjs — tamper detection for promise version chains.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeVersionHash, verifyChain } from "../src/core/sealing/chain.mjs";

async function makeChain() {
  const raw = [
    { promiseId: "p1", electionId: "e1", candidateId: "c1", version: 1, type: "publish",
      content: { title: { en: "Road" }, description: { en: "Fix road" }, category: "roads_transport",
        successCriteria: { en: "Fixed" }, deadline: "2027-06-30" },
      createdAt: "2026-01-01T00:00:00Z" },
    { promiseId: "p1", electionId: "e1", candidateId: "c1", version: 2, type: "amend",
      content: { title: { en: "Road v2" }, description: { en: "Fix road and lanes" }, category: "roads_transport",
        successCriteria: { en: "Fixed wider" }, deadline: "2027-09-30" },
      createdAt: "2026-01-02T00:00:00Z" },
    { promiseId: "p1", electionId: "e1", candidateId: "c1", version: 3, type: "withdraw",
      content: null, reason: { en: "Cancelled by authority" },
      createdAt: "2026-01-03T00:00:00Z" },
  ];
  const chain = [];
  let prev = null;
  for (const v of raw) {
    const full = { ...v, prevHash: prev ? prev.hash : null, hash: "0".repeat(64) };
    full.hash = await computeVersionHash(full);
    chain.push(full);
    prev = full;
  }
  return chain;
}

test("clean chain verifies OK", async () => {
  const chain = await makeChain();
  assert.deepEqual(await verifyChain(chain), { ok: true, brokenAtVersion: null, reason: null });
});

test("tamper: edit old content is detected", async () => {
  const chain = await makeChain();
  chain[0].content.title.en = "TOTALLY DIFFERENT";
  const res = await verifyChain(chain);
  assert.equal(res.ok, false);
  assert.equal(res.brokenAtVersion, 1);
});

test("tamper: change a timestamp is detected", async () => {
  const chain = await makeChain();
  chain[1].createdAt = "2026-01-02T00:00:01Z";
  const res = await verifyChain(chain);
  assert.equal(res.ok, false);
  assert.equal(res.brokenAtVersion, 2);
});

test("tamper: delete a middle version is detected", async () => {
  const chain = await makeChain();
  chain.splice(1, 1); // remove v2; now [v1, v3]
  const res = await verifyChain(chain);
  assert.equal(res.ok, false);
  assert.equal(res.brokenAtVersion, 2); // v3 sits at position 2 but claims version 3 / link broken
});

test("tamper: reorder versions is detected", async () => {
  const chain = await makeChain();
  const swapped = [chain[0], chain[2], chain[1]];
  const res = await verifyChain(swapped);
  assert.equal(res.ok, false);
});

test("tamper: change a prevHash is detected", async () => {
  const chain = await makeChain();
  chain[2].prevHash = "e".repeat(64);
  const res = await verifyChain(chain);
  assert.equal(res.ok, false);
  assert.equal(res.brokenAtVersion, 3);
});

test("tamper: add a version after withdraw is detected", async () => {
  const chain = await makeChain();
  const extra = { ...chain[1], version: 4, prevHash: chain[2].hash,
    createdAt: "2026-01-04T00:00:00Z" };
  extra.hash = "0".repeat(64);
  extra.hash = await computeVersionHash(extra);
  chain.push(extra);
  const res = await verifyChain(chain);
  assert.equal(res.ok, false);
  assert.match(res.reason, /after a "withdraw"/);
});

test("gap in numbering is detected", async () => {
  const chain = await makeChain();
  chain[2].version = 5;
  // fix its own hash so only the numbering rule fails
  chain[2].hash = await computeVersionHash(chain[2]);
  const res = await verifyChain(chain);
  assert.equal(res.ok, false);
  assert.equal(res.brokenAtVersion, 3);
});

test("publish not allowed as version > 1", async () => {
  const chain = await makeChain();
  chain[1].type = "publish";
  chain[1].hash = await computeVersionHash(chain[1]);
  const res = await verifyChain(chain);
  assert.equal(res.ok, false);
  assert.match(res.reason, /only allowed as version 1/);
});

test("verifyChain never throws on garbage", async () => {
  assert.equal((await verifyChain([])).ok, false);
  assert.equal((await verifyChain([{ nope: true }])).ok, false);
  const chain = await makeChain();
  chain[0].hash = "ZZZ not hex";
  assert.equal((await verifyChain(chain)).ok, false);
});
