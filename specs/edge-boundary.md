# Spec: Edge function boundary cleanup

> Status: **Draft** · Owner: mike (engineer mode) · Related: `docs/decisions/calendar.md`, `docs/decisions/billing.md`, `docs/data-layers.md`

## Scope

An audit of every deployed Edge Function, cron job, `pg_net` call and client-side write (2026-11-27, prod `wtoonrvuqumihpkbvwvs`) found the boundary mostly right. Postgres holds the logic. The 24 functions (21 in the repo plus the Stripe Sync Engine's three) exist only where a third-party secret, a non-Postgres API or an anonymous endpoint needs them. This spec covers the parts that aren't right:

1. **Unused desktop Zoom/Meet sign-in.** The Rust OAuth reads `MODUO_ZOOM_CLIENT_SECRET` and the Meet secret from the launch environment only, so it can never work in a shipped app. Nothing in the UI calls it: booking links use `booking-zoom-connect` on both platforms.
2. **Google Calendar read on desktop.** Desktop reads of a desktop-connected Google login still call Google from Rust, using the keychain token (`calendar_google_events_sync`). Writes and web-picked calendars already go through `calendar-google-web`, and the server already holds the same token (`calendar_google_publish_booking_token`) and refreshes either client's token (`_shared/google-token.ts` `refreshAny`). The result is two refresh paths, and a revoked desktop login shows *error* instead of *Reconnect* (gap noted in CALR-20).
3. **A failed first trial start is never retried.** `ensureTrial` swallows every failure, and `app-gate.tsx` still marks the device "checked".
4. **Two dead direct writes** in the Tasks runtime.

What the audit cleared, and this spec does not change: the other direct table writes (`docs/data-layers.md:114` and `docs/moduo-module-contract.md:209` keep them direct on purpose, under RLS and `perm_enforce_write`); chat parsing and fan-out in SQL; the cron jobs; and the split between the billing functions.

## Product behavior & UX

Nobody should notice EB-1, EB-3 or EB-4, except that a first trial start that failed now succeeds on the next launch. EB-2 changes one visible thing: on desktop, a Google login whose access was revoked shows **Reconnect** (the web's reauth state) instead of an error. Its events keep syncing on the same schedule (on mount, on wake, every 15 min).

## Edge cases

- A desktop Google login connected before the server copy existed has a keychain token but no `user_integrations` row. The first sync publishes it once, then reads through the server.
- A desktop Google login with no keychain token and no server row shows **Reconnect**.
- The server can't be reached (offline). The sync fails quietly, the mirror is not wiped, and the Calendar "Offline" line shows (CALR-3, unchanged).
- A Google token issued to the desktop client is refreshed by the server's `refreshAny`, which tries `GOOGLE_CALENDAR_CLIENT_ID` first. Both client pairs are set in prod secrets (checked 2026-11-27).
- Outlook, CalDAV and ICS on desktop stay on Rust and don't change.
- `start-trial` answers 5xx, or the network fails. The next app launch asks again. A 200 with `started: false` (founder, already had a subscription) counts as done.

## Acceptance criteria

- **AC1** — On desktop, connecting Zoom and Google Meet from booking links works as before. The desktop app no longer contains a Zoom/Meet sign-in or reads a Zoom/Meet secret. `manage-integration` accepts only `google_calendar` and refuses `zoom` and `google_meet`.
- **AC2** — On desktop, events of a Google login connected on desktop come from `calendar-google-web`, not a direct Google call.
- **AC3** — On desktop, a revoked Google login shows Reconnect (reauth), the same as on the web.
- **AC4** — A desktop Google login with a keychain token but no server copy is published once on its first sync, then read through the server. With no token anywhere, it shows Reconnect.
- **AC5** — Outlook, CalDAV and ICS sync on desktop work exactly as before.
- **AC6** — When the first-sign-in trial start fails (network or non-2xx), the device asks again on the next launch. A 2xx answer is never asked again.
- **AC7** — Deleting a tag only soft-deletes it, and the database trigger removes its links. The Tasks runtime has no unused bucket write.

## Tests that prove them

| Test (file · name) | Proves | Plain-English: what it checks |
| --- | --- | --- |
| `supabase/functions/manage-integration/handler.test.ts` · "refuses zoom and google_meet" | AC1 | The function turns away any provider except Google Calendar |
| `supabase/functions/manage-integration/handler.test.ts` · "stores google_calendar" (kept) | AC1 | Publishing a desktop Google token still works |
| `cargo test --lib` + `cargo check` + `cargo check --features lite` | AC1 | The desktop app still builds and its tests pass with the Zoom/Meet code gone |
| `apps/app/src/lib/runtime.tauri.calendar.test.ts` · "google reads go through calendar-google-web" | AC2 | Desktop asks the server, not Rust, for Google events |
| `apps/app/src/lib/runtime.tauri.calendar.test.ts` · "publishes a keychain-only login once, then reads through the server" | AC4 | An old desktop login is uploaded once and then synced like the rest |
| `apps/app/src/lib/runtime.tauri.calendar.test.ts` · "no token anywhere asks to reconnect" | AC4 | A login with nothing to sync from shows Reconnect |
| `apps/app/src/features/calendar/hooks/use-calendar-sync.test.tsx` · "desktop google reauth marks the login reauth" | AC3 | A revoked desktop login turns into Reconnect, not an error |
| `apps/app/src/lib/runtime.tauri.calendar.test.ts` · "outlook, caldav and ics still use the native commands" | AC5 | The other providers keep their desktop path |
| `apps/app/src/features/billing/checkout.test.ts` · "ensureTrial reports a failed start" | AC6 | A 5xx or network error comes back as not done |
| `apps/app/src/routes/layouts/app-gate.test.tsx` · "a failed trial start is asked again next launch" | AC6 | The device doesn't remember a failed attempt as done |
| `apps/app/src/lib/runtime.web.tasks.test.ts` · "deleteTag only soft-deletes" | AC7 | Deleting a tag doesn't also delete its links from the client |

## Assumptions & technical decisions

- **Desktop keeps its Google connect flow** (Rust loopback PKCE with the desktop client), then publishes the token as it does today. Rejected: moving desktop to the web connect, which goes through `app.moduo.app` and adds a browser hop for no gain. Only the read path moves.
- **The keychain copy stays** as the backfill source for AC4. Removing it would strand logins whose publish never ran. Revisit once every live desktop login has a server row.
- **The server is the only refresher for Google reads.** `refreshAny` already tries the desktop client, then the web client, and both pairs are set in prod (`supabase secrets list`, 2026-11-27). Google refresh tokens don't rotate, so the keychain copy and the server copy never disagree.
- **Microsoft stays desktop-local.** Desktop Outlook uses Entra's public client and never uploads tokens. Whether the server's confidential Web-platform client can refresh a token issued to the public client is unproven. Outlook is view-only, and nothing server-side (booking) needs it. Out of scope.
- **The billing functions stay as five.** Merging them saves cold starts but means a Tier-2 billing redeploy for no user-visible gain. `issue-founder-coupon` is admin-only and doesn't share `_shared/billing.ts`.
- **The trial stays client-triggered.** Considered: a database trigger on the profile, then the outbox, then a worker calling Stripe. Rejected because the Stripe idempotency key (`start-trial-<uid>`) makes client retries safe, and Free is a working tier while waiting. The fix is to retry on failure (AC6).
- **The direct table writes stay direct**, as recorded in `docs/data-layers.md:114` and `docs/moduo-module-contract.md:209`. The invite UPDATE policy has no WITH CHECK, but `perm_invites_validate` pins token, expiry, workspace, payload and status transitions (checked in prod 2026-11-27). Only dead code is removed (EB-4).
- **`google_meet` stays in `INTEGRATION_PROVIDERS` and the Postgres CHECK.** Rows may exist, and `account-erasure` deletes by user. Dropping it needs a migration for no gain.
- **Not planned:** Google watch channels and Graph subscriptions (push sync), a weather proxy for open-meteo, and chat link previews. Each is a product call for the designer when it comes up.

## Execution blocks

| # | Block | Delivers | Covers ACs | Depends on |
| --- | --- | --- | --- | --- |
| EB-1 | Remove the unused desktop Zoom/Meet sign-in | Rust, runtime and config cleanup; `manage-integration` narrowed to `google_calendar` | AC1 | — |
| EB-2 | Desktop Google Calendar reads through the server | Desktop Google reads via `calendar-google-web`, a one-time publish backfill, reauth on desktop | AC2, AC3, AC4, AC5 | EB-1 |
| EB-3 | Retry a failed first trial start | `ensureTrial` reports failure; the gate retries next launch | AC6 | — |
| EB-4 | Drop dead Tasks runtime writes | `upsertBucket` removed; `deleteTag` relies on its trigger | AC7 | — |

## Block briefs

### EB-1 · Remove the unused desktop Zoom/Meet sign-in

- **Goal:** the desktop app has no Zoom/Meet OAuth and reads no Zoom/Meet secret. `manage-integration` accepts only `google_calendar` POSTs. Booking-link Zoom and Meet keep working through `booking-zoom-connect` and the `google_calendar` row.
- **Acceptance criteria:** AC1 — On desktop, connecting Zoom and Google Meet from booking links works as before. The desktop app no longer contains a Zoom/Meet sign-in or reads a Zoom/Meet secret. `manage-integration` accepts only `google_calendar` and refuses `zoom` and `google_meet`.
- **Tests:** `manage-integration/handler.test.ts` · "refuses zoom and google_meet" (new) and "stores google_calendar" (kept); `cargo check`, `cargo check --features lite`, `cargo test --lib` from `apps/desktop/src-tauri/`; `deno check --config supabase/functions/deno.json supabase/functions/manage-integration/index.ts`.
- **Start here:**
  - Remove from `apps/desktop/src-tauri/src/commands/integrations.rs`: :24, :37-49, :53-95, :148-578 (Meet :201-343, Zoom :345-463, the 4 commands :465-578), and test :584-593.
  - **Keep** `IntegrationTokens` :29-34, `signed_in` :99-108, `manage_integration_url` :110-117 (drop its provider arg), `upsert_integration_in_supabase` :121-146 and test :595-603. These are used by `calendar.rs:663-698`. Either rename the module or move them next to it, and rewrite the header :1-10.
  - Also remove `lib.rs:568-571`, `config.rs:104-107,125-128` (and the "(Zoom, Meet)" note at :24), `.env.example:24-27`, `runtime.types.ts:48-51,114-119`, `runtime.tauri.ts:23,190-203`, `runtime.web.ts:13,96-109` and `runtime.ts:14`.
  - Narrow `supabase/functions/_shared/contracts/http-bodies.ts:54-58` to `google_calendar`. Drop the DELETE body at :69-71 and the handler's DELETE path (`manage-integration/handler.ts:79-89`). Update the handler doc :1-18 and the tests at `handler.test.ts:79,131,143-158,196`.
- **Decisions that apply:** MOD-554 (`docs/decisions/permissions.md:5`) says "disconnect allowlists zoom/google_meet". Add a dated entry saying that path is gone. Function deploys: `data.md:112` (reconcile).
- **Traps:**
  - Deploying `manage-integration` is a Supabase write. Ask first (rule 11), and deploy from the repo root with `--import-map supabase/functions/deno.json --use-api --no-verify-jwt`.
  - Ship the function after the desktop release that drops the callers, or at the same time. Nothing calls DELETE today, so the order is safe.
  - Leave `google_meet` in `INTEGRATION_PROVIDERS` and the CHECK.
  - The crate isn't fmt-clean, so hand-format only your own hunks.
  - Rust and edge changes make this Tier 2: run `validator`.
- **Not in this block:** the calendar read path (EB-2).

### EB-2 · Desktop Google Calendar reads through the server

- **Goal:** on desktop, Google events come from `calendar-google-web` for every login, revoked logins show Reconnect, and keychain-only logins are published once. Rust keeps the connect and publish steps. Outlook, CalDAV and ICS don't change.
- **Acceptance criteria:**
  - AC2 — On desktop, events of a Google login connected on desktop come from `calendar-google-web`, not a direct Google call.
  - AC3 — On desktop, a revoked Google login shows Reconnect (reauth), the same as on the web.
  - AC4 — A desktop Google login with a keychain token but no server copy is published once on its first sync, then read through the server. With no token anywhere, it shows Reconnect.
  - AC5 — Outlook, CalDAV and ICS sync on desktop work exactly as before.
- **Tests:** `apps/app/src/lib/runtime.tauri.calendar.test.ts` (new) · "google reads go through calendar-google-web", "publishes a keychain-only login once, then reads through the server", "no token anywhere asks to reconnect", "outlook, caldav and ics still use the native commands"; `use-calendar-sync.test.tsx` · "desktop google reauth marks the login reauth".
- **Start here:**
  - `runtime.tauri.ts:243-273`: `fetchExternalEvents` sends google to `calendar_google_events_sync`. Route it to `fetchGoogleWebEvents` (`features/calendar/google-web.ts:87`).
  - `use-calendar-sync.ts:55-61,84-96`: the existing fallback to the server when the keychain is missing. It becomes the main path.
  - The server's no-row and reauth answers are in `calendar-google-web/index.ts:410-418` and `accounts.ts:52-71`. On no-row, call `invoke("calendar_google_publish_booking_token", {accountId})` (`calendar.rs:663`) once, then retry.
  - Remove the `calendar_google_events_sync` command (`calendar.rs:460-547`, `lib.rs:556-560`) once nothing calls it.
  - Fix the stale comments at `_shared/google-calendar.ts:1-3` and `booking-google-connect/index.ts:22-23`.
- **Decisions that apply:**
  - `docs/decisions/calendar.md:5` (2026-11-03, quiet sync and refresh)
  - `:9` (2026-11-03, desktop falls back to the web token)
  - `:49` (CALR-20, reauth: this closes its desktop gap)
  - `:68` (CALR-8, writes through `calendar-google-web`)
  - Add an entry: "Desktop Google reads go through `calendar-google-web`; the keychain is only the publish source."
- **Traps:**
  - The fetch must throw, never return `[]` (`google-web.ts:93-95`), or the mirror is wiped.
  - The account id `google:{email}` vs `google:{email}:{calId}` (`accounts.ts:39`) has to match both forms.
  - Publish at most once per login per session. Don't loop on a 409.
  - Desktop runs the web bundle: rebuild with `MODUO_TARGET=desktop` to live-verify.
- **Not in this block:** Outlook server reads, push webhooks, removing keychain tokens.

### EB-3 · Retry a failed first trial start

- **Goal:** when `start-trial` fails, the device doesn't remember the attempt as done, so the next launch asks again.
- **Acceptance criteria:** AC6 — When the first-sign-in trial start fails (network or non-2xx), the device asks again on the next launch. A 2xx answer is never asked again.
- **Tests:** `apps/app/src/features/billing/checkout.test.ts` · "ensureTrial reports a failed start"; `apps/app/src/routes/layouts/app-gate.test.tsx` · "a failed trial start is asked again next launch". This is a bug fix, so write the failing test first.
- **Start here:**
  - `apps/app/src/features/billing/checkout.ts:66-76`: `ensureTrial` ignores `res.ok`. Return a boolean.
  - `apps/app/src/routes/layouts/app-gate.tsx:51-60`: set `moduo:trial_checked:<userId>` only when it returns true.
  - `paywall-page.tsx:76-89` is a second caller; keep its behaviour.
- **Decisions that apply:** `docs/decisions/billing.md:11` (2026-10-06, trials: 14 days with no card on first sign-in). `billing.md:20` (DF-3) says start-trial "only short-circuits on active/trialing/past_due", which is stale: the code refuses any customer that ever had a subscription. Add a dated entry that corrects it.
- **Traps:** billing paths are Tier 2 (`scripts/ci/tier.ts`). No Edge Function changes, so nothing to deploy.
- **Not in this block:** a server-triggered trial (rejected in the spec), or merging the billing functions.

### EB-4 · Drop dead Tasks runtime writes

- **Goal:** remove `upsertBucket`, which nothing calls, and the redundant client `tag_links` delete in `deleteTag`.
- **Acceptance criteria:** AC7 — Deleting a tag only soft-deletes it, and the database trigger removes its links. The Tasks runtime has no unused bucket write.
- **Tests:** `apps/app/src/lib/runtime.web.tasks.test.ts` · "deleteTag only soft-deletes"; `bun run verify` (types catch any caller).
- **Start here:**
  - `apps/app/src/lib/runtime.web.tasks.ts:195` (`upsertBucketRow`) and `:1017` (`upsertBucket`), plus `runtime.types.tasks.ts:120`.
  - `runtime.web.tasks.ts:1133-1145` (`deleteTag`; drop the `tag_links` delete at :1141).
  - Keep `ensureWebInbox` (:154): it is live.
- **Decisions that apply:** `docs/data-layers.md:114` (tags and links stay direct writes); `docs/moduo-module-contract.md:209`.
- **Traps:**
  - Before removing the client delete, confirm `tags_drop_links_on_delete` exists on prod: `select tgname from pg_trigger where tgname = 'tags_drop_links_on_delete'`.
  - The tags store chains writes per key (`features/tags/store.ts:131,465`). Don't change its order.
- **Not in this block:** converting any direct write to an op.

## Out of scope

- Converting direct table writes to op RPCs: they are direct on purpose.
- Merging the billing functions, and a server-triggered trial.
- Outlook through the server, Google and Graph push webhooks, and removing keychain tokens.
- A weather proxy and chat link previews: designer calls, not planned.
- Moving chat markup and fan-out, the cron jobs or the permission checks out of Postgres.

---

## Definition-of-Ready gate

- [x] **Scope, Product behavior, Edge cases, Acceptance criteria** are all filled and unambiguous.
- [x] **Every acceptance criterion has at least one test** in *Tests that prove them*, with its plain-English note.
- [x] **Open questions is empty.** Technical unknowns were researched: prod secrets, triggers and logs, plus recon of the code.
- [x] **Data model is named and Supabase-first.** No new tables, columns or migrations. EB-1 deploys one Edge Function.
- [x] Module feature: n/a (infrastructure cleanup; no spine, MCP or widget surface).
- [x] **Execution blocks** are decomposed, sequenced and context-sized.
- [x] **Every block has a brief** of at most 3 KB that stands alone.
- [x] **Design constraints:** no UI changes beyond the existing Reconnect state.
- [x] **Manual-test surfaces:**
  - Desktop dev build: connect Google, then see its events.
  - Revoke Moduo at myaccount.google.com, then see Reconnect.
  - Booking links: connect Zoom on desktop.
  - First sign-in with `start-trial` blocked, then relaunch: the trial starts.

## Open questions

- [ ] (none)
