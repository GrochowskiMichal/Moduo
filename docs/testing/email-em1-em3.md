# Manual test checklist — Email EM-1 (engine security) + EM-3 (cloud substrate)

> Generated 2026-07-04 · branch `claude/optimistic-keller-50fcb9` · **Live-verified:** partial — EM-3's migration round-tripped against prod PG17 (applied + a rolled-back ops probe as the real workspace owner); EM-1 is unit-tested only (its live SMTP/IMAP round-trip needs the disposable mailbox — see Known gaps). No user-facing UI ships in these two blocks.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## EM-1 — Engine security (Rust; runs on the desktop build)
- [ ] **Do:** `cd src-tauri && cargo test --lib commands::email` → **Expect:** 14 passed, 0 failed (secret migration incl. no-session + locked-keychain safety; SMTP transport/builder/multipart/blank-id). _(desktop)_
- [ ] **Do:** `cargo check` in `src-tauri` → **Expect:** 0 errors (1 pre-existing `imap-proto` future-compat warning is fine). _(desktop)_
- [ ] **Do:** Connect an email account in the desktop app (Settings → Email, app-password path for Gmail/iCloud/custom IMAP) → **Expect:** it validates + syncs; the secret is in the OS keychain (Keychain Access → search `email_<userid>_…`), **not** in redb and never in the cloud. _(desktop)_
- [ ] **Do:** Have a legacy account whose password was stored the old way (redb-cleartext), then read/send with it → **Expect:** the secret migrates into the keychain on first read and the redb copy is wiped; the account keeps working (no reconnect prompt). _(desktop)_
- [ ] **Do:** Send a mail from that account (reply to a thread if possible) → **Expect:** it goes over TLS/STARTTLS only; the recipient's client threads the reply (correct In-Reply-To/References); a copy lands in Sent for iCloud/custom IMAP (Gmail does NOT double — it auto-saves). _(desktop)_

## EM-3 — Cloud substrate (migration + runtime; no UI yet)
- [ ] **Do:** Confirm the migration is live: in Supabase SQL editor, `select count(*) from pg_tables where tablename in ('email_accounts','email_refs');` → **Expect:** `2`. And `select count(*) from pg_policies where tablename in ('email_accounts','email_refs');` → `2`. _(cloud — already applied 2026-07-04)_
- [ ] **Do:** `bun run verify` → **Expect:** green (734 tests), incl. `src/features/email/refs.test.ts` (4 tests). _(both)_
- [ ] **Do:** (dev) call `getRuntime().email.listModule(workspaceId)` before EM-4 ships UI → **Expect:** `{ accounts: [], refs: [], degraded: false }` on the applied schema (was `degraded: true` pre-apply). _(both)_

## Edge cases (verified in code / probe; re-confirm on the desktop pass)
- [ ] **Do:** Trigger a secret read while signed out (or with the session briefly unavailable) → **Expect:** the account still works from the legacy copy and is NOT migrated/wiped (no false "Reconnect"); migration completes once a real session returns. _(desktop)_
- [ ] **Do:** Send a reply with no parent Message-ID → **Expect:** no malformed `<>` header (In-Reply-To/References simply omitted). _(desktop)_
- [ ] **Do:** (cloud) re-pull a thread that's already snoozed (`email_op_ref_upsert` twice) → **Expect:** the snooze/follow-up state survives the re-upsert; one `email_thread` entity registered. _(verified in the prod round-trip)_

## Migrations / data
- [ ] **Do:** Migration `email_module` (`supabase/migrations/20260704170000_email_module.sql`) — **APPLIED to prod 2026-07-04** (`wtoonrvuqumihpkbvwvs`); a rolled-back round-trip exercised all 8 ops as the real owner, and a post-apply deployed-op smoke left **zero** test rows. Confirm no `email_*` rows exist yet: `select count(*) from public.email_refs;` → **Expect:** `0`. _(cloud)_

## Known gaps / not-yet-testable
- **EM-1 live SMTP/IMAP round-trip is not yet run here** — it needs a disposable mailbox: put creds JSON at `MODUO_TEST_IMAP_CREDS_PATH` (gitignored; shape in `src-tauri/tests/imap_live.rs`) then `cargo test --test imap_live -- --ignored`. The engine logic is unit-tested; the real server round-trip is your pass.
- **EM-2 (Gmail OAuth + connect UX) was NOT built** — app-password connect works today; OAuth/refresh/connect-dialog is the next block.
- **`email_op_convert_to_task` (the great moment) is deferred to EM-8** (its AC8) — EM-3 shipped the substrate only.
- **No user-facing Email UI in these blocks** — the inbox/reader/rail rebuild is EM-4; `modulePermissions.email` client wiring lands with it.
- **`src/types/supabase.ts` not regenerated** for the new tables — the runtime uses the untyped Supabase client so nothing depends on it; a one-command cleanup.
- **The accounts list is an unlocked read-modify-write** (pre-existing) — a per-account store-lock is a tracked follow-up; harmless at single-user desktop scale.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
