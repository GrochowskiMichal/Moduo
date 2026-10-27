# Gotchas: Calendar mirror, booking links, CalDAV

Read before working in `apps/app/src/features/calendar/`, the booking functions and CalDAV. Index of all areas: [docs/gotchas.md](../gotchas.md).

Compiled on 2026-10-27 (HV-14c, specs/harness-v3.md AC30): every entry became an ast-grep rule, a test, a comment at the trap, a path rule or a doc, or was deleted as stale. A path rule loads by itself when you open a file it covers.

## Where the traps live now

- **Path rules:** [calendar](../../.claude/rules/calendar.md) (legacy CHECK constraints, provider fetches that must throw, `account_key`, verifying the mirror from the browser, the deferred booking trigger in SQL tests), [migrations-practice](../../.claude/rules/migrations-practice.md) (`_op_` helpers in migrations, optional RPC parameters).
- **Comments at the trap:** `apps/app/src/features/calendar/` (`mirror.ts`, `ics-mirror.ts`, `hooks/use-calendar-sync.ts`, `caldav-connect.ts`), `apps/app/src/lib/runtime.web.calendar.ts`, `apps/app/src/features/spine/activity.ts`, `apps/landing/edge/worker.ts`, `supabase/functions/booking-zoom-connect/index.ts`, `supabase/functions/booking-public/`, `supabase/functions/_shared/google-token.ts`, `supabase/functions/_shared/oauth-connect.ts`, `supabase/functions/_shared/app-origin.ts`, `apps/desktop/src-tauri/src/commands/caldav.rs`.

## Open entries

None. A new trap goes here (the trap, why, what to do instead) only until it has a better home; one that bites twice becomes a hook, a lint rule or a test.
