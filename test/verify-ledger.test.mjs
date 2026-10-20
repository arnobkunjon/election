/**
 * verify-ledger.test.mjs — end-to-end: the committed example ledger must pass;
 * tampered copies must fail.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { verifyLedger } from "../tools/ledger.mjs";
import { repoRoot } from "../tools/schemas.mjs";

const COUNTRY_DIR = join(repoRoot, "spec", "examples", "minimal-country");
const LEDGER_PATH = join(COUNTRY_DIR, "ledger.json");

function freshLedger() {
  return JSON.parse(readFileSync(LEDGER_PATH, "utf8"));
}

test("example ledger passes verification", async () => {
  const errors = await verifyLedger(freshLedger(), COUNTRY_DIR);
  assert.deepEqual(errors, []);
});

test("tamper: edited promise content fails", async () => {
  const l = freshLedger();
  l.promiseVersions[0].content.title.en = "Rewritten history";
  const errors = await verifyLedger(l, COUNTRY_DIR);
  assert.ok(errors.length > 0 && /hash/.test(errors.join("\n")));
});

test("tamper: deleted version fails", async () => {
  const l = freshLedger();
  l.promiseVersions.splice(1, 1); // remove road-1 v2
  const errors = await verifyLedger(l, COUNTRY_DIR);
  assert.ok(errors.length > 0);
});

test("tamper: seal head removed fails", async () => {
  const l = freshLedger();
  l.seals[0].promiseHeads.pop();
  const errors = await verifyLedger(l, COUNTRY_DIR);
  assert.ok(errors.length > 0);
});

test("unknown extra field fails schema validation", async () => {
  const l = freshLedger();
  l.candidates[0].nid = "1990123456789"; // personal data is rejected hard
  const errors = await verifyLedger(l, COUNTRY_DIR);
  assert.ok(errors.some((e) => e.startsWith("schema:") && /nid/.test(e)));
});

test("election referencing a missing region fails", async () => {
  const l = freshLedger();
  l.elections[0].regionId = "xx:constituency:999";
  const errors = await verifyLedger(l, COUNTRY_DIR);
  assert.ok(errors.some((e) => /does not exist in regions\.json/.test(e)));
});

test("election with wrong region level fails", async () => {
  const l = freshLedger();
  l.elections[0].regionId = "xx:state:north"; // state level, but parliamentary needs constituency
  const errors = await verifyLedger(l, COUNTRY_DIR);
  assert.ok(errors.some((e) => /level/.test(e)));
});

test("candidate with unknown position fails", async () => {
  const l = freshLedger();
  l.candidates[0].positionId = "senator";
  const errors = await verifyLedger(l, COUNTRY_DIR);
  assert.ok(errors.some((e) => /positionId/.test(e)));
});

test("undeclared locale fails", async () => {
  const l = freshLedger();
  l.promiseVersions[0].content.title.fr = "Route";
  const errors = await verifyLedger(l, COUNTRY_DIR);
  assert.ok(errors.some((e) => /locale/.test(e)));
});
