# Contributing

Thanks for helping! This is a prototype project, so early contributions are welcome —
just keep expectations aligned: nothing here is live or production-ready yet.

## What we accept right now

1. **Data improvements** — fixes to `data/bd/` (spelling, missing regions, better
   sources) and new country folders (`data/<cc>/`, see `docs/ADDING_A_COUNTRY.md`).
2. **Format feedback** — issues and PRs against `spec/electoral-region-format.md` and
   the JSON Schemas.
3. **Tooling** — improvements to `tools/validate.mjs` and the build scripts.

Later: the web app, then mobile, then Firebase. Watch the roadmap in `README.md`.

## Ground rules

- **Never invent data.** If a source is unclear or unavailable, add a TODO instead.
  Election-related numbers (seat counts, mappings) must cite a source and be marked
  for human verification unless already verified.
- **Region ids are permanent.** Once merged, never edit or reuse a `bd:...` style id.
- **Keep dependencies minimal.** Today the only runtime dependency is `ajv`; build
  scripts use built-in Node `fetch`. Propose anything bigger in an issue first.
- **Validate before you PR:**

  ```bash
  npm install
  node tools/validate.mjs data/bd                     # or your new country folder
  node tools/validate.mjs spec/examples/minimal-country
  ```

  CI-equivalent: both commands must exit 0.
- **Code style:** plain ESM JavaScript, no build step, small functions, comments where
  the format rules matter.
- **Licenses:** list every external data source and its license in your folder's
  `README.md`. If a license is unknown or restrictive, do not use the data — say so in
  a TODO instead.

## Pull requests

- Small, focused commits with clear messages (e.g. `data/bd: fix union spelling for ...`).
- Describe: what changed, which sources you used, what remains unverified.
- A human reviews all data claims before merging.

## Reporting problems

Open an issue with the file, the region id (if any), and the source that contradicts it.
For security issues, open a normal issue for now (this is a test project).
