import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "@rstest/core";

// AC39 "no legacy email engine paths" (specs/mail-rebuild.md decision 24, MR-16).
// LEGACY lists every path of the old mail engine and UI. PENDING_REMOVAL was the
// ratchet that let them stay until the cutover; MR-16 deleted them, so it is
// empty and any legacy path that comes back fails outright.
const root = path.resolve(import.meta.dirname, "../..");
const tauri = "apps/desktop/src-tauri";
const ui = "apps/app/src/features/email";

const LEGACY = [
  `${tauri}/src/commands/email.rs`,
  `${tauri}/src/commands/email`,
  `${tauri}/src/email_sync`,
  `${ui}/ui/email-page-view.tsx`,
  `${ui}/ui/email-search-bar.tsx`,
  `${ui}/hooks/use-email-search.ts`,
  `${ui}/hooks/use-email-module.ts`,
  `${ui}/ui/email-thread-list.tsx`,
  `${ui}/ui/email-rail.tsx`,
  `${ui}/ui/email-reader.tsx`,
  `${ui}/ui/email-compose.tsx`,
  `${ui}/ui/email-sync-banner.tsx`,
] as const;

const PENDING_REMOVAL: readonly string[] = [];

const exists = (rel: string) => fs.existsSync(path.join(root, rel));
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

describe("no legacy email engine paths", () => {
  it("allows no legacy path outside the pending list", () => {
    const stray = LEGACY.filter((p) => exists(p) && !PENDING_REMOVAL.includes(p));
    expect(stray).toEqual([]);
  });

  it("strikes a pending path once it is deleted (the list only shrinks)", () => {
    const gone = PENDING_REMOVAL.filter((p) => !exists(p));
    expect(gone).toEqual([]);
  });

  it("keeps mailparse out once the legacy engine is gone", () => {
    const cargo = read(`${tauri}/Cargo.toml`);
    const legacyLeft = PENDING_REMOVAL.some((p) => p.startsWith(tauri));
    if (!legacyLeft) expect(cargo).not.toMatch(/^mailparse\s*=/m);
  });

  it("never lets new mail code import the legacy engine", () => {
    const dir = path.join(root, tauri, "src/mail");
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) walk(full);
        else if (
          e.name.endsWith(".rs") &&
          /commands::email|email_sync|mailparse::/.test(fs.readFileSync(full, "utf8"))
        )
          offenders.push(path.relative(root, full));
      }
    };
    walk(dir);
    expect(offenders).toEqual([]);
  });
});
