# Manual test checklist — Email EM-9 (search) · EM-10 (smart inbox)

> **✅ Migration status (reconciled 2026-08-14 · DOC-1): the migration this checklist calls "deploy-gated" is APPLIED to prod** (OPS-1 + OPS-2, 2026-07-29, verified against the live catalog), so EM-10's per-sender override **sync half is live** — overrides are no longer local-only. What is still genuinely manual is the *desktop engine* (local body sidecar, IMAP search escalation) — that needs a real mail account, not a deploy. Status of record: [`specs/BUILD_ORDER.md`](../../specs/BUILD_ORDER.md).

> Generated 2026-07-07 · branch `claude/quirky-goodall-aab1ab` · **Live-verified:** no — search + smart inbox are desktop-engine features (the local body sidecar, IMAP server search, and the HEADER.FIELDS fetch all live in the Rust engine and are headless-incompatible), and the one migration is deploy-gated. `bun run verify` (807 unit tests) + `cargo check` + `cargo test` (email suite) are green; the pure logic (search merge/dedupe, envelope match, classifier rules, query escaping, body-text truncation) is unit-proven. Everything below is the designer's desktop pass on the disposable IMAP mailbox.

## Pre-req — migration (EM-10 sync half) — **APPLIED to prod 2026-07-07**
- [x] Migration `20260707120000_user_preferences_email_domain.sql` applied (`user_preferences.email` + `email_updated_at` columns live); per-sender overrides sync cross-device. `src/types/supabase.ts` hand-added.
- [ ] **Do:** Open /email, change the app theme/font (appearance prefs), set a per-sender override, reload. → **Expect:** appearance/focus/calendar prefs load + save normally; the override persists AND (now the column is live) syncs to another device. No console errors. _(desktop + web)_

## EM-9 — Local search (AC12)
- [ ] **Do:** Open /email (desktop, ≥1 synced account). Click the search box (or press `/`), type a sender's name. → **Expect:** results appear instantly as you type; matches over sender name, address, recipients, and subject; the inbox sections are replaced by a flat result list. _(desktop)_
- [ ] **Do:** Search for a word you know is only in an email's BODY (not the subject/preview) of a message you've opened before (so its body is cached). → **Expect:** the message shows up a beat after the envelope matches (the cached-body sidecar scan). _(desktop)_
- [ ] **Do:** Search a term, then press `Esc` in the search box (or click the ✕). → **Expect:** search clears and the smart-inbox sections return exactly as before. _(desktop)_
- [ ] **Do:** With the Unified scope, search a term two accounts both match. → **Expect:** results from both accounts, each with its account hue dot; the same message that lives in a Gmail account's INBOX and All Mail shows once (deduped). _(desktop)_
- [ ] **Do:** While searching, use `j`/`k` to move through results and `Enter` to open one. → **Expect:** keyboard nav walks the result list; opening loads the thread in the reader. Triage keys (`e`/`s`/`#`) still act on the highlighted result. _(desktop)_

## EM-9 — Server escalation (AC12)
- [ ] **Do:** Search a term with few/no local hits. Below the results, click "Search all mail on <account>". → **Expect:** the row shows "Searching all mail on <account>…" then merges in older matches from the full mailbox, marked "N more from <account>". _(desktop)_
- [ ] **Do:** Run the escalation on a **Gmail** account with a Gmail-syntax query (e.g. `from:someone has:attachment`). → **Expect:** X-GM-RAW honors the Gmail operators; results from All Mail merge in. _(desktop, Gmail)_
- [ ] **Do:** Run the escalation on a slow/limited custom IMAP host, or one that rejects the SEARCH. → **Expect:** an honest state — "…timed out — try again" or "…doesn't support full-mailbox search" — and the local results stay visible above it (never a blank list). _(desktop, custom IMAP)_
- [ ] **Do:** Open a server-only result (one not in the synced window). → **Expect:** its body loads normally (the hit was upserted into the store). _(desktop)_
- [ ] **Do:** After escalating, confirm the All-Mail results did NOT leak into the normal inbox list (clear search, look at the inbox). → **Expect:** the inbox is unchanged (escalation envelopes carry their own folder, filtered out of the inbox view). _(desktop)_

## EM-10 — Smart inbox classification (AC13)
- [ ] **Do:** Open /email with a mix of mail. → **Expect:** the inbox is grouped under **Personal**, **Notifications**, **Newsletters** headers (each with a count); Personal is first; empty sections are hidden; classification is instant (no flash of ungrouped rows). _(desktop)_
- [ ] **Do:** Find a marketing email with a List-Unsubscribe header. → **Expect:** it lands in **Newsletters**. _(desktop)_
- [ ] **Do:** Find a GitHub/CI-style notification (no-reply sender, Auto-Submitted). → **Expect:** it lands in **Notifications**, NOT Newsletters (even though it also has List-Unsubscribe). _(desktop)_
- [ ] **Do:** Find a 1:1 email from a person in your Contacts. → **Expect:** it lands in **Personal** (known-sender pull-back), even if it carries bulk headers. _(desktop)_
- [ ] **Do:** Confirm pinned/starred threads float to the top of their own section, and `j`/`k` walks straight through the section boundaries. _(desktop)_

## EM-10 — Per-sender override (AC13)
- [ ] **Do:** Hover a row → click the ⋯ menu → "Always put <sender> in Personal". → **Expect:** every thread from that sender immediately re-files into Personal and stays there across reloads. _(desktop)_
- [ ] **Do:** Re-open the ⋯ menu for that sender. → **Expect:** the current section shows a check; a "Reset to automatic" option appears; choosing it returns the sender to rule-based classification. _(desktop)_
- [ ] **Do:** (post-migration) Set an override on desktop, then open /email on the web (or a second device). → **Expect:** the override is reflected (cloud sync). _(cross-device)_

## Regression sweep (touched surfaces)
- [ ] **Do:** With no search active, run the full EM-4/EM-5 triage day (open, `e`/`p`/`s`/`t`/`m`/`#`, undo toasts). → **Expect:** unchanged behavior; sections don't interfere with triage or undo. _(desktop)_
- [ ] **Do:** Switch the rail to Snoozed / Follow-ups, then type in search. → **Expect:** search results take over the center regardless of the rail view; clearing search returns to the selected view. _(desktop)_
- [ ] **Do:** On web, open /email. → **Expect:** the read-only tissue view renders as before (search/sections are desktop-only; no errors). _(web)_

## Known gaps / not verifiable here
- The whole desktop 3-pane (engine-backed search, escalation, HEADER.FIELDS classification) is manual — the IMAP engine is headless-incompatible; only the pure logic is unit-proven.
- The EM-10 sync half needs the deploy-gated migration; until then overrides are local-only (graceful).
- Server "entire mailbox" search covers Gmail All Mail (X-GM-RAW) and the primary INBOX for standard IMAP; searching every folder on a standard server is out of scope for v1 (recorded).
