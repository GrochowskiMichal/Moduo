# Mail as built (2026-11-21, origin/maciej @ e566e71ef)

Read-only Explore lane over `apps/app/src/features/email/` (E/), `apps/desktop/src-tauri/src/mail/` (R/), `apps/app/src/features/settings/mail/` (S/), the MCP module and the spine. All MR-0…16, MV-0…12 and MI-0…7 blocks landed (#791, #797, #804; v1.8.0). No mail commits since.

## Layout
- **Rail:** Mail header (Sync, Settings) · New message (`c`) · Inbox, Sent, Drafts, (Outbox when non-empty), Archive, Trash, Spam · Snoozed, Follow-ups, New senders (Screener on), Subscriptions, Attachments · Accounts with folder trees, Load more history, backfill progress · Saved searches · Connect account.
- **List:** tabs Personal · ≤3 custom · Notifications · Newsletters, "+N" overflow, ⋯ "Get me to zero in {Tab}"; virtualized rows; hint line; system lines.
- **Reader:** toolbar, chip row (links), who-card, message stack, tracker bar, unsubscribe bar, invite card (Accept/Maybe/Decline, Add to Moduo calendar), attachments, pending body, ⋯ menu, "Why here?" sheet; 2+ selected → bulk reader.
- **Right panel:** Today, Contact, Task only (`E/panel-views.ts`). Folds to a strip <1180 px.
- **Bottom bar:** no Mail mode; generic Search · Quick capture · Create new.
- **Compose:** inline under the thread or filling the reader column; no floating/pop-out.

## States
No-accounts, first sync, empty place, tab clear ("{Tab} is clear"), offline (global + per account), reconnect, couldn't sync, away, failed actions, follow-up nudge, body pending/offline, web read-only. **Missing: a list-load error state** (a failed `listThreads` is swallowed and looks like "clear").

## Keys (lib/hotkeys/registry.ts 232–300)
j/k ↓↑ Enter o · ] [ tabs · e ⇧E w p # ⌫ m s u · t l n · r a f c ⌘N · x ⇧J ⇧K ⌘A Esc · z ⌘Z · ⌥0–3 F6 · g i/f/s/a/t/d/p/v/n/l · ? / y b · composer ⌘↵ ⌘⇧↵ Esc · ;; snippets · Space previews an attachment.

## Features
Built: custom tabs, Screener, snooze (typed + presets + Someday), remind if no reply, undo send 5–30 s, snippets, aliases + signatures, search operators, saved searches, bulk, unsubscribe + Subscriptions, block, report spam, pin, mute, Gmail labels, folders (read), attachments view, density (comfortable 1–2 lines, compact), notifications + Dock badge, server drafts, Outbox, rules, priority people, storage caps, default mail app.
Absent: send later (cut by spec X9), print (X28), templates beyond snippets, folder create/rename/delete, saved-search manage/remove, share-to-chat, scheduling/offer times/booking links in Mail, email capture source.

## Spine
convert → task (+ multi), link, private note, drop onto task/calendar day, create event, unlink with undo; invite RSVP; contact panel with tasks/notes/meetings/mail/files + Add as contact; notes list emails; chat can reference a thread via + menu or pasted URL; link chips (no realtime); dashboard widget; MCP: email_list/get/search/snooze/unsnooze/follow_up/clear_follow_up/link/remove (metadata only). **MCP snooze/follow-up writes cloud refs the Mac never reads** (agent snooze does nothing on desktop).

## Rough edges
Dead `E/threads.ts`; EM-era files still in use (`model/email-types.ts`, `prefs.ts`, `refs.ts`, `search-palette.ts`); silent catches (list reads, saved searches, attachment ensure); `mail-shell.tsx` 874 lines, `mail-page.tsx` 744; saved searches read once on mount; "Open Moduo for Mac" goes to the download page (no URL scheme).
