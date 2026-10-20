/**
 * ledger.mjs — shared verification logic for one ledger file against a country
 * folder. Used by tools/verify-ledger.mjs and by the tests. Not security
 * sensitive itself; it delegates all crypto to src/core/sealing/*.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { verifyAllChains } from "../src/core/sealing/chain.mjs";
import { verifySeal } from "../src/core/sealing/seal.mjs";
import { makeLedgerValidator, loadJson, repoRoot } from "./schemas.mjs";

function err(list, msg) {
  list.push(msg);
}

/**
 * Verify a parsed ledger object against a country folder (country.json +
 * regions.json). Returns an array of human-readable error strings (empty = OK).
 */
export async function verifyLedger(ledger, countryFolder) {
  const errors = [];

  // 1. JSON Schema validation of the whole ledger.
  const validateLedger = makeLedgerValidator();
  const schemaErrors = validateLedger(ledger);
  for (const e of schemaErrors) err(errors, `schema: ${e}`);
  if (errors.length > 0) return errors; // semantic checks assume a well-formed ledger

  if (ledger.formatVersion !== "0.1") {
    err(errors, `unsupported ledger formatVersion "${ledger.formatVersion}" (this tool understands "0.1")`);
    return errors;
  }

  // 2. Load the country folder.
  let country, regions;
  try {
    country = loadJson(join(countryFolder, "country.json"));
    regions = loadJson(join(countryFolder, "regions.json"));
  } catch (e) {
    err(errors, `cannot read country folder ${countryFolder}: ${e.message}`);
    return errors;
  }
  if (country.formatVersion !== "0.1") {
    err(errors, `unsupported country formatVersion "${country.formatVersion}"`);
    return errors;
  }

  const defaultLocale = country.country.defaultLocale;
  const locales = new Set(country.country.locales);
  const levels = new Map(country.levels.map((l) => [l.id, l]));
  const electionTypes = new Map(country.electionTypes.map((t) => [t.id, t]));
  const regionById = new Map(regions.map((r) => [r.id, r]));

  // 3. Elections: country code, type, region, level match, locale coverage.
  const elections = new Map();
  for (const el of ledger.elections) {
    if (elections.has(el.id)) err(errors, `election ${el.id}: duplicate election id`);
    elections.set(el.id, el);
    if (el.countryCode !== country.country.code) {
      err(errors, `election ${el.id}: countryCode "${el.countryCode}" does not match country.json code "${country.country.code}"`);
    }
    const type = electionTypes.get(el.electionTypeId);
    if (!type) {
      err(errors, `election ${el.id}: electionTypeId "${el.electionTypeId}" does not exist in country.json`);
    }
    const region = regionById.get(el.regionId);
    if (!region) {
      err(errors, `election ${el.id}: regionId "${el.regionId}" does not exist in regions.json`);
    } else if (type && region.level !== type.regionLevel) {
      err(errors, `election ${el.id}: region "${el.regionId}" has level "${region.level}" but election type "${type.id}" runs at level "${type.regionLevel}"`);
    }
    if (!el.names[defaultLocale]) {
      err(errors, `election ${el.id}: names missing defaultLocale "${defaultLocale}"`);
    }
    for (const loc of Object.keys(el.names)) {
      if (!locales.has(loc)) err(errors, `election ${el.id}: name locale "${loc}" is not declared in country.json`);
    }
    // date sanity
    const d = el.dates;
    if (!(d.nominationOpens <= d.electionDay && d.electionDay <= d.termStart && d.termStart < d.termEnd)) {
      err(errors, `election ${el.id}: dates must satisfy nominationOpens <= electionDay <= termStart < termEnd`);
    }
  }

  // 4. Candidates: election exists, position exists in that election type.
  const candidates = new Map();
  for (const c of ledger.candidates) {
    if (candidates.has(c.id)) err(errors, `candidate ${c.id}: duplicate candidate id`);
    candidates.set(c.id, c);
    const el = elections.get(c.electionId);
    if (!el) {
      err(errors, `candidate ${c.id}: electionId "${c.electionId}" does not exist`);
      continue;
    }
    const type = electionTypes.get(el.electionTypeId);
    if (type && !type.positions.some((p) => p.id === c.positionId)) {
      err(errors, `candidate ${c.id}: positionId "${c.positionId}" is not a position of election type "${type.id}"`);
    }
    if (!c.names[defaultLocale]) {
      err(errors, `candidate ${c.id}: names missing defaultLocale "${defaultLocale}"`);
    }
    for (const loc of Object.keys(c.names)) {
      if (!locales.has(loc)) err(errors, `candidate ${c.id}: name locale "${loc}" is not declared in country.json`);
    }
  }

  // 5. Promise versions: references, locales, content rules.
  for (const v of ledger.promiseVersions) {
    const where = `${v.promiseId} v${v.version}`;
    const el = elections.get(v.electionId);
    if (!el) err(errors, `${where}: electionId "${v.electionId}" does not exist`);
    const cand = candidates.get(v.candidateId);
    if (!cand) err(errors, `${where}: candidateId "${v.candidateId}" does not exist`);
    else if (cand.electionId !== v.electionId) err(errors, `${where}: candidate "${cand.id}" belongs to election "${cand.electionId}", not "${v.electionId}"`);

    const texts = [];
    if (v.content) texts.push(v.content.title, v.content.description, v.content.successCriteria);
    if (v.reason) texts.push(v.reason);
    for (const t of texts) {
      if (!t || Object.keys(t).length === 0) err(errors, `${where}: localized text field is empty`);
      if (!t[defaultLocale]) err(errors, `${where}: a localized text field is missing defaultLocale "${defaultLocale}"`);
      for (const loc of Object.keys(t)) {
        if (!locales.has(loc)) err(errors, `${where}: text locale "${loc}" is not declared in country.json`);
      }
    }
  }

  // 6. Chain verification (hashes, ordering, withdraw rules).
  const chainResults = await verifyAllChains(ledger.promiseVersions);
  for (const r of chainResults) {
    if (!r.ok) err(errors, `chain ${r.promiseId}: broken at version ${r.brokenAtVersion}: ${r.reason}`);
  }

  // 7. Seals.
  for (const s of ledger.seals) {
    const el = elections.get(s.electionId);
    if (!el) err(errors, `seal ${s.id}: electionId "${s.electionId}" does not exist`);
    const cand = candidates.get(s.candidateId);
    if (!cand) err(errors, `seal ${s.id}: candidateId "${s.candidateId}" does not exist`);
    else if (el && cand.electionId !== s.electionId) {
      err(errors, `seal ${s.id}: candidate "${cand.id}" is not in election "${s.electionId}"`);
    }
    const res = await verifySeal(s, ledger.promiseVersions, ledger.seals);
    if (!res.ok) err(errors, `seal ${s.id}: ${res.reason}`);
  }

  return errors;
}

/** Convenience: load a ledger file and verify it against a country folder path. */
export async function verifyLedgerFile(ledgerPath, countryFolderPath) {
  const absLedger = resolve(process.cwd(), ledgerPath);
  const absCountry = resolve(process.cwd(), countryFolderPath);
  let ledger;
  try {
    ledger = JSON.parse(readFileSync(absLedger, "utf8"));
  } catch (e) {
    return [`cannot read ledger ${ledgerPath}: ${e.message}`];
  }
  return verifyLedger(ledger, absCountry);
}

export { repoRoot };
