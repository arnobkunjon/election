#!/usr/bin/env node
/**
 * make-example-ledger.mjs — generates spec/examples/minimal-country/ledger.json.
 *
 * Deterministic: fixed timestamps, fixed ids, no randomness. Re-running the
 * script must always produce byte-identical output.
 *
 * Content: 1 election (open), 2 candidates.
 *  - alice: promise road-1 published + amended (2 versions), promise school-1
 *    published (1 version)                -> 3 promises
 *  - bob:   promise clinic-1 published (1 version), promise bridge-1 published
 *    then withdrawn (2 versions)          -> amended-and-withdrawn scenario
 *  - one FINAL seal per candidate.
 *
 * Usage: node tools/make-example-ledger.mjs
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { computeVersionHash } from "../src/core/sealing/chain.mjs";
import { createSeal } from "../src/core/sealing/seal.mjs";
import { repoRoot } from "./schemas.mjs";

const ELECTION_ID = "xx-election-2026-north-1";
const REGION_ID = "xx:constituency:1";

function content(title, description, extra = {}) {
  return {
    title: { en: title },
    description: { en: description },
    category: extra.category ?? "roads_transport",
    successCriteria: { en: extra.successCriteria ?? "Voters can see it finished before the deadline." },
    ...(extra.targetValue !== undefined ? { targetValue: extra.targetValue, targetUnit: extra.targetUnit } : {}),
    deadline: extra.deadline ?? "2027-06-30",
  };
}

async function build() {
  // Raw version fields WITHOUT hash/prevHash; we chain them below.
  const raw = [
    { promiseId: "xx:promise:road-1", electionId: ELECTION_ID, candidateId: "alice-1", version: 1, type: "publish",
      content: content("Fix the North main road", "We will re-pave the main road of North State.", { deadline: "2027-06-30" }),
      createdAt: "2026-01-05T09:00:00Z" },
    { promiseId: "xx:promise:road-1", electionId: ELECTION_ID, candidateId: "alice-1", version: 2, type: "amend",
      content: content("Fix the North main road and side lanes", "We will re-pave the main road and both side lanes.", { deadline: "2027-09-30", targetValue: 12, targetUnit: "km" }),
      createdAt: "2026-01-12T09:00:00Z" },
    { promiseId: "xx:promise:school-1", electionId: ELECTION_ID, candidateId: "alice-1", version: 1, type: "publish",
      content: content("Build a new primary school", "One new primary school with four classrooms.", { category: "education", deadline: "2028-06-30" }),
      createdAt: "2026-01-06T09:00:00Z" },
    { promiseId: "xx:promise:clinic-1", electionId: ELECTION_ID, candidateId: "bob-1", version: 1, type: "publish",
      content: content("Open a free health clinic", "A sub-district clinic open six days a week.", { category: "health", deadline: "2027-12-31" }),
      createdAt: "2026-01-07T10:00:00Z" },
    { promiseId: "xx:promise:bridge-1", electionId: ELECTION_ID, candidateId: "bob-1", version: 1, type: "publish",
      content: content("Build a footbridge over Alpha river", "A safe footbridge for students and farmers.", { category: "roads_transport", deadline: "2027-12-31" }),
      createdAt: "2026-01-08T10:00:00Z" },
    { promiseId: "xx:promise:bridge-1", electionId: ELECTION_ID, candidateId: "bob-1", version: 2, type: "withdraw",
      content: null, reason: { en: "The river authority cancelled the site permit." },
      createdAt: "2026-01-20T10:00:00Z" },
  ];

  // Attach prevHash + hash per chain.
  const byPromise = new Map();
  const promiseVersions = [];
  for (const v of raw) {
    const prev = byPromise.get(v.promiseId);
    const version = { ...v, prevHash: prev ? prev.hash : null, hash: "0".repeat(64) };
    version.hash = await computeVersionHash(version);
    byPromise.set(v.promiseId, version);
    promiseVersions.push(version);
  }

  const seals = [];
  seals.push(await createSeal({
    id: "seal-alice-final", kind: "final", electionId: ELECTION_ID, candidateId: "alice-1",
    sealedAt: "2026-01-31T00:00:00Z", versions: promiseVersions, prevSealHash: null,
  }));
  seals.push(await createSeal({
    id: "seal-bob-final", kind: "final", electionId: ELECTION_ID, candidateId: "bob-1",
    sealedAt: "2026-01-31T00:00:00Z", versions: promiseVersions, prevSealHash: null,
  }));

  const ledger = {
    formatVersion: "0.1",
    elections: [
      {
        id: ELECTION_ID,
        countryCode: "xx",
        electionTypeId: "parliamentary",
        regionId: REGION_ID,
        names: { en: "Exampleland General Election 2026 — North-1" },
        status: "open",
        dates: { nominationOpens: "2025-12-01", electionDay: "2026-02-10", termStart: "2026-03-01", termEnd: "2031-02-28" },
      },
    ],
    candidates: [
      { id: "alice-1", electionId: ELECTION_ID, positionId: "mp", names: { en: "Alice Example" }, partyName: "Example Party A", verificationStatus: "verified" },
      { id: "bob-1", electionId: ELECTION_ID, positionId: "mp", names: { en: "Bob Sample" }, partyName: "Example Party B", verificationStatus: "unverified" },
    ],
    promiseVersions,
    seals,
  };

  const outPath = join(repoRoot, "spec", "examples", "minimal-country", "ledger.json");
  writeFileSync(outPath, JSON.stringify(ledger, null, 2) + "\n", "utf8");
  console.log(`wrote ${outPath}`);
  console.log(`  elections: ${ledger.elections.length}, candidates: ${ledger.candidates.length}, versions: ${promiseVersions.length}, seals: ${seals.length}`);
  for (const s of seals) console.log(`  ${s.id}: merkleRoot=${s.merkleRoot} sealHash=${s.sealHash}`);
}

build().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
