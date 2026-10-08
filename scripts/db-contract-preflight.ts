import { readFileSync } from "node:fs";

import {
  type CatalogSnapshot,
  PREFLIGHT_SQL,
  validateCatalogSnapshot,
} from "../src/lib/db-contract-preflight-core";

const fixtureFlag = "--fixture";
const fixtureIndex = process.argv.indexOf(fixtureFlag);

if (fixtureIndex === -1) {
  console.log("-- Read-only Supabase catalog/data preflight. Execute this SQL via Supabase MCP.");
  console.log("-- No INSERT, UPDATE, DELETE, ALTER, CREATE, DROP, or SET statements are emitted.");
  console.log(PREFLIGHT_SQL);
  process.exit(0);
}

const fixturePath = process.argv[fixtureIndex + 1];
if (!fixturePath) {
  console.error("Usage: bun scripts/db-contract-preflight.ts --fixture <json-file>");
  process.exit(2);
}

let snapshot: CatalogSnapshot;
try {
  snapshot = JSON.parse(readFileSync(fixturePath, "utf8")) as CatalogSnapshot;
} catch (error) {
  console.error(
    `Could not read preflight fixture: ${error instanceof Error ? error.message : "invalid JSON"}`,
  );
  process.exit(2);
}

const result = validateCatalogSnapshot(snapshot);
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);
