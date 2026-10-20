/**
 * canonical.test.mjs — extra edge cases for the canonical serializer.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { canonical, CanonicalError } from "../src/core/sealing/canonical.mjs";

test("keys sort by UTF-16 code unit order", () => {
  // uppercase sorts before lowercase; digits before letters
  assert.equal(canonical({ b: 1, B: 2, a: 3, "0": 4 }), '{"0":4,"B":2,"a":3,"b":1}');
});

test("empty object and array", () => {
  assert.equal(canonical({}), "{}");
  assert.equal(canonical([]), "[]");
  assert.equal(canonical(null), "null");
});

test("array order is preserved (not sorted)", () => {
  assert.equal(canonical([3, 1, 2]), "[3,1,2]");
});

test("string escaping matches JSON.stringify", () => {
  assert.equal(canonical({ 'a"b': "c\\d\ne" }), '{"a\\"b":"c\\\\d\\ne"}');
});

test("lone surrogates are rejected", () => {
  assert.throws(() => canonical("\uD800"), CanonicalError);
});

test("undefined inside nested structures is rejected with a path", () => {
  assert.throws(() => canonical({ a: { b: undefined } }), (err) =>
    err instanceof CanonicalError && /\$\.a\.b/.test(err.message));
});

test("class instances are rejected as non-plain objects", () => {
  class Foo { constructor() { this.x = 1; } }
  assert.throws(() => canonical(new Foo()), CanonicalError);
  // null-prototype objects are plain enough
  const o = Object.create(null);
  o.z = 1; o.a = 2;
  assert.equal(canonical(o), '{"a":2,"z":1}');
});

test("very large integers beyond Number.MAX_SAFE_INTEGER are rejected", () => {
  assert.throws(() => canonical({ n: 9007199254740993 }), CanonicalError);
});
