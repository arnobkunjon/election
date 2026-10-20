# promise-ledger

An open-source **promise ledger** for elections. Before an election, candidates publish
their promises here. Each published promise is **sealed**: it is append-only and can
never be edited afterwards. After the term ends, voters can compare, side by side, what
a candidate promised and what they actually delivered. The first dataset is Bangladesh,
but any country can adopt the project by adding one data folder (see below).

> **Status: prototype / test project — not live.** All data in this repository is test
> data. Nothing here should be treated as verified or production-ready.

## How it works today (Task 1: foundation)

Right now the repo contains only the **Electoral Region Format** and the tooling around
it — no Firebase, no web app, no UI yet:

- `spec/` — the format specification, JSON Schemas (draft 2020-12), and a tiny valid
  example country for contributors.
- `data/bd/` — the Bangladesh dataset (divisions, districts, upazilas, unions), built
  from public sources; see its README for licenses and known gaps.
- `tools/` — Node.js (ESM) scripts to validate a country folder and to rebuild the
  Bangladesh data.
- `docs/` — contributor guides.

The sealed-promise idea: once the ledger layer is built, a promise is written exactly
once, cryptographically sealed (hash + timestamp), and later updates are new entries —
never edits. Voters then see *promised vs. delivered* per region and per position.

## Roadmap

1. ✅ Repository foundation: region format, schemas, validator, Bangladesh data (this step).
2. Web app (first): publish, seal, and browse promises.
3. Mobile app (after the web app).
4. Firebase backend (later; the format and tools stay backend-agnostic).

## Quick start

```bash
npm install                      # only dependency: ajv
npm run validate                 # validate data/bd
npm run validate:examples        # validate spec/examples/minimal-country
npm run build:bd                 # regenerate data/bd/regions.json from upstream sources
```

Requires Node.js 18+ (built-in fetch).

## Adopt it for your country

Add a folder `data/<yourcountry>/` with `country.json` and `regions.json` following the
format in `spec/electoral-region-format.md`. Step-by-step instructions:
[docs/ADDING_A_COUNTRY.md](docs/ADDING_A_COUNTRY.md).

## License

MIT for all code (see `LICENSE`). Data files may carry their own source licenses — check
each `data/<country>/README.md`.
