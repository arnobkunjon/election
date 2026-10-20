# Adding a country

This project is designed so that any country can adopt it by adding **one data folder**.
No code changes are needed. This guide walks you through it.

Everything here is plain English and test-friendly: do not worry about being perfect,
but do mark anything unverified.

## What you need

- Node.js 18 or newer.
- A checkout of this repository (`git clone`, then `npm install`).
- Permission to use the license of whatever data source you pick (say the license in
  your folder's README).

## Step 1 — Copy the minimal example

The folder `spec/examples/minimal-country/` is a tiny, fully valid country. Copy it:

```bash
cp -r spec/examples/minimal-country data/zz   # "zz" = your ISO 3166-1 alpha-2 code, lowercase
```

## Step 2 — Edit country.json

Open `data/zz/country.json` and change:

- `country.code` → your ISO alpha-2 code (lowercase, e.g. `"np"`).
- `country.names`, `defaultLocale`, `locales` → your country name and languages.
  Locale codes like `en`, `bn`, `es`. The `defaultLocale` must appear in `locales`
  and in every `names` object.
- `levels` → your administrative ladder. Give each level a stable lowercase `id`,
  a `rank` (0 = top), and `hierarchical: true` if it belongs to the parent tree.
  Electoral layers that cut across the tree (like constituencies) get
  `hierarchical: false` and a high rank so they never sit in a parent chain.
- `electionTypes` → each election at a `regionLevel` with its `positions` and
  `seatsPerRegion`. If you are not sure about seat numbers, write them down but mark
  them "illustrative, verify before production" in your folder README.

Keep `formatVersion` as `"0.1"`.

## Step 3 — Build regions.json

Create the list of actual regions. For small countries you can hand-write it; for
larger ones, write a generator script under `tools/` (see
`tools/build-bd-from-sources.mjs` for the pattern: download from a public source,
map columns, **stop on any mismatch instead of inventing data**).

Rules to remember:

- Region id: `{countryCodeLower}:{level}:{sourceCode}` — e.g. `bd:upazila:302614`.
  Ids are permanent: never edit or reuse one.
- Hierarchical levels: `parentId` points to the parent region (or `null` at the top).
- Non-hierarchical levels: `parentId` must be `null`; use `composedOf` to say which
  regions they are made of.
- Geometry goes in separate `.geojson` files referenced by a relative path, never
  inside `regions.json`.

## Step 4 — Write your folder README

In `data/zz/README.md` list:

- Sources (URLs) and their licenses — state clearly whether you checked the license.
- Known gaps and TODOs (missing levels, unverified seat counts, missing boundaries).

## Step 5 — Validate

```bash
node tools/validate.mjs data/zz
```

Fix everything it reports until you see `VALID: data/zz`. The validator checks schema
validity, unique ids, parent existence, parent-rank ordering, non-hierarchical rules,
`composedOf` references, `electionType.regionLevel`, defaultLocale names, and cycles.

## Step 6 — Open a pull request

Commit your `data/zz/` folder (and any new generator script), push, and open a PR.
Keep the PR description short: country, sources, licenses, known gaps. A human will
review the data claims — especially election types and any mapping you added.

That's it. Once merged, your country can use the promise ledger the same way
Bangladesh does.
