#!/usr/bin/env node
/**
 * build-bd-from-sources.mjs — generates data/bd/regions.json from the
 * nuhil/bangladesh-geocode repository (divisions, districts, upazilas, unions).
 *
 * Usage: node tools/build-bd-from-sources.mjs
 *
 * Safety rule: if a file cannot be fetched, or its columns differ from what we
 * expect, the script STOPS with a clear message. It never invents data.
 *
 * Source: https://github.com/nuhil/bangladesh-geocode (MIT License, (c) 2014 Nuhil Mehdy)
 * Only Node built-ins are used (fetch, fs).
 */

import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";

const BASE = "https://raw.githubusercontent.com/nuhil/bangladesh-geocode/master";

const SOURCES = [
  { level: "division", url: `${BASE}/divisions/divisions.json`, expectedColumns: ["id", "name", "bn_name"] },
  { level: "district", url: `${BASE}/districts/districts.json`, expectedColumns: ["id", "division_id", "name", "bn_name"] },
  { level: "upazila", url: `${BASE}/upazilas/upazilas.json`, expectedColumns: ["id", "district_id", "name", "bn_name"] },
  { level: "union", url: `${BASE}/unions/unions.json`, expectedColumns: ["id", "upazilla_id", "name", "bn_name"] },
];

// parent level per source foreign-key column
const PARENT_FK = {
  district: { column: "division_id", level: "division" },
  upazila: { column: "district_id", level: "district" },
  union: { column: "upazilla_id", level: "upazila" }, // note: source spells it "upazilla_id"
};

function stop(msg) {
  console.error(`STOPPED: ${msg}`);
  console.error("This script refuses to continue rather than invent data. Check the source repo and re-run.");
  process.exit(1);
}

async function fetchJson(url) {
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    stop(`Network error fetching ${url}: ${e.message}`);
  }
  if (!res.ok) stop(`Cannot fetch ${url}: HTTP ${res.status} ${res.statusText}`);
  try {
    return await res.json();
  } catch (e) {
    stop(`Response from ${url} is not valid JSON: ${e.message}`);
  }
}

function extractRows(doc, url) {
  // phpMyAdmin-style export: array of header/database objects, last one holds "data".
  if (!Array.isArray(doc)) stop(`${url}: expected a JSON array (phpMyAdmin export), got ${typeof doc}.`);
  const table = doc.find((x) => x && x.type === "table" && Array.isArray(x.data));
  if (!table) stop(`${url}: could not find a {"type":"table","data":[...]} block. The export format may have changed.`);
  return table.data;
}

function checkColumns(rows, expected, url) {
  if (rows.length === 0) stop(`${url}: table has zero rows. Refusing to produce an empty dataset.`);
  const first = rows[0];
  const missing = expected.filter((c) => !(c in first));
  if (missing.length > 0) {
    stop(`${url}: expected columns ${JSON.stringify(expected)} but row 1 has ${JSON.stringify(Object.keys(first))} (missing: ${missing.join(", ")}). Columns differ from what this script expects.`);
  }
}

const repoRoot = resolve(import.meta.dirname, "..");
const outDir = join(repoRoot, "data", "bd");

console.log("Fetching source files...");
const dataByLevel = {};
for (const src of SOURCES) {
  console.log(`  - ${src.level}: ${src.url}`);
  const doc = await fetchJson(src.url);
  const rows = extractRows(doc, src.url);
  checkColumns(rows, src.expectedColumns, src.url);
  console.log(`    ok, ${rows.length} rows`);
  dataByLevel[src.level] = rows;
}

// Build id lookup: source numeric id -> region id, per level.
const regions = [];
const idsByLevel = {}; // level -> Map(sourceId -> regionId)

for (const src of SOURCES) {
  const map = new Map();
  for (const row of dataByLevel[src.level]) {
    const sourceCode = String(row.id);
    if (map.has(sourceCode)) stop(`${src.level}: duplicate source id "${sourceCode}" in ${src.url}.`);
    const regionId = `bd:${src.level}:${sourceCode}`;
    map.set(sourceCode, regionId);
    regions.push({ id: regionId, level: src.level, sourceRow: row });
  }
  idsByLevel[src.level] = map;
}

// Resolve parents and emit final region objects.
const output = [];
for (const r of regions) {
  const row = r.sourceRow;
  const fk = PARENT_FK[r.level];
  let parentId = null;
  if (fk) {
    const parentSourceId = String(row[fk.column]);
    parentId = idsByLevel[fk.level]?.get(parentSourceId) ?? null;
    if (parentId === null) {
      stop(`${r.id}: parent reference ${fk.column}="${parentSourceId}" (${fk.level}) not found in the source data. Not inventing a parent.`);
    }
  }
  const names = { en: String(row.name).trim(), bn: String(row.bn_name).trim() };
  if (!names.en) stop(`${r.id}: empty English name in source.`);
  if (!names.bn) stop(`${r.id}: empty Bangla name in source.`);
  output.push({
    id: r.id,
    level: r.level,
    parentId,
    names,
    codes: { source: String(row.id) },
  });
}

output.sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));

const outFile = join(outDir, "regions.json");
writeFileSync(outFile, JSON.stringify(output, null, 2) + "\n", "utf8");

const counts = {};
for (const r of output) counts[r.level] = (counts[r.level] ?? 0) + 1;
console.log(`\nWrote ${output.length} regions to data/bd/regions.json`);
for (const [lvl, n] of Object.entries(counts)) console.log(`  ${lvl}: ${n}`);
console.log("\nNext: node tools/validate.mjs data/bd");
