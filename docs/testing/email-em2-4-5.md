# Manual test checklist — Email EM-2 / EM-4 / EM-5

> Generated 2026-07-04 · branch `claude/hopeful-cohen-85f8ab` · **Live-verified:** no — desktop Tauri engine + Gmail OAuth are headless-incompatible; verified via `cargo test` (42 Rust unit tests green: threading, ops planner, XOAUTH2/refresh, secrets) + `bun run verify` + the validator pass. Everything below is the designer's **first-run** pass on the desktop app.
>
> **Prereq:** run the desktop app (`bun run dev:desktop`). For the Gmail OAuth path, set `MODUO_EMAIL_GOOGLE_CLIENT_ID` (+ `_SECRET`) — or reuse `MODUO_CALENDAR_GOOGLE_CLIENT_ID`/`_SECRET` (the email OAuth falls back to the calendar Google app). Add the `https://mail.google.com/` scope to that OAuth client's consent screen. For engine round-trips, a disposable IMAP mailbox helps (`MODUO_TEST_IMAP_CREDS_PATH`).

## EM-2 — Connect accounts (Settings → Integrations → Email)
- [ ] **Do:** Settings → Integrations → Email → "Connect email account" → **Custom IMAP** tab → enter a real IMAP account (host/port/user/app-password) → Connect. → **Expect:** validates by connecting; on success the account row appears with a "Connected" status; the secret is in the OS keychain (not redb). _(desktop)_
- [ ] **Do:** Connect an **iCloud** account with an app-specific password (host preset baked in). → **Expect:** connects and syncs. _(desktop)_
- [ ] **Do:** Connect a **Gmail** account via **"Use an app password"** (needs 2-Step Verification; the hint links to the app-passwords page). → **Expect:** connects. _(desktop)_
- [ ] **Do:** Connect **Gmail** via **"Sign in with Google"**. → **Expect:** browser opens the Google consent screen; after approving, the tab shows "Email connected"; the account appears with status active. The small print warns about the 7-day re-approval (testing-mode app). _(desktop)_
- [ ] **Do:** Leave the OAuth Gmail account connected for >1h, then open the inbox / send. → **Expect:** the access token silently refreshes (no reconnect prompt). After ~7 days (or if you revoke access in your Google account), the row flips to **Reconnect** — one click re-runs the flow. _(desktop)_
- [ ] **Do:** Disconnect an account (Settings row → Disconnect). → **Expect:** the row disappears and the keychain secret is removed. _(desktop)_

## EM-4 — Unified inbox + reader (`/email`, ⌘6)
- [ ] **Do:** Open Email. → **Expect:** a 3-pane shell (account rail · conversation list · reader). The rail shows a "Unified" row + one row per account with a colored hue dot, unread count, and status glyph. _(desktop)_
- [ ] **Do:** Click "Unified" vs a single account. → **Expect:** the center list filters to that scope; newest conversations first; unread rows read heavier (weight, not just color); starred/pinned float to the top; a "N" chip on multi-message threads. _(desktop)_
- [ ] **Do:** Open a thread that is a 3+ message reply chain (A→B→C). → **Expect:** it shows as ONE conversation (the old split-chain bug is fixed — References-root threading), with all messages in the reader stack, newest expanded / older collapsed. _(desktop)_
- [ ] **Do:** Open a message with an HTML body. → **Expect:** it renders in a sandboxed iframe (remote images load); a cached message opens instantly. _(desktop)_
- [ ] **Do:** Confirm the Email nav tab shows an unread badge/dot when there's unread mail. → **Expect:** badge present; clears as you read. _(desktop)_
- [ ] **Do:** Compare inbox depth to before. → **Expect:** more history than the old 50-message cap (up to ~1000 UIDs / 90 days per folder). _(desktop)_

## EM-5 — Triage (keyboard-first)
- [ ] **Do:** With the list focused, use `j`/`k` to move, `Enter` to open, `Esc` back. → **Expect:** selection moves (wrapping); Enter opens the reader and marks the thread read. _(desktop)_
- [ ] **Do:** Press `e` (Done/archive) on a thread. → **Expect:** the row leaves the list immediately; an "Archived · Undo" toast shows for 8s; the mail is archived in webmail (Gmail: leaves INBOX, stays in All Mail; others: moved to Archive). _(desktop)_
- [ ] **Do:** Press `e` then click **Undo** within 8s. → **Expect:** the row returns and NOTHING changed server-side (the IMAP op only commits after the window). _(desktop)_
- [ ] **Do:** Press `p` to pin/star, then `p` again. → **Expect:** the star toggles (visible in webmail as `\Flagged`). _(desktop)_
- [ ] **Do:** Press `#` (delete). → **Expect:** the thread moves to Trash (undo toast). _(desktop)_
- [ ] **Do:** Press `m` (move) → pick a folder from the popover (all server folders, delimiter-aware). → **Expect:** the thread moves there; undo toast. _(desktop)_
- [ ] **Do:** Go offline, archive/delete a few, come back online and sync. → **Expect:** the queued ops flush and apply server-side; no retry storm; no blank module. _(desktop)_

## Edge cases
- [ ] **Do:** A Gmail account whose OAuth consent you revoked. → **Expect:** the row flips to `reauth_required` with Reconnect (never a silently dead account). _(desktop)_
- [ ] **Do:** A custom host that refuses the archive/trash folder. → **Expect:** the op retries with backoff and surfaces honestly; the message reappears on the next sync if it ultimately failed (no data loss). _(desktop)_
- [ ] **Do:** Open `/email` on **web**. → **Expect:** a calm read-only note ("open on desktop") + any linked-email tissue cards — no fake compose/triage buttons. _(web)_

## Migrations / data
- [ ] No Supabase migration in these blocks (EM-3 already landed the cloud substrate). A new **redb** table `email_op_outbox` is created automatically on first run (triage op queue) — nothing to apply. StoredEnvelope gains a `references` field (defaulted for old rows).

## Known gaps / not-yet-testable
- **Snooze / follow-ups** are rail counts only here — the pickers + due notifications are EM-6.
- **Compose / reply / attachments** are EM-4-out-of-scope — EM-7.
- **Convert→task, contact panel, tags, drag** — EM-8. The reader's "Detail" right-panel variant is a placeholder until then.
- **Search, smart-inbox sections** — EM-9 / EM-10.
- Gmail **OAuth** round-trip + real IMAP triage are manual (headless-incompatible); the engine logic is unit-tested but the live server round-trip is this checklist.
- IDLE (push) sessions read the stored OAuth token; if it's stale and no foreground sync has refreshed it, IDLE may drop until the next foreground sync refreshes — benign (best-effort push).
