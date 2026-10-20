/**
 * schemas.mjs — shared loader for the JSON Schemas in spec/schema/.
 * Not security-sensitive; used by the CLI tools.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";

export const repoRoot = resolve(import.meta.dirname, "..");

export function loadJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Build one Ajv instance with all ledger-related schemas compiled.
 * Returns { validateLedger(ledger): string[] /* errors *\/ }.
 */
export function makeLedgerValidator() {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const dir = join(repoRoot, "spec", "schema");
  for (const name of [
    "election.schema.json",
    "candidate.schema.json",
    "promise-version.schema.json",
    "seal.schema.json",
    "ledger.schema.json",
  ]) {
    ajv.addSchema(loadJson(join(dir, name)));
  }
  const check = ajv.getSchema(
    "https://github.com/promise-ledger/promise-ledger/spec/schema/ledger.schema.json"
  );
  return function validateLedger(ledger) {
    if (check(ledger)) return [];
    return check.errors.map((e) => humanize(e));
  };
}

export function humanize(err) {
  const where = err.instancePath || "(root)";
  let msg = `${where}: ${err.message}`;
  if (err.params && err.params.additionalProperty !== undefined) {
    msg += ` (unexpected property "${err.params.additionalProperty}")`;
  }
  return msg;
}
