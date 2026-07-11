# Manual test checklist — prune dead Rust sidecar (proposal C)

> Generated 2026-07-11 · branch `t/maciej/prune-dead-rust-sidecar` · **Live-verified:** partial — desktop **boot** verified end-to-end (release `Moduo.app` built + launched + survived `AppState::new` + registered a Foreground GUI window + quit cleanly); `cargo check` (default **and** `--features lite`) clean, `cargo test` 54 Rust tests pass, `bun run verify` green (1022 tests). The **per-module interactive** checks below (Tasks/Notes/Calendar/Email working on your real session) are for you to confirm — I couldn't drive a logged-in session here.

This change is a **pure deletion + feature-gate**: it removed the fully-dead graph/embeddings subsystem and its dead tendril into the email engine, and moved the vestigial cloud-sync worker behind a `lite` Cargo feature (off by default). No new runtime code path was added; the boot path does strictly *less* than before. Tasks/Notes/Calendar Rust command paths were untouched; Email lost only dead no-op calls.

## Boot & shell (desktop)
- [ ] **Do:** Build + launch the desktop app (`bun run build:desktop` then open `Moduo.app`, or `bun run dev:desktop`) → **Expect:** app boots to the login/app shell with no crash, no error dialog _(desktop)_ — *(live-verified: release build boots, AppState inits, Foreground GUI window registers, clean exit)*
- [ ] **Do:** Sign in with your cloud account → **Expect:** workspace loads, the 3-pane shell renders normally _(desktop)_

## The four load-bearing modules (desktop) — regression sweep
- [ ] **Do:** Open **Tasks** → create / edit / complete / delete a task, switch views → **Expect:** unchanged behavior _(desktop)_ — *(Rust path untouched by this change)*
- [ ] **Do:** Open **Notes** → create a note, type in the editor, rename, trash/restore → **Expect:** unchanged; note body persists and syncs _(desktop)_ — *(notesV2 JS engine owns notes sync; Rust path untouched)*
- [ ] **Do:** Open **Calendar** → view events, create/edit an event, confirm CalDAV/Google/Outlook synced calendars still mirror → **Expect:** unchanged _(desktop)_ — *(Rust path untouched)*
- [ ] **Do:** Open **Email** → connect/refresh an account, list a folder, open a thread, read a message body, prefetch, send a message, search → **Expect:** all unchanged _(desktop)_ — **highest-attention area:** the graph-outbox write was removed from every email sync/list/body/realtime path, so verify sync + list + body-fetch + IDLE-driven new-mail all still work end-to-end.

## Email — specific paths the tendril removal touched
- [ ] **Do:** Force-sync a folder (`email_sync_now` / `email_list_envelopes` force_sync) → **Expect:** envelopes appear; no error _(desktop)_
- [ ] **Do:** Open a cached-miss message so `email_get_message_body` fetches from IMAP → **Expect:** body renders _(desktop)_
- [ ] **Do:** Prefetch bodies (open a folder that triggers `email_prefetch_bodies`) → **Expect:** subsequent opens are instant, no error _(desktop)_
- [ ] **Do:** Leave the app idle so the IMAP IDLE worker delivers new mail (or send yourself a message) → **Expect:** new envelope appears via realtime, no error _(desktop)_

## Migrations / data
- [ ] **Do:** Launch against an **existing** redb DB from a prior app version (one that already has `graph_nodes` / `graph_edges` / `graph_vectors` / `email_graph_outbox` tables) → **Expect:** app opens fine; the now-abandoned tables are simply never opened again (harmless stale data, nothing reads them) _(desktop)_ — *(no Supabase migration; redb-only, no schema-version bump needed)*

## Lite feature (future offline build)
- [ ] **Do:** `cargo check --features lite` in `src-tauri` → **Expect:** compiles clean (the gated `sync` worker + `AppState.sync_worker` field + `auth.rs` start/stop paths) — *(live-verified clean)*
- [ ] **Do:** Default `cargo check` (no features) → **Expect:** compiles clean; `sync/` is NOT compiled — *(live-verified clean)*

## Known gaps / not-yet-testable
- **Interactive per-module functional pass on a logged-in session** — not run here (no test-account GUI session in this environment). Boot, compile (both feature configs), unit tests, and code-path analysis all pass; the module sweeps above are confirmation, not first-discovery.
- **The `lite` build has never been *run*, only compiled** — the cloud-sync worker behind it isn't exercised by any current build; it's preserved as the offline/"lite" seed. When lite is actually built, `sync` will need its own runtime verification.
- **`HELIX_SIDECAR_PATH` graph path is gone** — if anyone had set that env var to run the experimental helix sidecar, that capability is removed (it had no UI and no frontend caller).

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
