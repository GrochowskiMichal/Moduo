> Raw research report from the Calendar re-plan, 2026-10-10 (branch t/maciej/calendar-replan). Nothing here is decided.

# Connectivity: sync, write-back, invites, free/busy

Lane: what Calendar can do with outside calendars today, and what it would take to make Moduo someone's daily calendar. §0 is read from the code (every claim cites `file:line`). §2 adds provider API facts, each with an official doc link. Effort is S (≤1 block), M (2–3 blocks), L (4+ blocks or a new service).

## §0 Today, per provider

### The matrix

| | Google | Outlook / Microsoft 365 | iCloud (CalDAV) | Other CalDAV (Fastmail, Nextcloud…) | ICS feed |
| --- | --- | --- | --- | --- | --- |
| **Connect on web** | Yes, OAuth through `booking-google-connect` | No | No | No | No |
| **Connect on desktop** | Yes, loopback PKCE in Rust; tokens to the OS keychain. The client id is read from the process environment at runtime (`config.rs:45-52`), so a Finder-launched release build may not have it (verify on a shipped build) | Yes, but needs `MODUO_CALENDAR_MICROSOFT_CLIENT_ID` in the process environment; no CI secret exists for it | Yes, app-specific password, keychain | Yes, password, keychain | Yes, URL stored in keychain |
| **Read** | Yes (web and desktop) | Desktop only | Desktop only, the connecting Mac only | Same as iCloud | Same as iCloud |
| **Create** | Yes, on the web path only (edge function); title, time, all-day, RRULE, no guests | No (scope is `Calendars.Read`) | No (engine is read-only by design) | No | n/a |
| **Edit / move / delete** | No. Mirrored events are refused by the op as read-only | No | No | No | n/a |
| **Edit one occurrence** | No | No | No | No | n/a |
| **Guests / invites** | Only booking links (Meet event with attendees, Google emails them) | No | No | No | n/a |
| **RSVP** | No | No | No | No | n/a |
| **Where the secret lives** | Desktop connect: keychain only. Web connect: `user_integrations` (AES-GCM per-user key, encrypted refresh + access token). The desktop's "copy my token up" path is probably broken (below) | Keychain only | Keychain only | Keychain only | Keychain only |
| **Who syncs** | Any open client: web via the edge function, desktop via keychain then falls back to the edge function | Only the desktop that connected | Only the desktop that connected | Same | Same |
| **When** | Only while the Calendar page is open: on mount, on tab wake, every 15 min, manual refresh | Same | Same | Same | Same |
| **How** | Full re-fetch of the window, `singleEvents=true`; no syncToken, no push | Full `calendarView` re-fetch, no delta, no push | Full `calendar-query` REPORT with time-range; ETags read but unused; no ctag / sync-collection | Same | Full GET of the feed |
| **Window** | −30 / +120 days | Same | Same | Same | Same |
| **Machine off** | Web still syncs Google when someone has the web Calendar page open | Events freeze at the last sync; booking links can't see them change | Same | Same | Same |

### Evidence, file by file

**The sync loop (shared).**
- The loop is a React hook mounted only by the Calendar page: `src/features/calendar/ui/calendar-page-view.tsx:171-179`. Cadence: `SYNC_INTERVAL_MS = 15 min` (`src/features/calendar/hooks/use-calendar-sync.ts:16`), plus mount, tab wake and `accountKey` change (`:158-173`). Nothing syncs from Home, the tray, a server job or another page.
- Window: `syncWindow(now, 30, 120)` (`src/features/calendar/sync.ts:88-101`).
- Every pass is a full fetch; the account's `syncToken` is passed to the runtime (`use-calendar-sync.ts:71-77`) but Google/Outlook ignore it (`src/lib/runtime.tauri.ts:283-313`) and for CalDAV/ICS the column holds a connection descriptor, not a sync token (`src/features/calendar/sync.ts:23-59`).
- Deletions are found by diffing the fetch against the mirrored rows the page currently has loaded (`use-calendar-sync.ts:100-106`, `src/features/calendar/mirror.ts:227-233`).
- One account failing doesn't stop the others; a missing CalDAV/ICS secret on a second machine is not treated as an error, so status doesn't flap (`use-calendar-sync.ts:24-32`, `:123-143`).
- Mirror write: `calendar_op_mirror_events` refuses anyone but the account's owner (`supabase/migrations/20261002110000_booking_calendar_fixes.sql:139-146`, `IF a.owner_id IS DISTINCT FROM auth.uid()`). A server job running as service role has no `auth.uid()`, so server-side sync needs a service-role twin of this op (the `booking_op_commit` pattern, same migration `:110-115`).
- Account rows are per workspace (`supabase/migrations/20260702130000_calendar_module.sql:52-73`, unique on `(workspace_id, provider, external_id)`), so one Google calendar is mirrored once per workspace the user opens Calendar in (`src/features/calendar/google-web.ts:103-135` runs per workspace).

**Google.**
- Web connect: `supabase/functions/booking-google-connect/index.ts:46-52` (scopes `calendar.readonly` + `calendar.events`), PKCE + signed state, tokens saved by the signed-in app's `finish` call (`:72-127`, `:160-167`). One row per Google login keyed by email (`supabase/migrations/20261001200000_google_calendar_account_key.sql`).
- Desktop connect: `src-tauri/src/commands/calendar.rs:125-232` (same two scopes, `:148-149`), tokens to keychain (`:218-224`).
- **The desktop never refreshes a calendar access token.** `google_access_token_for_account` returns the stored access token as-is (`calendar.rs:342-356`); `src-tauri/src/commands/oauth_flow.rs:5` notes refresh is something "the calendar path never had". Google access tokens last about an hour, so a desktop-only Google connect stops syncing about an hour after connecting. The fallback to the edge function only triggers on a *missing* keychain token (`use-calendar-sync.ts:34-40`, `:82-87`), not on a 401, so the account flips to `error`. Calendars added through the web connect are separate rows (`google:{email}:{calendarId}`, `src/features/calendar/google-account.ts:1-9`); on desktop their keychain lookup misses and falls back to the edge function, so those keep working. The desktop's own `google:{email}` row does not. (Not live-tested; read from the code.)
- Web sync and create: `supabase/functions/calendar-google-web/index.ts` — `status` lists calendars per login (`:176-212`), `events` lists with `singleEvents=true` (`:237-266`, helper `supabase/functions/_shared/google-calendar.ts:197-224`), `push` inserts an event (`:268-298`, helper `google-calendar.ts:226-255`). Token refresh and re-encryption happen inside (`calendar-google-web/index.ts:68-126`).
- Create is wired in the UI only for Google calendars (`calendar-page-view.tsx:466-512`): the event is inserted in Google, the response is mapped and mirrored straight back. It sends the browser's current zone as the event zone (`:488-496`). No attendees, no `sendUpdates` (`google-calendar.ts:226-249`). On desktop the same call needs a token in `user_integrations`, so a keychain-only Google connect can't create either.
- Edit/move/delete of a mirrored event is refused: `calendar_op__guard_event(… p_native_only)` raises "managed in its source calendar and is read-only here" (`supabase/migrations/20260702130000_calendar_module.sql:171-174`). Move in the grid calls `calendar.updateEvent` (`calendar-page-view.tsx:514-526`), which only works for native events.
- Recurring events arrive as instances (`singleEvents=true`), so a Google series is N rows with `rrule: null`; an event Moduo just created is first mirrored with its RRULE (from the insert response) and then replaced by instances on the next sync (master id vanishes from the fetch, gets tombstoned).
- A cancelled single occurrence often has no start/end and is dropped by the mapper (`mirror.ts:70-74`, known gap).
- `deleteGoogleEvent` only targets the `primary` calendar (`google-calendar.ts:257-260`); used by booking cancel.

**Outlook / Microsoft 365.**
- Desktop only: `calendar.rs:234-340`. Scopes `offline_access User.Read Calendars.Read` (`calendar.rs:251`) — read-only; write-back needs re-consent with `Calendars.ReadWrite`.
- Client id from the runtime environment, no client secret (`src-tauri/src/config.rs:61-64`). `.github/workflows/_desktop-release.yml:24-25` lists the Google calendar secrets but no Microsoft one, and the config is read with `std::env::var` at runtime (`config.rs:39-89`), so a Finder-launched build sees neither unless the environment provides them. **ROADMAP line 74's "OAuth app registration pending" still stands: there is no registered Microsoft app wired into any build or function.** (Repo evidence only; the Azure portal was not checked.)
- No refresh, same as Google (`calendar.rs:448-465`).
- Fetch: `calendarView` per calendar with `Prefer: outlook.timezone="UTC"` (`calendar.rs:467-575`); the mapper drops naive non-UTC times rather than guess (`mirror.ts:56-63`).
- Server side: `user_integrations.provider` allows only `zoom`, `google_meet`, `google_calendar` (`supabase/migrations/20261001190000_user_integrations_google_calendar.sql`); there is no Graph code under `supabase/functions/`.

**CalDAV (iCloud, Fastmail, Nextcloud, other) and ICS.**
- Connect: `src/features/calendar/caldav-connect.ts:31-129` (presets incl. iCloud app-specific password, https only); Rust engine `src-tauri/src/commands/caldav.rs` (header `:1-12`: "read-only… No outward write path exists").
- Secrets: one keychain entry per (server, username) and per feed URL (`caldav.rs:155-200`, `:634-700`); only a non-secret descriptor (server, username, calendar URL) goes to Supabase in `calendar_accounts.sync_token` (`supabase/migrations/20260703130000_calendar_account_sync_token.sql:1-16`).
- Fetch: one `calendar-query` REPORT with a time-range filter per calendar per pass (`caldav.rs:575-631`); ETags come back and are thrown away by the mapper. No `getctag`, no `sync-collection`.
- Mapping: `src/features/calendar/ics-mirror.ts` expands recurrences into occurrence rows keyed by the original slot, honours EXDATE and RECURRENCE-ID, drops unresolvable zones (`:1-23`). Lazy-loaded so the web bundle never carries ical.js (`use-calendar-sync.ts:92-96`).
- Web: `fetchExternalEvents` throws `web_provider_sync_skipped` for everything but Google (`src/lib/runtime.web.ts:2035-2039`) so the web never tombstones what it can't read.

**Native Moduo events.**
- Stored as instants: `start_time`/`end_time` timestamptz, `recurrence_rule` text, `all_day`, `attendees jsonb` (legacy, unused by the module), `location`, `reminders jsonb` (legacy), **no time-zone column, no ETag/version column** (`src/types/supabase.ts:123-147`).
- Recurrence expands on the client in the **viewer's** local zone (`src/features/calendar/recurrence-expand.ts:1-40`, `rrule` npm). A teammate in another zone with view access sees "9:00 every Tuesday" at *their* 9:00.
- `calendar_accounts.is_default_target` ("v2 write-back seat") exists and is unused (`20260702130000_calendar_module.sql:59`; read only into the model at `src/lib/runtime.web.ts:3700`).

**Booking links (busy time).**
- `supabase/functions/booking-public/index.ts:246-311`: busy = the host's own `calendar_events` rows on the calendars the link selects (`:253-273`, owner-only since PERM-0), pending/confirmed bookings (`:275-290`), and, when any Google account is selected, a live `freeBusy` call (`:292-309`).
- That live call asks for `primary` only (`google-calendar.ts:73-95`), using whichever `google_calendar` token row was updated last, regardless of which login it is (`booking-public/index.ts:182-195`). Every other selected calendar (Outlook, iCloud, a second Google calendar) counts only as fresh as its last client sync.
- Recurring native events count only their first occurrence, because the query reads raw rows (`:253-273`); same for `calendar_busy_blocks` (`supabase/migrations/20261006210000_perm_sharing.sql:1261-1274`).
- Collective links: `COLLECTIVE_LINKS_ENABLED = false` (`src/features/calendar/ui/booking-link-dialog.tsx:61`). The server half exists (`collectiveOpenSlots`, `booking-public/index.ts:345-371`) but computes each co-host's busy with the **owner's** selected calendar ids (`:361-367`), so a co-host's own external calendars are mostly ignored. PERM-8b (`specs/BUILD_ORDER.md:101`) is the open block.
- Booking emails: this branch's `booking-public` still sends via Resend directly (`:438-465`); TX-5 (outbox + `.ics`) is tracked in `specs/BUILD_ORDER.md:212`.

**Free/busy inside a workspace (already built, PERM-5).**
- `calendars` table with `publish_level IN ('freebusy','view')` and grants at `freebusy | view | edit | full` (`20261006210000_perm_sharing.sql:15`, `:316-348`); the workspace default for calendars is `freebusy` (`:46`).
- `calendar_busy_blocks(workspace, from, to)` returns `(calendar_id, start, end)` only for calendars you may see as free/busy but not view (`:1261-1274`); the Calendar page loads it and draws "Busy" blocks (`src/features/calendar/hooks/use-calendar-module.ts:162-198`).
- A public feed by token (`calendar_public_feed`, `:1278-1306`) returns titles or "Busy" as JSON.

**What already exists for invites.**
- `supabase/functions/_shared/email/ics.ts` builds RFC 5545 `METHOD:REQUEST` and `METHOD:CANCEL` files with stable UIDs and SEQUENCE; the outbox send supports attachments (`_shared/email/send.ts`). Built for TX-5 booking emails (`specs/transactional-email.md` T15). Nothing parses an incoming `METHOD:REPLY`.

**One more Google path, probably broken.** The desktop's "copy my Google token up for booking links" (`calendar.rs:578-622`, called from `src/features/calendar/ui/booking-links.tsx:294`) goes through `supabase/functions/manage-integration/index.ts:46-59`, which upserts on `(user_id, provider)`. That unique key was replaced by `(user_id, provider, account_key)` in `20261001200000_google_calendar_account_key.sql`, so the upsert should fail on a database that ran that migration, and it never writes `account_key`. Not live-tested here. Either way the web connect is the path that works.

---

## §1 The gaps that stop someone using Moduo as their daily calendar

In order of how often a person would hit them.

1. **Outside calendars go stale.** Nothing syncs unless someone has the Calendar page open. Close the laptop, and Outlook / iCloud / Fastmail / ICS stop updating for everyone and everything: the web, booking links, teammates' busy blocks, Home's agenda, MCP, and any future reminder. Google is better only because a web tab can sync it.
2. **Desktop-only connects quietly die (read from the code, not live-tested; see §0 Google).** A Google or Outlook account connected from the desktop almost certainly stops syncing about an hour later (no token refresh), shows Reconnect, and can't create events. Calendars added through the web connect keep working.
3. **You can't change anything that came from outside.** No move, resize, rename or delete for any Google / Outlook / iCloud event, not even ones you created from Moduo. Only "create on Google, from the web, without guests" exists.
4. **No people on events.** You can't invite anyone, see who's coming, or answer an invitation you received. Booking links are the only thing that sends invitations.
5. **Outlook isn't really supported.** No registered Microsoft app, desktop-only, read-only. A Microsoft 365 user can't use Moduo as a daily driver at all.
6. **Repeats and time zones are fragile.** External series arrive as loose instances (no "edit all"); a cancelled single occurrence keeps showing; your own repeating events count as busy only on their first date for booking links and teammates; events have no time zone of their own, so "9:00 every Tuesday" moves for a teammate abroad.
7. **Booking links only see part of your week live.** Only the primary calendar of whichever Google login was saved last is checked live; everything else is as fresh as the last time a Calendar page synced.

---

## §2 Options per question, with effort, risk and a recommendation

### Q1 · Server-side sync for every provider

**Provider facts.**
- **Google.** `events.list` with `syncToken` returns only changes, including deletions ("the result will always contain deleted entries"); a `410 GONE` means wipe and full-sync again; `syncToken` can't be combined with `timeMin`, `timeMax`, `orderBy`, `q`, `updatedMin` and a few others; `singleEvents` is allowed; page size up to 2500. ([sync guide](https://developers.google.com/workspace/calendar/api/guides/sync), [events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)). Push: `events.watch` opens a channel to an HTTPS URL with a valid certificate; notifications carry **no event data** (a ping, then you call `list` with your syncToken); default channel TTL 604,800 s (7 days); "no automatic way to renew", you re-`watch` before expiry. ([push guide](https://developers.google.com/workspace/calendar/api/guides/push), [events.watch](https://developers.google.com/workspace/calendar/api/v3/reference/events/watch))
- **Microsoft Graph.** `GET /me/calendarView/delta?startDateTime&endDateTime` keeps a local copy of a date range in sync; the range is fixed at the first call and baked into the `@odata.deltaLink`; `$select`, `$filter`, `$orderby` aren't supported; deleted events come back under `@removed`, and so do changes *outside* the range, which you filter. v1.0 documents it for the user's primary calendar view; other calendars need checking (verify). ([event: delta](https://learn.microsoft.com/en-us/graph/api/event-delta?view=graph-rest-1.0)). Push: subscriptions on Outlook events last at most **10,080 minutes (under 7 days)**, 1,440 min with resource data; HTTPS notification URL; renew before expiry; lifecycle notifications (`reauthorizationRequired`, `missed`) are optional for events. ([subscription](https://learn.microsoft.com/en-us/graph/api/resources/subscription?view=graph-rest-1.0))
- **CalDAV.** RFC 6578 `sync-collection` REPORT returns changed and removed members since a sync-token ([RFC 6578](https://www.rfc-editor.org/rfc/rfc6578)); servers without it can be polled by comparing `getctag` (a non-standard but widely implemented collection tag) and then per-resource `getetag`. iCloud's support for both is widely relied on by third-party clients but Apple doesn't document its CalDAV server: **verify by a live PROPFIND on `supported-report-set`**. No push for third parties.
- **ICS feeds.** Plain HTTP GET; use `ETag` / `Last-Modified` to skip unchanged feeds; otherwise full re-parse every time.
- **Supabase.** Edge Functions: 256 MB, **2 s CPU per request** (async I/O excluded), 150 s wall clock on Free / 400 s on paid, 150 s idle timeout ([limits](https://supabase.com/docs/guides/functions/limits)). Scheduling: `pg_cron` + `pg_net` POST to a function on a cron schedule, with the URL/key in Vault ([schedule functions](https://supabase.com/docs/guides/functions/schedule-functions)).

**Options.**

| Option | What it is | Effort | Risk | |
| --- | --- | --- | --- | --- |
| **A · Fix the client loop** | Add token refresh on desktop, run the loop app-wide (not only on the Calendar page), keep the tray process alive (close-to-tray from Tasks #16) | S | Still stale whenever every device is closed; booking links, reminders and teammates still can't trust it | Rejected as the main answer; keep as the "this Mac only" mode for CalDAV if the designer keeps passwords on the device |
| **B · Server poller** | A `calendar-sync` Edge Function called by pg_cron every few minutes; it claims due sources (`FOR UPDATE SKIP LOCKED`), syncs each incrementally (Google syncToken, Graph deltaLink, CalDAV sync-token or ctag/etag, ICS ETag) and writes the mirror with a service-role op | M for Google (tokens already server-side); M for Microsoft after registration; M–L for CalDAV/ICS (port the Rust protocol to Deno, run ical.js on the server, credentials on the server) | 2 s CPU budget: a big ICS feed or a long expansion may not fit one request, so sources are processed one per call and large feeds chunked; provider quotas; one more always-on moving part | **Recommended first** |
| **C · B plus push** | Google `watch` channels and Graph subscriptions call a `calendar-hook` function that only marks the source due and nudges the worker; polling stays as the safety net | +M on top of B | Channel / subscription renewal jobs; webhook validation handshakes; a missed push is covered by the poll | **Recommended second**, Google and Microsoft only (CalDAV and ICS have nothing to push) |

**Shape of B, decided by research (technical, not designer calls):**
- **Connections belong to a person, not a workspace.** A new `calendar_connections` (user, provider, login, encrypted credentials, status) and `calendar_sources` (connection, remote calendar id, cursor, etag/ctag, `next_sync_at`, backoff, last error). Workspaces subscribe to sources; the worker fetches each source once and fans the rows out to the workspaces that show it. Today one Google calendar is fetched and stored once per workspace.
- **A service-role twin of `calendar_op_mirror_events`** (today's op requires `auth.uid()` = owner), in the `booking_op_commit` pattern.
- **Deletions come from the provider** (Google deleted entries, Graph `@removed`, CalDAV removed members), not from diffing what a browser tab had loaded. The diff stays only for ICS and CalDAV servers without sync tokens.
- **Occurrence rows stay** (Google `singleEvents=true`, Graph `calendarView` occurrences, CalDAV pre-expanded): every provider already hands us occurrences. Add `provider_series_id` (Google `recurringEventId`, Graph `seriesMasterId`, CalDAV UID) and `original_start` (Google `originalStartTime`, Graph `originalStart`, CalDAV RECURRENCE-ID) so write-back can address "this", "all" and "this and following", and so a cancelled occurrence can be tombstoned (fixes the gap in `mirror.ts:70-74`).
- **Window.** Keep −30 / +120 days for the initial fill. Google's incremental sync can't be windowed (`timeMin`/`timeMax` are refused with `syncToken`), so the worker filters; verify how Google bounds open-ended series under `singleEvents=true` with no `timeMax`, and fall back to a nightly windowed re-list if needed. Roll the window forward nightly.
- **Cadence.** Poll every 5 min for sources without push, every 30–60 min for sources with a live push channel, immediately on "Sync now" and after any write. Exponential backoff on errors; three consecutive auth failures set the connection to "Reconnect".
- **Clients stop talking to providers.** The browser and the desktop read Supabase only (the Tasks v3 shared store and Realtime, Assumption #7); "Sync now" calls the worker.

**Where CalDAV passwords and ICS secret URLs would have to live for B.** This reverses CAL-8's ratified "credentials never touch Supabase" (`caldav-connect.ts:1-5`), so it is a designer call.

| Option | Where | What it means |
| --- | --- | --- |
| Keep keychain-only | The connecting Mac | Only that Mac syncs, only while Moduo runs (A above). Web and booking links stay stale for these calendars |
| App-level encryption in a table (today's Google pattern) | Ciphertext in Postgres, key in the Edge Function environment, per-user derived key (`_shared/token-cipher.ts`) | A database copy alone reveals nothing; the server can still read the secret when it syncs. Needs a key-version column for rotation. **Recommended if the designer opts in** |
| Supabase Vault | Encrypted in Postgres, root key managed by Supabase outside the database; plaintext via the `vault.decrypted_secrets` view ([Vault](https://supabase.com/docs/guides/database/vault)) | Anyone with SQL access to that view reads every user's password. Better suited to a handful of project secrets than per-user ones |

What changes for trust: an iCloud app-specific password is not scoped to Calendar; it also opens that person's iCloud mail and contacts. Storing it server-side is a real step up in what Moduo holds. Recommendation: **offer both modes per connection** ("Keep my password on this Mac" vs "Sync when my Mac is off"), default to server mode for ICS feeds (lower stakes, a URL) and ask on CalDAV.

### Q2 · Two-way write-back

**Provider facts.**
- **Google.** Conditional writes: send `If-Match: <etag>`; a changed event returns **412 Precondition Failed** ([version resources](https://developers.google.com/workspace/calendar/api/guides/version-resources)). `sendUpdates=all|externalOnly|none` controls guest emails ([events.patch](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch)). One occurrence: fetch the instance and PUT it (an exception); cancel one by setting its status to `cancelled`; Google warns against editing instances one by one to change a whole series or "this and following" ([recurring events](https://developers.google.com/workspace/calendar/api/guides/recurringevents)). "This and following" has no API: the usual pattern is to end the original series (UNTIL) and insert a new one (verify against what Google's own UI produces). The existing `calendar.events` scope covers all of this; no re-consent.
- **Microsoft Graph.** Needs `Calendars.ReadWrite` (today's desktop scope is `Calendars.Read`, so every Outlook user re-consents). Occurrences via `/events/{seriesMasterId}/instances`; no "this and following" (same split pattern). Graph events carry `changeKey` / `@odata.etag`; whether `If-Match` is enforced on event PATCH isn't documented on the update page: **verify**, else compare `lastModifiedDateTime` before writing. `transactionId` on create guards against duplicate POSTs on retry.
- **CalDAV.** Write the whole VCALENDAR resource with `PUT`; `If-None-Match: *` on create (and you choose the URL, so a retry is idempotent), `If-Match: <etag>` on update and delete, 412 on conflict ([RFC 4791 §5.3.2](https://www.rfc-editor.org/rfc/rfc4791#section-5.3.2)). One occurrence = add or change a `RECURRENCE-ID` override inside the same resource; "this and following" = UNTIL + a new resource.
- **ICS.** Read-only by nature.

**Recommended write path (all providers, M per provider after Q1-B):**
1. The UI calls a server op (`calendar_op_event_write`) with a client op id. The row updates in Moduo at once and is marked **pending**; a `calendar_writes` queue row is created (idempotency key = op id).
2. The worker (or an immediate invoke) sends it with `If-Match`, using the event's stored provider ETag (new column `provider_etag`).
3. Success: store the returned ETag, clear pending. **412**: re-fetch, apply the remote version, keep the user's change as a "Your change didn't apply" notice with Reapply. **Auth error**: keep pending, connection shows Reconnect. **Other errors**: retry with backoff three times, then "Couldn't save to Google" with Retry / Keep in Moduo only / Discard.
4. Recurring edits always ask "This event · This and following · All events", exactly once per gesture.
5. The old "create on Google and mirror straight back" (`calendar-page-view.tsx:479-512`) folds into this.
6. `calendar_accounts.is_default_target` becomes the user's **default calendar for new events** (the column already exists).

Rejected: writing from the client straight to providers (the desktop for CalDAV). It splits the logic in two places and breaks web parity.

### Q3 · Invites and RSVP

| Case | How | Effort | Notes |
| --- | --- | --- | --- |
| Event on a Google calendar, with guests | Attendees on insert/patch, `sendUpdates=all`; Google emails everyone and tracks replies, which come back through sync | S after Q2 | Already how booking links work (`google-calendar.ts:121-158`) |
| Event on an Outlook calendar, with guests | Attendees on the Graph event; Exchange sends the meeting request (verify for personal accounts) | S after Q2 + registration | |
| Event on a CalDAV calendar, with guests | RFC 6638 implicit scheduling: the server sends invitations when the organizer PUTs an event with ATTENDEEs ([RFC 6638](https://www.rfc-editor.org/rfc/rfc6638)). Fastmail supports it for third-party clients ([Fastmail blog](https://www.fastmail.com/blog/announcing-caldav-scheduling-support-for-clients/)). iCloud: **verify** (probe the `DAV:` header for `calendar-auto-schedule`) | M | Where unsupported, fall back to our own email |
| Answering an invitation you received | Google: patch your own attendee `responseStatus` (verify the exact field rules); Graph: `POST /events/{id}/accept`, `/decline`, `/tentativelyAccept` with `sendResponse` ([accept](https://learn.microsoft.com/en-us/graph/api/event-accept?view=graph-rest-1.0)); CalDAV: set your ATTENDEE `PARTSTAT` and PUT, the server sends the REPLY | S per provider after Q2 | Mirror must start keeping attendees + `self`/organizer flags (today the mapper drops them) |
| Moduo event with teammates, no provider | In-app: an `event_attendees(event, user or email, partstat)` table; teammates get a bell item and the event on their own grid; Accept/Maybe/Decline in the panel | M | No email needed inside a workspace |
| Moduo event with outsiders, no provider | Our own iTIP email through the outbox: `METHOD:REQUEST` / `CANCEL` from `_shared/email/ics.ts` (exists), plus Accept / Maybe / Decline **links** in the email body that hit a signed-token function | M | Replies from the guest's own calendar app (`METHOD:REPLY`) go to the ORGANIZER address; to catch those we'd set the organizer to a Moduo reply address and parse inbound mail through Resend Inbound (`email.received` webhook, [docs](https://resend.com/docs/dashboard/receiving/introduction)): L, later |

Recommendation: **meetings with outsiders go through the person's default provider calendar** (best deliverability; guests' apps treat them natively; replies come back by sync). Native invites only for teammates (in-app) and as the fallback for people with no connected calendar. Note: Tasks v3 dropped *email reminders*; invitations are a different job (a message to a third party), so the outbox is fair game. *Rejected:* building the full iTIP stack first (parsing inbound `METHOD:REPLY` mail through Resend Inbound) before provider-backed invites exist: most effort for the smallest group of users.

### Q4 · Free/busy

- **Inside the workspace (≤5 people): already built** as PERM-5 (`calendar_busy_blocks`, workspace default `freebusy`, the page draws "Busy" blocks). Gaps: repeating Moduo events count once; mirrored events are only as fresh as the last client sync; task sessions are missing (Tasks default d). Fix: one server function that returns only `(person, start, end)` and unions expanded native occurrences + mirrored rows + `task_sessions`, used by the grid, "find a time", booking links and MCP. **S–M.** Never titles: the function's return type makes it structural.
- **Provider free/busy for people outside Moduo.** Google `freeBusy`: up to 50 calendars per query, needs read access to the other person's calendar (same Workspace domain or shared) ([freebusy.query](https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query)). Graph `getSchedule`: work/school accounts only, **personal Microsoft accounts not supported** ([getSchedule](https://learn.microsoft.com/en-us/graph/api/calendar-getschedule?view=graph-rest-1.0)). CalDAV `free-busy-query` on your own collections ([RFC 4791 §7.10](https://www.rfc-editor.org/rfc/rfc4791#section-7.10)); cross-user free/busy via the scheduling outbox is rarely available. Recommendation: **compute free/busy from our own mirror**, made fresh by Q1; call providers live only as a top-up for the host's own Google calendars in booking (already done, needs the right login and every selected calendar, not just `primary`). *Rejected:* live provider free/busy as the primary source: `getSchedule` excludes personal Microsoft accounts, Google `freeBusy` needs access to the other person's calendar, CalDAV cross-user free/busy is rarely available, and our own sessions and Moduo events would still be missing.

### Q5 · Time zones and the recurrence engine

- **Add `time_zone` (IANA) to `calendar_events`.** Null = floating (all-day, legacy). Native repeats expand in the event's zone, not the viewer's (fixes the teammate-abroad drift in `recurrence-expand.ts`). Write-back sends the event's zone instead of the browser's (`calendar-page-view.tsx:495`). Graph reports Windows zone names (`originalStartTimeZone`); keep requesting UTC and map the name through the CLDR Windows→IANA table only for display of "this event's zone" (verify coverage). **S.**
- **Where repeats expand.** Today: only in the browser (`rrule` npm). Server readers (booking busy, busy blocks, reminders, Focus's "next meeting" divider, MCP "what's on today") need occurrences too and today get them wrong.

| Option | Effort | |
| --- | --- | --- |
| Keep client-only expansion | — | Rejected: every server reader is wrong for repeating events |
| **Reuse Tasks v3's SQL occurrence function** (Assumption #5: daily/weekly/monthly-by-day/nth-weekday/yearly, interval, until/count) for native events, as `calendar_event_occurrences(from, to)`; the client keeps `rrule` for display with shared test vectors so both agree | S–M after TV-D8 | **Recommended.** Provider events need none of it: they arrive pre-expanded |
| Materialize native occurrence rows in a rolling window | M | Simpler reads, more writes and a nightly roll; revisit only if reads get slow |

Native repeat rules must then stay inside the SQL subset (the plain-words picker already does).

### Q6 · Booking links

- **Busy = the host's selected calendars from the fresh mirror + their task sessions (default on, switch per link, Tasks default d) + their Moduo events (expanded) + pending/confirmed bookings + a live Google `freeBusy` top-up** for each selected Google calendar using *that calendar's own login*. **M.**
- **Collective links (PERM-8b):** each co-host's busy must come from *their own* selected calendars, stored per host on `booking_link_hosts` (today the owner's selection is applied to everyone, `booking-public/index.ts:361-367`). Flip `COLLECTIVE_LINKS_ENABLED` only after that and the co-host request inbox. **M.** *Rejected:* flipping the flag on today's server half, which applies the owner's calendar selection to every co-host.
- **Where the booked meeting lands:** the host's default calendar (Q2 step 6), so Outlook and CalDAV hosts get a real event once write-back exists; Google Meet stays tied to a Google host, Zoom and Moduo Meet work for anyone.

### Q7 · Already decided in Tasks v3 that Calendar must reuse

- **#4 `task_sessions`** — sessions are the task blocks on the grid and a busy source (Q4, Q6). Calendar never writes `scheduled_at` again.
- **#5 server recurrence** — the occurrence function Q5 reuses.
- **#7 shared store** — Calendar reads events and sessions through it; server sync bumps `updated_at`, so clients see provider changes through Realtime without ever calling a provider.
- **#11 one time engine** — block focus runs on it.
- **#16 notifications** — event reminders and "starting soon" use the same pg_cron sender, Web Push and `tauri-plugin-notification`, with close-to-tray. A server-side sender can only remind about external events if Q1 makes them fresh server-side; this is the strongest argument for B.
- **#17 Time & region** — `user_preferences.time_zone` for floating events, all-day dates and the worker's notion of "today".
- **#26 erasure** — every new user-keyed table (`calendar_connections`, `calendar_sources`, `calendar_writes`, `event_attendees`) goes into `account_erase_workspace_data` and the export in the block that creates it.

### Cross-cutting risks

- **Google OAuth app status.** Calendar scopes (`calendar.events`, `calendar.readonly`) are *sensitive*: verification is required for a public app, but no security assessment (that is only for *restricted* scopes) ([sensitive scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)). While the consent screen is external and in **Testing**, refresh tokens expire after **7 days**; 100 refresh tokens per account per client ([OAuth 2.0 overview](https://developers.google.com/identity/protocols/oauth2)). The repo doesn't say which state the project is in; worth checking before blaming sync for weekly disconnects.
- **Microsoft app registration.** Multi-tenant + personal accounts. Since November 2020, where risk-based step-up consent is on, users can't consent to newly registered multi-tenant apps from **unverified publishers**; publisher verification needs a Microsoft AI Cloud Partner Program account and a verified domain ([publisher verification](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview)). That ties to the "no Moduo company yet" question (Ringdove is the interim entity).
- **Edge Function CPU (2 s).** Parsing a large ICS feed with ical.js and expanding repeats may exceed it; process one source per invocation, cap expansions, and measure on a real feed before committing.

---

## §3 What the designer would feel

| Technical choice | What a person sees |
| --- | --- |
| Today: client-only sync | "Synced 3 h ago" on Outlook/iCloud when the Mac was asleep; a booking guest picks a slot that was taken at 9 this morning |
| Server poller (Q1-B) | Outside calendars stay current with every device closed; changes show within ~5 minutes; the web shows Outlook and iCloud too |
| Push on top (Q1-C) | Google and Outlook changes appear in under a minute |
| Desktop-only connect (today) | "Connect from the desktop app"; then, an hour later, "Reconnect" |
| One connect flow, server-side tokens | Connect once, on web or desktop (desktop opens the browser), and it works everywhere |
| CalDAV in server mode | A choice at connect: "Sync when my Mac is off (your app password is stored encrypted on Moduo's servers)" or "Keep my password on this Mac (iCloud only updates while Moduo is open here)" |
| Write-back with pending + If-Match | Drag a Google meeting: it moves at once with a faint "saving" mark; if Google refuses: "Couldn't save to Google · Retry · Keep in Moduo only"; if someone changed it meanwhile: "Changed in Google since you opened it" |
| Recurring edits | "This event · This and following · All events", every time you change a repeat |
| Outlook write needs a new scope | Existing Outlook users see one "Allow Moduo to edit your calendar" prompt |
| Provider-backed invites | Add Anna's email to a meeting on your Google calendar: Google sends her the invite, her reply shows as a ✓ next to her name a few minutes later |
| Native invites | Teammates get it in the bell and on their grid; outsiders get an email with Accept / Maybe / Decline |
| RSVP on received invitations | Accept / Maybe / Decline right in the event panel; the organizer is told by their own calendar |
| Free/busy | Teammates' time shows as grey "Busy" blocks, never titles; "find a time for the three of us" works on fresh data |
| Event time zones | "9:00 London" stays 9:00 London for a teammate in Warsaw (shown as 10:00) |
| Server-side repeats | Your weekly 1:1 blocks booking slots every week, not just the first |
| Google app in Testing mode | Google calendars silently disconnect every 7 days |

---

## §4 Sequencing (what must land first)

1. **Designer call:** CalDAV/ICS credentials server-side (opt-in per connection) or keychain-only. Everything after step 3 for those providers depends on it.
2. **Foundations (M):** `calendar_connections` + `calendar_sources` (per person), the service-role mirror op, new `calendar_events` columns (`time_zone`, `provider_series_id`, `original_start`, `provider_etag`, normalized attendees), the `calendar_writes` queue, erasure/export lines. Retire `manage-integration` and the desktop keychain Google/Outlook paths: desktop connects open the web OAuth flow.
3. **Google server sync (M):** the worker + pg_cron; `calendar-google-web` becomes a thin "Sync now" / connect status; clients stop fetching providers.
4. **Server repeats + one busy function (S–M):** needs Tasks TV-D8 (recurrence function) and TV-D10 (`task_sessions`).
5. **Google write-back (M):** edit/move/delete, occurrences, pending/conflict states, default calendar.
6. **Booking busy rework + PERM-8b (M):** right login, all selected calendars, sessions, per-host selections.
7. **Microsoft (L):** Entra registration (publisher verification needs a company), web connect function, `user_integrations` provider check, Graph sync + write-back with `Calendars.ReadWrite`.
8. **CalDAV/ICS server mode (L)** if step 1 says yes; otherwise background sync on the desktop under close-to-tray (S).
9. **Invites and RSVP (M):** provider-backed first (cheap after 5 and 7), then in-app teammate invites, then native email invites with RSVP links. Inbound `METHOD:REPLY` parsing last, if ever.
10. **Push (M):** Google watch channels, Graph subscriptions.

Steps 2–5 plus the provider-backed half of step 9 (attendees + `sendUpdates` on Google events, S once step 5 lands) are the minimum for "Google users can drop Google Calendar"; without that half, nobody can invite anyone. Steps 7–8 are what Outlook and iCloud users need.
