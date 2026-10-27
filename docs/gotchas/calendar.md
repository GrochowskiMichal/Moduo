# Gotchas: Calendar mirror, booking links, CalDAV

Read before working in `apps/app/src/features/calendar/`, the booking functions and CalDAV. Index of all areas: [docs/gotchas.md](../gotchas.md).

Compiled on 2026-10-27 (HV-14c, specs/harness-v3.md AC30): every entry became an ast-grep rule, a test, a comment at the trap, a path rule or a doc, or was deleted as stale. A path rule loads by itself when you open a file it covers.

## Where the traps live now

- **Path rules:** [calendar](../../.claude/rules/calendar.md) (legacy CHECK constraints, provider fetches that must throw, `account_key`, verifying the mirror from the browser, the deferred booking trigger in SQL tests), [migrations-practice](../../.claude/rules/migrations-practice.md) (`_op_` helpers in migrations, optional RPC parameters).
- **Comments at the trap**, by trap: Graph's naive `dateTime` (`apps/app/src/features/calendar/mirror.ts`); occurrence ids keyed on the original slot, ical.js's global `TimezoneService`, unparseable feeds that must throw (`ics-mirror.ts`); sync tombstones what it stops fetching, CalDAV credentials only on the connecting machine (`hooks/use-calendar-sync.ts`); keychain cleanup before `removeAccount`, rolling back a saved credential (`caldav-connect.ts`); optional RPC params and providers that must throw (`apps/app/src/lib/runtime.web.calendar.ts`); the host as a booking's actor (`apps/app/src/features/spine/activity.ts`); booking hosts on the landing Worker (`apps/landing/edge/worker.ts`); Zoom app setup (`supabase/functions/booking-zoom-connect/index.ts`); `verify_jwt=false` and secrets (`supabase/functions/booking-public/index.ts`), which Google client refreshes (`supabase/functions/_shared/google-token.ts`); OAuth callbacks never decide the account (`supabase/functions/_shared/oauth-connect.ts`); emailed links never built from the request (`supabase/functions/_shared/app-origin.ts`); CalDAV redirects forward auth only within the domain (`apps/desktop/src-tauri/src/commands/caldav.rs`).

## Open entries

None. A new trap goes here (the trap, why, what to do instead) only until it has a better home; one that bites twice becomes a hook, a lint rule or a test.
