// Writes supabase/functions/_shared/contracts/mail-local.json from mail.ts
// (specs/mail-rebuild.md decision 25). `--check` exits 1 when the file is stale.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { MAIL_LOCAL_CONTRACT } from "../../supabase/functions/_shared/contracts/mail.ts";

const out = join(import.meta.dir, "../../supabase/functions/_shared/contracts/mail-local.json");
const next = `${JSON.stringify(MAIL_LOCAL_CONTRACT, null, 2)}\n`;
if (process.argv.includes("--check")) {
  if (readFileSync(out, "utf8") !== next) {
    console.error("mail-local.json is stale: run bun scripts/mail/export-contracts.ts");
    process.exit(1);
  }
} else {
  writeFileSync(out, next);
}
