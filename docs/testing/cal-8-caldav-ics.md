# Manual test checklist — CAL-8 (CalDAV / ICS read-only calendars)

> Generated 2026-07-03 · branch `claude/pensive-almeida-38d6c7` · **Live-verified: partial — migration applied+round-tripped on prod; desktop app builds+boots; the provider flows are your desktop pass.**
> The whole connect flow is desktop-only Tauri `invoke` against real servers (needs your own credentials), so this pass is **first-discovery for the provider round-trips** — take it slowly. Run the **desktop** app. The migration is live and the desktop build compiles + launches (verified 2026-07-04); what remains is connecting your actual calendars.
>
> **Prerequisite: DONE.** Migration `20260703130000_calendar_account_sync_token.sql` was **applied to prod 2026-07-03** via the Supabase MCP (Moduo org) and round-trip-verified with an authed rolled-back probe: the descriptor stores, a NULL re-assert keeps it, status updates, no duplicate row, prod left byte-clean. `src/types/supabase.ts` matches the regenerated types byte-for-byte. The server side is proven — the checklist below is the client/desktop half.

## Connect a CalDAV calendar (Settings → Integrations)
- [ ] **Do:** Settings → Integrations → the "CalDAV & ICS feeds" card → **Connect CalDAV**. → **Expect:** a dialog with four preset chips (iCloud · Fastmail · Nextcloud · Other). _(desktop)_
- [ ] **Do:** Click **iCloud**. → **Expect:** the server field fills `https://caldav.icloud.com` and is read-only; the hint mentions an app-specific password from appleid.apple.com. _(desktop)_
- [ ] **Do:** Click **Nextcloud** / **Other**. → **Expect:** the server field clears and becomes editable with the right hint. _(desktop)_
- [ ] **Do:** Enter your iCloud address + an **app-specific password** → **Find calendars**. → **Expect:** a checklist of your event calendars (Personal, Work, …), **all pre-checked**; VTODO-only lists don't appear. _(desktop)_
- [ ] **Do:** Untick one, then **Connect N calendars**. → **Expect:** the dialog closes; the ticked calendars appear as rows under a header (your username) in the card; within ~a moment their events mirror onto `/calendar`. _(desktop → web)_
- [ ] **Do:** Wrong password → **Find calendars**. → **Expect:** "Wrong username or password." (not a raw error code). _(desktop)_
- [ ] **Do:** A plain `http://` server address. → **Expect:** "Moduo only connects to calendars over https." _(desktop)_

## Add an ICS feed
- [ ] **Do:** **Add ICS feed** → paste an `https://…/*.ics` (or `webcal://`) URL, leave the name blank → **Add feed**. → **Expect:** a row appears under a **Feeds** header, named after the feed's own title (X-WR-CALNAME) or its host; its events render read-only on `/calendar`. _(desktop → web)_
- [ ] **Do:** Add a feed with a custom name. → **Expect:** the row uses your name. _(desktop)_

## The calendar rail (grouping + attribution)
- [ ] **Do:** Open `/calendar`, look at the left rail. → **Expect:** Moduo first; then your CalDAV calendars **grouped under their account header** (username), each its own hue swatch + eye toggle; ICS feeds under a **Feeds** header. _(web + desktop)_
- [ ] **Do:** Toggle a calendar's eye off. → **Expect:** its events drop from the grid and the mini-month dots; the gap-finder still avoids them (Later-today won't schedule over a hidden meeting). _(web + desktop)_
- [ ] **Do:** ⋯ menu → Color → pick a hue. → **Expect:** the swatch + that calendar's chips recolor. _(web + desktop)_
- [ ] **Do:** Open an external chip's popover/detail. → **Expect:** it names the source ("Personal — CalDAV" / "Team holidays — ICS feed") and is read-only. _(web + desktop)_

## Reconnect (password rotation)
- [ ] **Do:** Change the password on your provider so the next sync fails. → **Expect:** the account's rail rows show a **Reconnect** affordance and the Settings row shows "Sync error — reconnect to fix". _(desktop)_
- [ ] **Do:** Click **Reconnect** (rail or Settings) → the dialog shows the server + username fixed, asks the **password only** → enter the new one. → **Expect:** all of that account's calendars go healthy again and resume syncing. _(desktop)_

## Removal (cascade + keychain)
- [ ] **Do:** Remove one calendar of a multi-calendar CalDAV account. → **Expect:** that row + its mirrored events disappear; the account's **other** calendars keep working (the shared keychain credential is NOT deleted while siblings remain). _(desktop → web)_
- [ ] **Do:** Remove the **last** calendar of an account, then try to reconnect with a deliberately wrong password. → **Expect:** removal cascades the events; the stored credential was cleaned up (reconnect must re-enter it). _(desktop)_
- [ ] **Do:** Remove an ICS feed. → **Expect:** its row + events go; the feed URL secret is deleted. _(desktop → web)_

## Web / second-device behavior
- [ ] **Do:** Open Settings → Integrations on the **web** app. → **Expect:** the CalDAV & ICS card shows "Connect from the desktop app" / "Desktop only"; existing connected calendars still render on the calendar and rail. _(web)_
- [ ] **Do:** With a CalDAV account connected on desktop A, open the calendar on a **second** device (desktop B or web). → **Expect:** the events render (from Supabase), and the account does **not** flap to a "Sync error / Reconnect" state on B — only the connecting machine (A) syncs it. _(both)_

## Migrations / data
- [x] **Migration applied + round-tripped 2026-07-03** (authed rolled-back probe: descriptor stored, NULL keeps it, status updates, no duplicate; probe rows 0 after).
- [ ] **Do:** After connecting a real CalDAV calendar, inspect its `calendar_accounts` row. → **Expect:** `provider='caldav'`, `external_id` = the calendar URL, `sync_token` = a JSON descriptor `{"kind":"caldav","serverUrl":…,"username":…,…}` — and **no password anywhere in the DB** (it's keychain-only). _(desktop)_

## Known gaps / not-yet-testable
- The provider round-trips are **first-discovery** — desktop-only invoke flows that need real credentials. The pure layers (ical→mirror mapping, rail grouping, credential-cleanup decision, descriptor round-trip) are covered by unit tests (`bun run verify` green — 584) and the Rust engine by `cargo test` (9). The migration is applied+round-tripped on prod; the desktop app compiles + boots (2026-07-04).
- The real provider round-trips (iCloud/Fastmail/Nextcloud auth + fetch) can only be exercised with your own credentials on your own machine — that's this checklist.
- If a sync silently shows no events after a successful connect, check the desktop logs for `caldav_*` / `ics_*` errors and confirm the server actually exposes the calendar over CalDAV (some hosts gate it behind a setting).

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up".*
