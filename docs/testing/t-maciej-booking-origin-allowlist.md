# Manual test checklist — t/maciej/booking-origin-allowlist (PR #250)

> Generated 2026-10-08 · branch `t/maciej/booking-origin-allowlist` · **Live-verified:** partial. Deployed 2026-10-08 01:38 UTC: migration `booking_rate_limit` (prod version 20261008013817), `booking-public` v21, `send-workspace-invite` v17. Grants probed on prod; smoke probes passed (OPTIONS 204, unknown slug 404 for preview and book with no ledger row, bad JSON 400, invite without secret 503). The booking and email steps below still need a real booking.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Deploy (in this order, with Maciej's OK)

Pre-checked read-only on 2026-10-08: no `booking_attempts` table, no `booking_rate_check` function and no migration row on prod; all 3 live booking links have owners that exist in `auth.users`; deployed `booking-public` v19 matches the last booking-public commit on `maciej` (8d025b3), so this deploy only adds this PR.

- [x] **Do:** apply `supabase/migrations/20261007120000_booking_rate_limit.sql` (MCP `apply_migration`, name `booking_rate_limit`) → **Expect:** `select has_function_privilege('anon','public.booking_rate_check(text,uuid)','EXECUTE')` is `false`, and the same for `authenticated`; `service_role` is `true`; `has_table_privilege('anon','public.booking_attempts','SELECT')` and `has_sequence_privilege('anon','public.booking_attempts_id_seq','USAGE')` are `false`.
- [x] **Do:** `supabase functions deploy booking-public --project-ref wtoonrvuqumihpkbvwvs --no-verify-jwt --import-map supabase/functions/deno.json --use-api` from this branch → **Expect:** a new version, `verify_jwt=false`.
- [x] **Do:** `supabase functions deploy send-workspace-invite --project-ref wtoonrvuqumihpkbvwvs --no-verify-jwt --import-map supabase/functions/deno.json --use-api` → **Expect:** a new version, `verify_jwt=false`.
- [ ] **Do:** ship the web app the normal way (maciej → staging-app → prod-app) → **Expect:** the guest page has the new rate-limit messages. Booking works before this step too; only the copy waits for it.

## Booking (guest page)
- [ ] **Do:** book a slot on a link from `https://staging.moduo.app/book/<slug>` → **Expect:** the booking succeeds; the guest email arrives and its Cancel link starts with `https://staging.moduo.app/book/cancel?token=`. _(web)_
- [ ] **Do:** open that Cancel link and cancel → **Expect:** the cancel page loads and the meeting disappears from the host's calendar. _(web)_
- [ ] **Do:** book from `https://www.moduo.app/book/<slug>` → **Expect:** the Cancel link starts with `https://moduo.app/book/cancel?token=` (the page reports www as moduo.app, which redirects back to www). _(web)_
- [ ] **Do:** in the booking form, type `<a href="https://example.com">click</a> and budget <5k` as the note → **Expect:** the Google invite's description shows that text literally, not as a link, and `<5k` survives; after the next calendar sync the host's Moduo event shows the same; the guest line reads `Guest: name (email)`. _(web + Google Calendar)_
- [ ] **Do:** pause a link while its booking page is open, then submit a time → **Expect:** the form says "<host> isn't taking bookings on this link right now." and no "booked" screen. _(web)_

## Workspace invite email
- [ ] **Do:** nothing until `WORKSPACE_INVITE_WEBHOOK_SECRET` is set on the project and the DB webhook sends it — today the function answers 503 and no invite email goes out → **Expect:** once enabled, the email's button opens `https://app.moduo.app/join?invite=…` and joining works; a workspace named `<b>Team</b>` shows the tags as text. _(web)_

## Edge cases
- [ ] **Do:** send a `book` request with a forged origin, e.g. `origin: "https://evil.example"` (curl or devtools) → **Expect:** the booking succeeds and the email's Cancel link starts with `https://moduo.app/book/cancel?token=`. _(web)_
- [ ] **Do:** send `book` requests with a made-up slug, a bad `start`, a slot that isn't offered, or `email: "Ana <ana@example.com>"` → **Expect:** 404 / 400 `bad_slot` / 409 `slot_taken` / 400 `bad_guest`, and no new rows in `booking_attempts` (only valid bookings count). _(web)_
- [ ] **Do:** (optional, uses up real slots) make 11 real bookings from one network within an hour, cancelling each → **Expect:** the 11th answers 429 `rate_limited`; the guest page says "Too many booking attempts from this network. Try again in an hour." _(web)_

## Migrations / data
- [ ] **Do:** after a few real bookings, `select count(distinct ip_hash), count(*) from public.booking_attempts` → **Expect:** distinct hashes for different networks (one shared value would mean every guest lands in one bucket). _(SQL)_
- [ ] **Do:** `select count(*) from public.booking_attempts where created_at < now() - interval '2 days'` a few days later → **Expect:** 0 (pruned on each check). _(SQL)_

## Rollback
- Functions: redeploy `booking-public` and `send-workspace-invite` from `origin/maciej` before this PR (same commands). The old booking-public never calls `booking_rate_check`, so the migration can stay.
- Migration (only if needed): `drop function public.booking_rate_check(text, uuid); drop table public.booking_attempts;` and delete its `schema_migrations` row. Redeploy the old booking-public first; with the new function deployed and the RPC gone it fails open (PGRST202) and logs every booking.

## Known gaps / not-yet-testable
- No Deno type-check (Deno isn't installed); both functions bundle with `bun build`, so local imports resolve.
- The per-host cap (30 per hour) means someone making 30 real bookings an hour on one host's links throttles that host. That's deliberate: a platform-wide cap would let a few IPs switch booking off for everyone, and junk requests no longer count.
- Local bookings (dev server) now get `https://moduo.app` Cancel links, which work against the hosted backend but not a local Supabase stack.
- `preview` is still not rate-limited (as before this PR); it calls Google free/busy for every request.
