#!/usr/bin/env node
/**
 * validate.mjs — validates an Electoral Region Format country folder.
 *
 * Usage: node tools/validate.mjs <country-folder>
 *   e.g. node tools/validate.mjs data/bd
 *        node tools/validate.mjs spec/examples/minimal-country
 *
 * Checks:
 *  - JSON Schema validity (spec/schema/country.schema.json, regions.schema.json)
 *  - unique region ids
 *  - every level referenced by a region exists
 *  - every parentId exists; parent rank < child rank
 *  - non-hierarchical levels have parentId null
 *  - composedOf references exist
 *  - electionType.regionLevel exists
 *  - names include the country defaultLocale
 *  - no cycles in the parent tree
 *
 * Exits 1 on any error, 0 when valid. Only dependency: ajv.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import Ajv2020 from "ajv/dist/2020.js";

const repoRoot = resolve(import.meta.dirname, "..");

function loadJson(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (e) {
    fail([`Cannot read ${path}: ${e.message}`]);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    fail([`${path} is not valid JSON: ${e.message}`]);
  }
}

function fail(errors) {
  console.error("VALIDATION FAILED");
  for (const err of errors) console.error(`  ✗ ${err}`);
  process.exit(1);
}

function humanizeSchemaError(err) {
  const where = err.instancePath || "(root)";
  let msg = `${where}: ${err.message}`;
  if (err.params && err.params.additionalProperty !== undefined) {
    msg += ` (unexpected property "${err.params.additionalProperty}")`;
  }
  return msg;
}

// ---- locate files -------------------------------------------------------

const folderArg = process.argv[2];
if (!folderArg) {
  console.error("Usage: node tools/validate.mjs <country-folder>  (e.g. data/bd)");
  process.exit(1);
}
const folder = resolve(repoRoot, folderArg);
const countryPath = join(folder, "country.json");
const regionsPath = join(folder, "regions.json");

const country = loadJson(countryPath);
const regions = loadJson(regionsPath);

// ---- JSON Schema validation --------------------------------------------

const ajv = new Ajv2020({ allErrors: true, strict: true });
const countrySchema = loadJson(join(repoRoot, "spec", "schema", "country.schema.json"));
const regionsSchema = loadJson(join(repoRoot, "spec", "schema", "regions.schema.json"));

const schemaErrors = [];
const checkCountry = ajv.compile(countrySchema);
if (!checkCountry(country)) {
  for (const e of checkCountry.errors) schemaErrors.push(`country.json ${humanizeSchemaError(e)}`);
}
const checkRegions = ajv.compile(regionsSchema);
if (!checkRegions(regions)) {
  for (const e of checkRegions.errors) schemaErrors.push(`regions.json ${humanizeSchemaError(e)}`);
}
if (schemaErrors.length > 0) fail(schemaErrors);

// ---- cross-file / semantic checks --------------------------------------

const errors = [];

// formatVersion must be understood
if (country.formatVersion !== "0.1") {
  errors.push(`Unsupported formatVersion "${country.formatVersion}" (this tool understands "0.1").`);
}

const defaultLocale = country.country.defaultLocale;
if (!country.country.locales.includes(defaultLocale)) {
  errors.push(`country.json: defaultLocale "${defaultLocale}" is not listed in locales.`);
}

// levels
const levels = new Map(); // id -> {rank, hierarchical}
for (const lvl of country.levels) {
  if (levels.has(lvl.id)) errors.push(`country.json: duplicate level id "${lvl.id}".`);
  levels.set(lvl.id, lvl);
  if (!lvl.names[defaultLocale]) {
    errors.push(`country.json level "${lvl.id}": names missing defaultLocale "${defaultLocale}".`);
  }
}

// electionTypes
const electionTypeIds = new Set();
for (const et of country.electionTypes) {
  if (electionTypeIds.has(et.id)) errors.push(`country.json: duplicate electionType id "${et.id}".`);
  electionTypeIds.add(et.id);
  if (!levels.has(et.regionLevel)) {
    errors.push(`country.json electionType "${et.id}": regionLevel "${et.regionLevel}" does not exist in levels.`);
  }
  if (!et.names[defaultLocale]) {
    errors.push(`country.json electionType "${et.id}": names missing defaultLocale "${defaultLocale}".`);
  }
  const posIds = new Set();
  for (const p of et.positions) {
    if (posIds.has(p.id)) errors.push(`country.json electionType "${et.id}": duplicate position id "${p.id}".`);
    posIds.add(p.id);
    if (!p.names[defaultLocale]) {
      errors.push(`country.json electionType "${et.id}" position "${p.id}": names missing defaultLocale "${defaultLocale}".`);
    }
  }
}

// regions: index + basic checks
const byId = new Map();
for (const r of regions) {
  if (byId.has(r.id)) errors.push(`regions.json: duplicate region id "${r.id}".`);
  byId.set(r.id, r);
}

for (const r of regions) {
  const expectedPrefix = `${country.country.code}:`;
  if (!r.id.startsWith(expectedPrefix)) {
    errors.push(`${r.id}: id does not start with "${expectedPrefix}" (country code mismatch).`);
  }
  const parts = r.id.split(":");
  if (parts.length === 3 && parts[1] !== r.level) {
    errors.push(`${r.id}: id embeds level "${parts[1]}" but the "level" field says "${r.level}".`);
  }

  const lvl = levels.get(r.level);
  if (!lvl) {
    errors.push(`${r.id}: level "${r.level}" does not exist in country.json levels.`);
    continue; // further level-dependent checks are meaningless
  }
  if (!r.names[defaultLocale]) {
    errors.push(`${r.id}: names missing defaultLocale "${defaultLocale}".`);
  }
  // names should only use declared locales
  for (const loc of Object.keys(r.names)) {
    if (!country.country.locales.includes(loc)) {
      errors.push(`${r.id}: name locale "${loc}" is not declared in country.json locales.`);
    }
  }

  if (r.parentId !== null && r.parentId !== undefined) {
    if (!lvl.hierarchical) {
      errors.push(`${r.id}: level "${r.level}" is non-hierarchical, so parentId must be null (got "${r.parentId}").`);
    }
    const parent = byId.get(r.parentId);
    if (!parent) {
      errors.push(`${r.id}: parentId "${r.parentId}" does not exist in regions.json.`);
    } else {
      const parentLvl = levels.get(parent.level);
      if (parentLvl && !(parentLvl.rank < lvl.rank)) {
        errors.push(`${r.id}: parent "${parent.id}" has level rank ${parentLvl.rank}, which is not lower than child rank ${lvl.rank}.`);
      }
    }
  }

  if (r.composedOf) {
    for (const ref of r.composedOf) {
      if (!byId.has(ref)) errors.push(`${r.id}: composedOf reference "${ref}" does not exist in regions.json.`);
      if (ref === r.id) errors.push(`${r.id}: composedOf references itself.`);
    }
  }
}

// cycle detection in the parent tree (iterative walk with per-path set)
const KNOWN = 2;
const state = new Map(); // id -> KNOWN once fully processed
for (const start of regions) {
  if (state.get(start.id) === KNOWN) continue;
  const onPath = new Set();
  const path = [];
  let cur = start;
  while (cur && state.get(cur.id) !== KNOWN) {
    if (onPath.has(cur.id)) {
      const at = path.indexOf(cur.id);
      errors.push(`Parent cycle detected: ${path.slice(at).join(" -> ")} -> ${cur.id}`);
      break;
    }
    onPath.add(cur.id);
    path.push(cur.id);
    const pid = cur.parentId ?? null;
    cur = pid ? byId.get(pid) : undefined; // missing parents are reported above
  }
  for (const id of path) state.set(id, KNOWN);
}

if (errors.length > 0) fail(errors);

// ---- summary -------------------------------------------------------------
const counts = {};
for (const r of regions) counts[r.level] = (counts[r.level] ?? 0) + 1;
console.log(`VALID: ${folderArg}`);
console.log(`  country: ${country.country.names[defaultLocale]} (${country.country.code}), formatVersion ${country.formatVersion}`);
console.log(`  regions: ${regions.length} total`);
for (const [lvlId, n] of Object.entries(counts)) {
  console.log(`    - ${lvlId}: ${n}`);
}
for (const lvlId of levels.keys()) {
  if (!(lvlId in counts)) console.log(`    - ${lvlId}: 0 (no regions yet)`);
}
console.log(`  electionTypes: ${country.electionTypes.map((e) => e.id).join(", ")}`);
