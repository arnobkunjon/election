# Promise Format (v0.1)

This document describes how promises are recorded, chained, and sealed in this
project. It is the companion of `electoral-region-format.md` (which describes
countries and regions). Status: **draft v0.1** — test/prototype only.

The big idea: a promise is **append-only**. You can publish it, correct it with a
new version, or withdraw it — but you can never edit or delete an old version.
Every record carries a hash that covers its content, so any later tampering is
detectable. Seals freeze a candidate's whole promise set at a point in time.

## What a ledger file contains

A ledger is one JSON file (for example `ledger.json` next to a country folder):

```
{ "formatVersion": "0.1",
  "elections": [...], "candidates": [...],
  "promiseVersions": [...], "seals": [...] }
```

All four record types are validated by the JSON Schemas in `spec/schema/`
(draft 2020-12, `additionalProperties: false` everywhere — unknown fields are
rejected, which also blocks personal data sneaking in).

## Election

| Field | Meaning |
|---|---|
| `id` | Stable id, unique in the ledger, e.g. `xx-election-2026-north-1`. |
| `countryCode` | Must match `country.json` → `country.code` (lowercase ISO 3166-1 alpha-2; see the region format doc). |
| `electionTypeId` | Must exist in the country's `electionTypes`. |
| `regionId` | Must exist in the country's `regions.json`, and the region's level must equal the election type's `regionLevel`. |
| `names` | Localized name; locales must be declared in `country.json`. |
| `status` | `draft` \| `open` \| `locked` \| `governing` \| `closed` (see Lifecycle). |
| `dates` | `nominationOpens`, `electionDay`, `termStart`, `termEnd` — ISO dates (`YYYY-MM-DD`), in that order. |

## Candidate

| Field | Meaning |
|---|---|
| `id` | Stable id, unique in the ledger. |
| `electionId` | The election the candidate runs in. |
| `positionId` | Must exist in the positions of that election's type (e.g. `mp`). |
| `names` | Localized name (at least the country's default locale). |
| `partyName` | Optional free-text party/affiliation label. |
| `verificationStatus` | `unverified` \| `verified` \| `rejected` — a human check of identity. |

**Privacy rule:** candidates never carry NIDs, national ID numbers, or any other
personal ID field, and never contact details. The schema rejects unknown fields,
so adding them requires a deliberate format change.

## PromiseVersion

Promises are identified by `promiseId`. One record per version:

| Field | Meaning |
|---|---|
| `promiseId` | Same for every version of one promise, e.g. `xx:promise:road-1`. |
| `electionId`, `candidateId` | References; must exist and agree with each other. |
| `version` | Integer starting at 1, +1 per new version of that promise. |
| `type` | `publish` (only version 1) \| `amend` \| `withdraw`. |
| `content` | Object for publish/amend, `null` for withdraw (see below). |
| `reason` | Localized text. **Required for withdraw, forbidden otherwise.** A withdrawal never erases anything: all earlier versions stay visible. |
| `createdAt` | ISO 8601 UTC, second precision, e.g. `2026-10-20T09:00:00Z`. |
| `prevHash` | Hash of the previous version; `null` only for version 1. |
| `hash` | 64-char lowercase hex, computed as described under "Sealing rules". |

`content` fields:

| Field | Rule |
|---|---|
| `title` | Localized, max 140 chars per locale. |
| `description` | Localized, max 2000 chars per locale. |
| `category` | One enum value: `roads_transport`, `health`, `education`, `water_sanitation`, `electricity_energy`, `agriculture`, `economy_jobs`, `law_order`, `environment`, `digital`, `housing`, `other`. |
| `successCriteria` | Localized, required. How will voters know this was kept? |
| `targetValue`, `targetUnit` | Optional numeric target (safe integer) and unit. |
| `deadline` | ISO date, required. |

Every localized text must have at least one locale, use only locales declared in
the country's `country.json`, and include the country's `defaultLocale`.

## Seal

A seal freezes one candidate's promises in one election at one moment.

| Field | Meaning |
|---|---|
| `id` | Stable id, unique in the ledger. |
| `kind` | `interim` \| `final`. Only ONE final seal per candidate per election. |
| `electionId`, `candidateId` | Whose promises are sealed. |
| `sealedAt` | ISO 8601 UTC timestamp. |
| `promiseHeads` | Latest version of every promise of that candidate/election as of `sealedAt`; `{promiseId, version, hash}` entries sorted by `promiseId`. A withdrawn promise's head is its withdraw version. |
| `merkleRoot` | Merkle root over those heads (see below); `null` if there are none. |
| `prevSealHash` | Previous seal's `sealHash` for the same candidate/election, or `null` for the first seal. |
| `sealHash` | Recomputed from the fields above. |
| `anchors` | Optional list of `{type, reference, publishedAt}` external publications of the seal hash (e.g. a Git commit URL). Empty for now. |

## Lifecycle rules

Statuses move **only forward**: `draft → open → locked → governing → closed`.

| Action | Allowed when status is |
|---|---|
| publish | `open` |
| amend | `open` |
| withdraw | `open`, `locked`, or `governing` (never `draft`/`closed`) |
| create a **final** seal | when the status becomes `locked` |

Implemented in `src/core/lifecycle.mjs`: `canPublish`, `canAmend`, `canWithdraw`,
`canMoveTo(from, to)` (and `canFinalSeal`).

## Sealing rules (exact, so another language can re-implement)

### Canonical JSON

Like RFC 8785 (JCS) but stricter. To serialize a value:

1. Strings: normalize to Unicode **NFC** first, then escape exactly as
   `JSON.stringify` does. Lone surrogates are rejected.
2. Numbers: must be safe integers. Floats, NaN, and Infinity are **rejected**.
3. `true` / `false` → `true` / `false`; `null` → `null`.
4. Arrays: `[elem1,elem2,...]`, order preserved, no holes.
5. Objects: `{key:value,...}` with keys sorted by **UTF-16 code unit order**,
   no whitespace anywhere. Keys are NFC-normalized too.
6. `undefined`, functions, symbols, bigint, and non-plain objects are rejected.

Reference implementation: `src/core/sealing/canonical.mjs`.

### Hash

SHA-256 over the UTF-8 bytes, output as lowercase hex (64 chars). Uses
WebCrypto (`globalThis.crypto.subtle.digest`) so Node 20+ and browsers run the
same code. Reference: `src/core/sealing/hash.mjs`.

### Version hash

```
hash = sha256(canonical({
  promiseId, electionId, candidateId, version, type, content,
  reason,      // key OMITTED entirely when absent (not null)
  createdAt, prevHash
}))
```

The stored `hash` field itself is excluded from its own pre-image.

### Chain verification

For one `promiseId`, versions must form a chain:

1. Contiguous numbering 1..n, no duplicates.
2. Version 1 has `type: "publish"` and `prevHash: null`.
3. Every later version's `prevHash` equals the previous version's `hash`.
4. `"publish"` appears only as version 1.
5. No versions after a `"withdraw"`.
6. Every stored `hash` recomputes correctly from the canonical form.
7. `createdAt` never decreases along the chain.

`verifyChain()` returns `{ok, brokenAtVersion, reason}` and never throws on bad
data. Reference: `src/core/sealing/chain.mjs`.

### Merkle tree

Over a candidate's `promiseHeads` (sorted by `promiseId`):

```
leaf(i)           = sha256("leaf:" + promiseId + ":" + version + ":" + hash)
inner(left,right) = sha256("node:" + leftHex + rightHex)
```

Build level by level, pairing nodes left to right. If a level has an odd number
of nodes, the **last node is carried up unchanged** (never duplicated). The root
of zero leaves is defined as `null`.

Inclusion proofs let a voter check ONE promise against a seal without the whole
set: `merkleProof(leaves, index)` returns a bottom-up list of
`{hash, side}` steps (`side` is the verifying node's own side at that level:
combine as `node(own, peer)` for `"L"`, `node(peer, own)` for `"R"`).
`verifyProof(leaf, proof, root)` re-computes the root and compares.
Reference: `src/core/sealing/merkle.mjs`.

### Seal hash

```
sealHash = sha256(canonical({
  id, kind, electionId, candidateId, sealedAt,
  promiseHeads, merkleRoot, prevSealHash
}))
```

`anchors` is NOT covered by the seal hash (it is filled in after sealing).
`verifySeal(seal, versions)` recomputes everything and additionally checks that
`promiseHeads` matches the actual chains **as of `sealedAt`** — nothing added,
nothing removed — and that only one final seal exists per candidate/election.
Reference: `src/core/sealing/seal.mjs`.

## Limits (read this before trusting anything)

- A hash chain makes tampering **detectable**, not impossible. Anyone who can
  rewrite history *and* recompute hashes *and* replace the published ledger can
  produce a self-consistent fake. That is why seal hashes must eventually be
  published outside our database — the `anchors` field is reserved for that.
- Timestamps (`createdAt`, `sealedAt`) are only trustworthy if they were set by
  a trusted server at write time. Clients cannot be trusted with them.
- This is a prototype with test data. Nothing here is legal evidence.

## Known-answer test vectors

Other implementations MUST reproduce these exact strings/hashes. (They are also
asserted in `test/vectors.test.mjs`.)

Canonical JSON of `{b:1, a:"x", arr:[1,"two"], nested:{z:null, y:true}}`:

```
{"a":"x","arr":[1,"two"],"b":1,"nested":{"y":true,"z":null}}
```

sha256 of the ASCII string `abc` (well-known):

```
ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
```

Version hash, publish v1:

```json
{"candidateId":"alice-1","content":{"category":"roads_transport","deadline":"2027-06-30","description":{"en":"We will re-pave the main road of North State."},"successCriteria":{"en":"Voters can see it finished before the deadline."},"title":{"en":"Fix the North main road"}},"createdAt":"2026-01-05T09:00:00Z","electionId":"xx-election-2026-north-1","prevHash":null,"promiseId":"xx:promise:road-1","type":"publish","version":1}
```

→ `hash = 721ed427f4e8382e80fc6e1720b00abf85fc192fc2b1c40beea135688588e28d`
(the canonical string above is the pre-image; note the key order and no spaces)

Version hash, withdraw v2 **with** reason:

```json
{"candidateId":"alice-1","content":null,"createdAt":"2026-02-01T10:00:00Z","electionId":"xx-election-2026-north-1","prevHash":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","promiseId":"xx:promise:road-1","reason":{"en":"Merged into promise road-2"},"type":"withdraw","version":2}
```

→ `hash = a631f38b8112dca1625c1e5f223d5d34c6d7ee0fbab440c27be7bc524f24f8a3`

Version hash, same record with the `reason` key omitted entirely:

```json
{"candidateId":"alice-1","content":null,"createdAt":"2026-02-01T10:00:00Z","electionId":"xx-election-2026-north-1","prevHash":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","promiseId":"xx:promise:road-1","type":"withdraw","version":2}
```

→ `hash = 6903cd642074abd1628e2e4594a3d75f2a13ab57836076e322a458b89c61d464`

NFC normalization: the Bangla character য় written decomposed as two code points
`U+09AF U+09BC` and composed as one code point `U+09DF` are different raw
strings, but both canonicalize to `{"bn":"য়"}` and hash to:

```
dab97f48bde7a462b622f86f9608567dcd56dc3df65bb7b3df467bb88f6bdc62
```

Merkle leaves for heads `{p-a,1,"aa..a"(64×a)}`, `{p-b,1,"bb..b"}`, `{p-c,1,"cc..c"}`:

```
leaf(p-a) = 5d1094bc8eb423f7ae35a27cb48d40aeb61af505ad0b3b5c10ead1d616e168b1
leaf(p-b) = 6eeda24b60a09edcde8741270f171d4946b2c6bbdac0f06ce0435fffb6228457
leaf(p-c) = 4b32af55b70fcce5f7bab83c761003d8aa7c92ec83bc05c5fbcb9bf890ddf03e
root([p-a])       = 5d1094bc8eb423f7ae35a27cb48d40aeb61af505ad0b3b5c10ead1d616e168b1
root([p-a,p-b])   = 95057c9cb979e22edc963d0fbe5a1e63c03ac14566d04ffa2b7994d91d1f61f1
root([p-a,p-b,p-c]) = a12991f943c4ecfd29794687de975c75b317a1d9dc1eb697d845cbeaa28875f1
```

Five-leaf tree (heads `p-a..p-e`, versions 1, hashes `a`·64 … `e`·64):

```
leaf0 = 5d1094bc8eb423f7ae35a27cb48d40aeb61af505ad0b3b5c10ead1d616e168b1
leaf1 = afd41a15f843cbb161d4bbccdd6767c10c4cf54e8ed682e564ece38abe04adf5
leaf2 = 4b32af55b70fcce5f7bab83c761003d8aa7c92ec83bc05c5fbcb9bf890ddf03e
leaf3 = 0189d18a6bb9d3875346c3d33dcf0576243bfc7fc3404b7584dd13a436f9f707
leaf4 = 96da6c26290b92fa195beb717e4065676536d1d076b74f2cf2969366561534cd
root  = c9d7862f197a87217eb3af9f77f06c8faf1096dff108d979ac63ed7425d3c744
proof for leaf2 = [{"hash":"0189d18a6bb9d3875346c3d33dcf0576243bfc7fc3404b7584dd13a436f9f707","side":"L"},
                   {"hash":"a4b633188ae83cf57fc5677425c98a932fe4f1dd7d971a031ff43cc778229e7d","side":"R"},
                   {"hash":"96da6c26290b92fa195beb717e4065676536d1d076b74f2cf2969366561534cd","side":"L"}]
```

Seal hash for
`{id:"seal-alice-final", kind:"final", electionId:"xx-election-2026-north-1",
candidateId:"alice-1", sealedAt:"2026-03-01T00:00:00Z",
promiseHeads:[{promiseId:"xx:promise:road-1",version:2,hash:"ab"×32}],
merkleRoot:"cd"×32, prevSealHash:null}`:

```
sealHash = 9777e0f144db51ee39596b702d79471fff7708d98888466c5c89b4ea0c3be2ba
```

## Checking a ledger

```
node tools/verify-ledger.mjs <ledger.json> <country-folder>
```

Validates schemas, all references against the country folder, every chain, and
every seal; exit code 1 on any failure. Anyone can run it on a published ledger.

## Out of scope (v0.1)

Progress tracking, done/broken verdicts, citizen reports, and report cards are
NOT part of this format — no fields exist for them. Later, progress will be
recorded as separate append-only records that reference sealed promise versions
and never modify them.

## Versioning rules

- `formatVersion` is `major.minor`. Breaking changes require a new version;
  readers must reject unknown `formatVersion` values instead of guessing.
- Ids (`electionId`, `candidateId`, `promiseId`, seal ids) are permanent once
  published: never edit, never reuse.
- Adding a new optional field keeps `0.1` until the format stabilizes at `1.0`.
