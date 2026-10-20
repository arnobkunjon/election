/**
 * lifecycle.test.mjs — table-driven tests for election status rules.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STATUSES, canPublish, canAmend, canWithdraw, canMoveTo, canFinalSeal,
} from "../src/core/lifecycle.mjs";

const TABLE = [
  // status,      publish, amend, withdraw, finalSeal
  ["draft",      false,   false,  false,     false],
  ["open",       true,    true,   true,      false],
  ["locked",     false,   false,  true,      true],
  ["governing",  false,   false,  true,      false],
  ["closed",     false,   false,  false,     false],
];

test("lifecycle action table", () => {
  for (const [status, publish, amend, withdraw, finalSeal] of TABLE) {
    assert.equal(canPublish(status), publish, `canPublish(${status})`);
    assert.equal(canAmend(status), amend, `canAmend(${status})`);
    assert.equal(canWithdraw(status), withdraw, `canWithdraw(${status})`);
    assert.equal(canFinalSeal(status), finalSeal, `canFinalSeal(${status})`);
  }
});

test("status moves only forward, one step at a time", () => {
  const forward = [
    ["draft", "open"], ["open", "locked"], ["locked", "governing"], ["governing", "closed"],
  ];
  for (const [from, to] of forward) {
    assert.equal(canMoveTo(from, to), true, `${from} -> ${to} allowed`);
  }
  // same status, backwards, or skipped transitions are not allowed
  assert.equal(canMoveTo("open", "open"), false);
  assert.equal(canMoveTo("open", "draft"), false);
  assert.equal(canMoveTo("locked", "closed"), false); // skip
  assert.equal(canMoveTo("draft", "governing"), false); // skip
  assert.equal(canMoveTo("draft", "closed"), false);
});

test("unknown status throws in canMoveTo, false elsewhere", () => {
  assert.throws(() => canMoveTo("bogus", "open"), TypeError);
  assert.equal(canPublish("bogus"), false);
  assert.equal(canWithdraw("bogus"), false);
});

test("STATUSES lists the exact order", () => {
  assert.deepEqual(STATUSES, ["draft", "open", "locked", "governing", "closed"]);
});
