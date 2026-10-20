/**
 * vectors.test.mjs — known-answer vectors. These exact values are also printed
 * in spec/promise-format.md so other implementations can match them.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { canonical, CanonicalError } from "../src/core/sealing/canonical.mjs";
import { sha256Hex } from "../src/core/sealing/hash.mjs";
import { computeVersionHash } from "../src/core/sealing/chain.mjs";
import { merkleLeaf, merkleRoot, merkleProof, verifyProof } from "../src/core/sealing/merkle.mjs";
import { computeSealHash } from "../src/core/sealing/seal.mjs";

test("sha256 well-known vectors", async () => {
  assert.equal(
    await sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
  );
  assert.equal(
    await sha256Hex(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  );
});

test("canonical JSON: key sorting, no whitespace, nested objects", () => {
  assert.equal(
    canonical({ b: 1, a: "x", arr: [1, "two"], nested: { z: null, y: true } }),
    '{"a":"x","arr":[1,"two"],"b":1,"nested":{"y":true,"z":null}}'
  );
});

test("version hash vector: publish v1", async () => {
  const v = {
    promiseId: "xx:promise:road-1",
    electionId: "xx-election-2026-north-1",
    candidateId: "alice-1",
    version: 1,
    type: "publish",
    content: {
      title: { en: "Fix the North main road" },
      description: { en: "We will re-pave the main road of North State." },
      category: "roads_transport",
      successCriteria: { en: "Voters can see it finished before the deadline." },
      deadline: "2027-06-30",
    },
    createdAt: "2026-01-05T09:00:00Z",
    prevHash: null,
  };
  assert.equal(
    canonical((await import("../src/core/sealing/chain.mjs")).versionHashObject(v)),
    '{"candidateId":"alice-1","content":{"category":"roads_transport","deadline":"2027-06-30","description":{"en":"We will re-pave the main road of North State."},"successCriteria":{"en":"Voters can see it finished before the deadline."},"title":{"en":"Fix the North main road"}},"createdAt":"2026-01-05T09:00:00Z","electionId":"xx-election-2026-north-1","prevHash":null,"promiseId":"xx:promise:road-1","type":"publish","version":1}'
  );
  assert.equal(
    await computeVersionHash(v),
    "721ed427f4e8382e80fc6e1720b00abf85fc192fc2b1c40beea135688588e28d"
  );
});

test("version hash vector: withdraw v2 with reason (key present)", async () => {
  const v = {
    promiseId: "xx:promise:road-1",
    electionId: "xx-election-2026-north-1",
    candidateId: "alice-1",
    version: 2,
    type: "withdraw",
    content: null,
    reason: { en: "Merged into promise road-2" },
    createdAt: "2026-02-01T10:00:00Z",
    prevHash: "f".repeat(64),
  };
  assert.equal(
    await computeVersionHash(v),
    "a631f38b8112dca1625c1e5f223d5d34c6d7ee0fbab440c27be7bc524f24f8a3"
  );
});

test("version hash vector: withdraw v2 without reason (key omitted)", async () => {
  const v = {
    promiseId: "xx:promise:road-1",
    electionId: "xx-election-2026-north-1",
    candidateId: "alice-1",
    version: 2,
    type: "withdraw",
    content: null,
    createdAt: "2026-02-01T10:00:00Z",
    prevHash: "f".repeat(64),
  };
  assert.equal(
    await computeVersionHash(v),
    "6903cd642074abd1628e2e4594a3d75f2a13ab57836076e322a458b89c61d464"
  );
});

test("NFC: Bangla decomposed vs composed hash identically", async () => {
  const decomposed = "\u09AF\u09BC"; // য় as Y+NUKTA (2 code points)
  const composed = "\u09DF"; // য় precomposed (1 code point)
  assert.notEqual(decomposed, composed); // raw strings differ...
  assert.equal(canonical({ bn: decomposed }), canonical({ bn: composed })); // ...canonical form is identical
  assert.equal(
    canonical({ bn: decomposed }),
    '{"bn":"\u09DF"}'
  );
  assert.equal(
    await sha256Hex(canonical({ bn: decomposed })),
    "dab97f48bde7a462b622f86f9608567dcd56dc3df65bb7b3df467bb88f6bdc62"
  );
  assert.equal(await sha256Hex(canonical({ bn: decomposed })), await sha256Hex(canonical({ bn: composed })));
});

test("reject floats, NaN, Infinity, undefined, functions, bigint, non-plain objects", () => {
  assert.throws(() => canonical({ x: 1.5 }), CanonicalError);
  assert.throws(() => canonical({ x: NaN }), CanonicalError);
  assert.throws(() => canonical({ x: Infinity }), CanonicalError);
  assert.throws(() => canonical([NaN]), CanonicalError);
  assert.throws(() => canonical({ x: undefined }), CanonicalError);
  assert.throws(() => canonical([undefined]), CanonicalError);
  assert.throws(() => canonical({ x: () => 1 }), CanonicalError);
  assert.throws(() => canonical({ x: 10n }), CanonicalError);
  assert.throws(() => canonical(new Date()), CanonicalError);
  assert.throws(() => canonical({ x: Symbol("s") }), CanonicalError);
  // safe integers are fine
  assert.equal(canonical({ x: -9007199254740991 }), '{"x":-9007199254740991}');
});

const A = { promiseId: "p-a", version: 1, hash: "a".repeat(64) };
const B = { promiseId: "p-b", version: 2, hash: "b".repeat(64) };
const C = { promiseId: "p-c", version: 1, hash: "c".repeat(64) };

test("merkle leaf and root vectors (1, 2, 3 leaves)", async () => {
  const la = await merkleLeaf(A), lb = await merkleLeaf(B), lc = await merkleLeaf(C);
  assert.equal(la, "5d1094bc8eb423f7ae35a27cb48d40aeb61af505ad0b3b5c10ead1d616e168b1");
  assert.equal(lb, "6eeda24b60a09edcde8741270f171d4946b2c6bbdac0f06ce0435fffb6228457");
  assert.equal(lc, "4b32af55b70fcce5f7bab83c761003d8aa7c92ec83bc05c5fbcb9bf890ddf03e");
  assert.equal(await merkleRoot([la]), la); // single leaf IS the root
  assert.equal(await merkleRoot([la, lb]), "95057c9cb979e22edc963d0fbe5a1e63c03ac14566d04ffa2b7994d91d1f61f1");
  assert.equal(await merkleRoot([la, lb, lc]), "a12991f943c4ecfd29794687de975c75b317a1d9dc1eb697d845cbeaa28875f1");
  assert.equal(await merkleRoot([]), null);
});

test("seal hash vector", async () => {
  const seal = {
    id: "seal-alice-final",
    kind: "final",
    electionId: "xx-election-2026-north-1",
    candidateId: "alice-1",
    sealedAt: "2026-03-01T00:00:00Z",
    promiseHeads: [{ promiseId: "xx:promise:road-1", version: 2, hash: "ab".repeat(32) }],
    merkleRoot: "cd".repeat(32),
    prevSealHash: null,
  };
  assert.equal(await computeSealHash(seal), "9777e0f144db51ee39596b702d79471fff7708d98888466c5c89b4ea0c3be2ba");
});
