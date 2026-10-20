#!/usr/bin/env node
/**
 * verify-ledger.mjs — CLI: check a published ledger against a country folder.
 *
 * Usage: node tools/verify-ledger.mjs <ledger.json> <country-folder>
 *   e.g. node tools/verify-ledger.mjs spec/examples/minimal-country/ledger.json \
 *            spec/examples/minimal-country
 *
 * Validates schemas, every election/candidate/promise reference against the
 * country folder, every version chain, and every seal. Prints a clear report.
 * Exit 1 on any failure, 0 when the ledger is valid.
 */

import process from "node:process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { verifyLedger } from "./ledger.mjs";

const [ledgerArg, countryArg] = process.argv.slice(2);
if (!ledgerArg || !countryArg) {
  console.error("Usage: node tools/verify-ledger.mjs <ledger.json> <country-folder>");
  process.exit(1);
}

let ledger;
try {
  ledger = JSON.parse(readFileSync(resolve(process.cwd(), ledgerArg), "utf8"));
} catch (e) {
  console.error(`VERIFY FAILED\n  ✗ cannot read ${ledgerArg}: ${e.message}`);
  process.exit(1);
}

const errors = await verifyLedger(ledger, resolve(process.cwd(), countryArg));

if (errors.length > 0) {
  console.error("VERIFY FAILED");
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}

const counts = {
  elections: ledger.elections.length,
  candidates: ledger.candidates.length,
  promiseVersions: ledger.promiseVersions.length,
  seals: ledger.seals.length,
};
const promises = new Set(ledger.promiseVersions.map((v) => v.promiseId));
console.log(`VALID: ${ledgerArg} (against ${countryArg})`);
console.log(`  elections: ${counts.elections}, candidates: ${counts.candidates}, promises: ${promises.size}, versions: ${counts.promiseVersions}, seals: ${counts.seals}`);
for (const s of ledger.seals) {
  console.log(`  seal ${s.id} (${s.kind}): merkleRoot=${s.merkleRoot ?? "(empty)"} sealHash=${s.sealHash}`);
}
