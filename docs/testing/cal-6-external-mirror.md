# Manual test checklist — Calendar CAL-6 (external read-only mirror + accounts UI + attribution)

> Generated 2026-07-02 · branch `claude/trusting-shirley-e14fa6` · **Live-verified: web core, yes (hosted account)** — I seeded a mirrored "Work — Outlook" account + two events via the real `calendar_op_account_upsert` / `calendar_op_mirror_events` RPCs and confirmed rendering, hue attribution, read-only, the account map, visibility toggle, sync-age, and the removal cascade end-to-end (zero console errors). The **desktop provider sync** (OAuth → fetch → mirror) is NOT wired this session (see Known gaps) — it's the OAuth-unverifiable desktop half.
>
> No web migration — CAL-2's `calendar_accounts` + mirror ops (already applied to prod) carry this.

## Attribution & rendering (AC12)
- [ ] **Do:** with a connected external account that has mirrored events, open `/calendar` → **Expect:** its events render on the grid tinted with the account's hue (distinct from Moduo's primary tint); each chip's tooltip ends "· read-only". _(web / desktop)_
- [ ] **Do:** click an external event → **Expect:** the popover names the source ("Work — verify@outlook.com — Outlook · read-only") and offers only **Open** — no edit/delete. _(both)_
- [ ] **Do:** open an external event's **Detail** (right panel) → **Expect:** read-only fields + a source-attribution line + last-sync age; Links (EntityHub) + Activity are live (you can link it to a contact/note/task). _(both)_
- [ ] **Do:** try to drag or resize an external chip → **Expect:** it resists (read-only); a click still opens the popover. _(both)_

## The account map — left rail (§3a)
- [ ] **Do:** look at the rail's Calendars list → **Expect:** "Moduo" first (primary dot), then each connected account with its hue swatch + name. _(both)_
- [ ] **Do:** click an account's eye toggle → **Expect:** its events vanish from the grid; the swatch dims; click again to show. The hidden state persists across reload (per user). _(both)_
- [ ] **Do:** open an account's ⋯ menu → **Expect:** Hide/Show, a Color submenu (8 hues, recolors the account + its chips live), and **Remove account**. _(both)_
- [ ] **Do:** Remove account (rail ⋯ or Settings → Disconnect) → **Expect:** the account AND all its mirrored events disappear (registry cascade tombstones its spine links); the sync-age label clears. _(both)_

## Sync freshness (toolbar)
- [ ] **Do:** with ≥1 account connected → **Expect:** the toolbar shows "synced N min ago" + a refresh icon. No accounts → neither shows. _(both)_
- [ ] **Do:** click refresh → **Expect:** the icon spins briefly and the grid re-reads from Supabase (on desktop this also triggers a provider sync once CAL-6's desktop half lands). _(both)_

## Settings → Integrations (§8)
- [ ] **Do:** open Settings → Integrations on **web** → **Expect:** Google/Outlook rows say "Connect from the desktop app" with a disabled "Desktop only" button; already-connected accounts still list with a working **Disconnect** (cloud removal). _(web)_
- [ ] **Do:** on **desktop**, Connect Google / Connect Outlook → OAuth → **Expect:** the account registers in Supabase (`upsertAccount`) and appears in the rail on web too. _(desktop — manual, needs real OAuth creds)_
- [ ] **Do:** Disconnect an account in Settings → **Expect:** same cascade as the rail Remove (events + account gone everywhere). _(both)_

## Desktop provider sync (CAL-6b — needs real OAuth creds)
- [ ] **Do:** on desktop, connect a real Google/Outlook account, open `/calendar` → **Expect:** within a moment its events appear (the desktop orchestrator fetches → maps → mirrors to Supabase; the grid then renders them). _(desktop — manual)_
- [ ] **Do:** click the toolbar refresh on desktop → **Expect:** a fresh provider pull then re-render; "synced just now". _(desktop)_
- [ ] **Do:** leave the desktop app open across a provider change (event added/edited/deleted upstream) → **Expect:** the change reflects after the next sync (mount / tab-wake / 15-min timer / manual refresh); a deleted upstream event disappears. _(desktop)_
- [ ] **Do:** revoke an account's access at the provider, then sync → **Expect:** the account flips to `error` (rail shows "Reconnect"), other accounts keep syncing. _(desktop)_

## Cross-device prefs (CAL-6b — LIVE-VERIFIED)
- [ ] **Do:** on device A, hide a calendar / recolor an account / change working-hours; open the calendar on device B (same user) → **Expect:** the change is there (visibility/colors/working-hours ride `user_preferences.calendar`, owner-aware last-write-wins). View mode + panel widths stay per-device. _(both)_

## Edge cases
- [ ] **Do:** an all-day external event → **Expect:** it lands on the correct local day (the mapper normalizes provider date-only values to local midnight — no UTC day-spill east of UTC). _(both)_
- [ ] **Do:** a cancelled provider event syncs → **Expect:** it does not render (status 'cancelled' is hidden). _(both)_
- [ ] **Do:** hide an account whose meeting overlaps a free slot, then "Later today"/"Move to today" a task → **Expect:** the gap-finder STILL avoids the hidden real meeting (visibility is visual-only; scheduling respects all real events). _(both)_
- [ ] **Do:** view-only member → **Expect:** the rail account map + hue are visible; visibility toggles persist locally but no account can be removed/connected (removal ops are edit-gated server-side). _(both)_

## Known gaps / not-yet-testable
- **The desktop OAuth *round-trip* is the only unverified path** — the fetch→map→mirror engine is compile-verified (`cargo check` clean) + unit-tested (the mapper), and the mirror op + render path are live-verified, but connecting a *real* Google/Outlook account needs OAuth creds that don't exist in this env/CI. The desktop-sync manual checks above cover it.
- **The legacy `use-calendar.ts` localStorage store is orphaned, not deleted** — nothing imports it anymore (Settings + the sync writer moved to the cloud). A follow-up can delete `use-calendar.ts` + the legacy `runtime.calendar` methods (`listEvents`/`syncGoogleEvents`/`startGoogleOAuth`/etc.) safely.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
