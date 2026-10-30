# Gotchas: Calendar mirror, booking links, CalDAV

Read before working in `apps/app/src/features/calendar/`, the booking functions and CalDAV. Index of all areas: [docs/gotchas.md](../gotchas.md).

Compiled on 2026-10-27 (HV-14c, specs/harness-v3.md AC30): every entry became an ast-grep rule, a test, a comment at the trap, a path rule or a doc, or was deleted as stale. A path rule loads by itself when you open a file it covers.

## Where the traps live now

- **Path rules:** [calendar](../../.claude/rules/calendar.md) (legacy CHECK constraints, provider fetches that must throw, `account_key`, verifying the mirror from the browser, the deferred booking trigger in SQL tests), [supabase-sql](../../.claude/rules/supabase-sql.md) §Across modules (`_op_` helpers in migrations, optional RPC parameters).
- **Comments at the trap**, by trap: Graph's naive `dateTime` (`apps/app/src/features/calendar/mirror.ts`); occurrence ids keyed on the original slot, ical.js's global `TimezoneService`, unparseable feeds that must throw (`ics-mirror.ts`); sync tombstones what it stops fetching, CalDAV credentials only on the connecting machine (`hooks/use-calendar-sync.ts`); keychain cleanup before `removeAccount`, rolling back a saved credential (`caldav-connect.ts`); optional RPC params and providers that must throw (`apps/app/src/lib/runtime.web.calendar.ts`); the host as a booking's actor (`apps/app/src/features/spine/activity.ts`); booking hosts on the landing Worker (`apps/landing/edge/worker.ts`); Zoom app setup (`supabase/functions/booking-zoom-connect/index.ts`); `verify_jwt=false` and secrets (`supabase/functions/booking-public/index.ts`), which Google client refreshes (`supabase/functions/_shared/google-token.ts`); OAuth callbacks never decide the account (`supabase/functions/_shared/oauth-connect.ts`); emailed links never built from the request (`supabase/functions/_shared/app-origin.ts`); CalDAV redirects forward auth only within the domain (`apps/desktop/src-tauri/src/commands/caldav.rs`).

## Open entries

- **`calendar_op_account_upsert` creates an account when the caller has no live row** (except for `p_status => 'error'`, since `20261030230000`). The sync loop's `"ok"` upsert after `mirrorEvents`, and `refreshGoogleAccess` (no status), run on a list that can be stale, so an account removed in between comes back. Rare (a millisecond window), not fixed: an update-only flag for sync callers is the fix when it bites.

A new trap goes here (the trap, why, what to do instead) only until it has a better home; one that bites twice becomes a hook, a lint rule or a test.
