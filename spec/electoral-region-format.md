# Electoral Region Format (v0.1)

This document describes how a country is represented in this project, so that any
country can adopt the promise ledger by adding one data folder.

Status: **draft v0.1**. This is a test/prototype format. It may still change.

## What a country folder contains

A country folder (for example `data/bd/`) must contain at least two files:

- `country.json` — describes the country: its code, languages, administrative
  levels, and election types.
- `regions.json` — a list of all regions (divisions, districts, ... ) of that country.

Optional files: `geometry/*.geojson` (boundary files), mapping templates, a `README.md`.

## country.json

### Top-level fields

| Field | Meaning |
|---|---|
| `formatVersion` | Which version of this format the file uses. Currently `"0.1"`. |
| `country` | Country metadata (code, names, locales). |
| `levels` | The administrative/electoral levels this country uses. |
| `electionTypes` | The kinds of elections held in this country. |

### country

- `code`: ISO 3166-1 alpha-2, lowercase, e.g. `"bd"` for Bangladesh.
- `names`: map of locale to translated country name, e.g. `{"en": "Bangladesh", "bn": "বাংলাদেশ"}`.
- `defaultLocale`: the locale used when a translation is missing (e.g. `"en"`).
- `locales`: every locale used anywhere in the folder (e.g. `["en", "bn"]`).

### levels

A level is one step in the administrative ladder, e.g. division, district, upazila.

Each level has:

- `id`: short lowercase identifier (`division`, `upazila`, ...).
- `rank`: depth in the hierarchy. `0` = top. A child's rank must be strictly greater
  than its parent's rank.
- `hierarchical`: `true` or `false` (see below).
- `names`: localized display name.

Bangladesh hierarchical chain: `division(0) > district(1) > upazila(2) > union(3) > ward(4)`.
(Wards are not in the dataset yet.)

#### Hierarchical vs non-hierarchical levels

- **Hierarchical** levels form the parent tree. Every region of such a level either
  has a `parentId` pointing to a region exactly one step above (lower rank), or is a
  top-level region (`parentId: null`).
- **Non-hierarchical** levels do **not** belong to the parent tree. Examples:
  `city_corporation` (its internal structure differs from division→district→...) and
  `constituency` (an electoral layer drawn across administrative boundaries).
  Regions of non-hierarchical levels **must have `parentId: null`**. Their rank values
  keep them out of the hierarchical chain.

### electionTypes

Each election type says at which level the election happens and which positions are
elected there:

- `id`, `names`: identifiers and labels.
- `regionLevel`: the level id where candidates run (must exist in `levels`).
- `positions[]`: each with `id`, `names`, and `seatsPerRegion` (integer ≥ 1) — how many
  seats of that position are elected per region.

Example: parliamentary elections run at level `constituency` with one position `mp`
and `seatsPerRegion: 1`.

> **Note for Bangladesh:** the election types included in `data/bd/country.json` are
> *illustrative*. Seat numbers (e.g. 9 ward members, 3 reserved women members) must be
> verified against current law before production use.

## regions.json

A JSON array of region objects.

- `id`: stable string, format `{countryCodeLower}:{level}:{sourceCode}`.
  Example: `bd:upazila:302614`. The `sourceCode` is whatever id the upstream source
  uses, so the link back to the source is never lost. Once published, ids must never
  change and never be reused.
- `level`: must exist in `country.json` → `levels`.
- `parentId`: `null`, or the `id` of the parent region. Only allowed for hierarchical
  levels; the parent's rank must be lower than the child's rank.
- `names`: localized names. Must include the country's `defaultLocale`.
- `composedOf` *(optional)*: list of region ids this region is made of. Used for
  non-hierarchical levels, e.g. a constituency composed of several upazilas. All
  referenced ids must exist in the same file.
- `codes` *(optional)*: object of external codes, e.g. `{"bbs": "...", "source": "..."}`.
- `geometry` *(optional)*: relative path (inside the country folder) to a GeoJSON file,
  e.g. `"geometry/bd/upazila/302614.geojson"`. Geometry is **never** embedded inside
  `regions.json` — the file stays small and diff-friendly.

## Validation rules (checked by `tools/validate.mjs`)

1. Both files pass their JSON Schemas (`spec/schema/*.schema.json`, draft 2020-12).
2. All region ids are unique.
3. Every `parentId` exists in `regions.json`.
4. Parent's level rank < child's level rank.
5. Regions of non-hierarchical levels have `parentId: null`.
6. Every `composedOf` reference exists.
7. Every `electionType.regionLevel` exists in `levels`.
8. Every region's `names` includes the country's `defaultLocale`.
9. No cycles in the parent tree.

## Versioning rules

- `formatVersion` is `major.minor`. Breaking changes (renamed fields, removed fields,
  changed meanings) require a new minor/major version; adding optional fields keeps
  `0.1` until the format stabilizes at `1.0`.
- Readers must reject unknown `formatVersion` values rather than guess.
- Region `id`s are permanent: never edit an id, even if a name or boundary changes.
  Retire a region by removing it from a future dataset version, keeping history outside
  these files.
- Level ids and election type ids are also treated as permanent once published.
