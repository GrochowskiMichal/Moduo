# Manual test checklist — IM-2a email store read/write path

> Generated 2026-07-29 · branch `claude/zen-knuth-3e7bcd` · **Live-verified: no.** Email is **desktop-only** (the whole engine is Rust/Tauri; `runtime.web.ts` stubs it as `desktopOnly()`), and driving it end-to-end needs a real IMAP account in the OS keychain plus a populated redb store on the designer's machine — neither exists in this session. What *was* verified here: `cargo check` + `cargo check --features lite` clean, `cargo test --lib` **56/56** including two new storage tests that exercise a **real redb database** on disk (not a mock), `bun run verify` **1278** green, and a differential check proving both new tests fail when the old implementations are restored. This checklist is the end-to-end confirmation.
> Run top-to-bottom on **desktop** with at least one real mailbox connected. **IM-2a is a pure-performance change — the correct outcome everywhere below is "nothing looks different, and nothing is missing."**

## Baseline — nothing changed for the user
- [ ] **Do:** Launch the desktop app, open Email with your existing accounts already connected. → **Expect:** The inbox lists exactly the messages it listed before this build — same count, same order (newest first), same read/starred state, same previews. No empty list, no "0 messages", no error toast. _(desktop)_
- [ ] **Do:** Switch the account rail between "All accounts" and each individual account. → **Expect:** Each view shows that account's mail; "All accounts" shows the union. Nothing an account owns disappears. _(desktop)_
- [ ] **Do:** Switch folders (Inbox → Sent → Archive → back). → **Expect:** Each folder shows only its own messages. No message leaks between folders — in particular nothing from Sent appears in Inbox. _(desktop)_
- [ ] **Do:** Open a message, then open a threaded conversation with several replies. → **Expect:** The whole thread renders oldest → newest, deduped, exactly as before. Messages from *other* accounts do not appear in the thread. _(desktop)_
- [ ] **Do:** Hit refresh / force-sync on a mailbox. → **Expect:** New mail arrives and the list updates. Watch that the sync completes at least as fast as before — the whole point of this block is that it should be faster on a large store. _(desktop)_

## Write path — batched commits
- [ ] **Do:** Force a full sync on your **largest** mailbox (thousands of messages) and time it, ideally against the previous build. → **Expect:** Completes normally, and noticeably faster: each 50-message chunk is now one database commit instead of 100. Nothing is missing at the end. _(desktop)_
- [ ] **Do:** Mark a message read/unread and star/unstar it. → **Expect:** The change sticks immediately and survives a restart. _(desktop)_
- [ ] **Do:** Archive, move, and delete a message. → **Expect:** It leaves the list right away and does not come back on the next sync. _(desktop)_
- [ ] **Do:** Run a server-side search (the escalation search across folders) and open a result. → **Expect:** Results list, and opening one fetches its body normally — search results still get cached locally. _(desktop)_

## Real-time (IDLE)
- [ ] **Do:** With the app open on Inbox, send yourself a message from another client. → **Expect:** It appears without a manual refresh, exactly as before. _(desktop)_
- [ ] **Do:** Send yourself several messages in quick succession (>1 batch worth if you can), then quit and relaunch. → **Expect:** All of them are present after relaunch — none silently skipped. _(This exercises the new rule that the IDLE cursor only advances past a chunk that actually stored.)_ _(desktop)_

## Edge cases
- [ ] **Do:** Receive/keep a message with **no `Date:` header** (a malformed sender or a test message sent with the header stripped), then force-sync the same folder 3–4 times. → **Expect:** It stays a single row in the list — it does not duplicate, and the mailbox does not grow a hidden index row per sync. _(This is the leak IM-2a fixes; the index isn't user-visible, so the observable check is "no duplicates, no growth".)_ _(desktop)_
- [ ] **Do:** Disconnect an account in Settings → Integrations, then switch the rail to "All accounts". → **Expect:** Whatever the previous build did with that account's already-synced mail, this build does the same — this path was deliberately left unchanged. _(desktop)_
- [ ] **Do:** Connect a **custom IMAP** account whose host is an IPv6 literal (`[::1]`-style) if you have one available. → **Expect:** Its mail lists under both the account view and "All accounts". _(Covered by a unit test; flagged because the account id then contains the `::` key separator.)_ _(desktop)_
- [ ] **Do:** Let a mailbox sit long enough (or open enough message bodies) to trip the body-cache prune — 2,500 cached bodies or 200 MB per account. → **Expect:** Older bodies get evicted, the app stays responsive, and already-open messages still render (they refetch on demand). _(desktop)_
- [ ] **Do:** Kill the app mid-sync (force-quit while a large folder is syncing), relaunch. → **Expect:** No corruption, no empty inbox; the next sync fills in what was missed. Writes are now per-chunk atomic, so a chunk either landed whole or not at all. _(desktop)_

## Migrations / data
- [ ] Nothing to do — **no SQL migration, no cloud schema change, no redb schema change.** Table set is unchanged (`email_envelopes` / `email_envelope_order` already existed); only the read/write *paths* over them changed. An existing store upgrades in place with no conversion step.

## Known gaps / not-yet-testable
- **No end-to-end IMAP verification from this session.** Email needs a desktop build plus real mailbox credentials in the OS keychain; both are on the designer's machine. The storage layer is covered by unit tests against a real on-disk redb, but no message ever crossed a socket here.
- **No before/after timing on a real 30k-envelope store.** The improvement is structural (per-sync-round full-table deserialize → per-account prefix scan; 2 commits per envelope → 1 per chunk) and argued from the code, not measured against the designer's actual mailbox. If a large mailbox does *not* feel faster, say so — that would mean the remaining full scans below dominate.
- **The user-facing list does not take the fast path.** `use-email-module.ts` calls `listEnvelopes({ accountId: null })` and filters the account rail client-side, so the UI list takes the unscoped key-walk (parses only the target folder, but still walks every key) rather than the true prefix scan. The prefix scan serves the **sync** path, which is what AC11 names. Making the UI pass the selected account is a one-line frontend change left for IM-2b/2c.
- **`email_get_thread` still reads every envelope for the account.** Narrowed from the whole table to one account's keys this session; `thread_id` isn't in the key, so removing the rest needs a real thread index → IM-2b.
- **`email_get_mailbox_status` is still a whole-table scan** — and has no app caller at all. Delete or index it in IM-2b.
- **Pre-IM-2a order-index orphans are not swept.** The write path now keeps exactly one index row per envelope going forward, but rows orphaned by the old two-commit write survive on an existing store. Nothing reads that index today; IM-2b is its first consumer and owns the reconcile.
- **AC10 is only half-closed by this block** — the date-less-message index-orphan half. "A `uid_validity` change never deletes mail inside the depth window" is the ungated full-reset prune, which is IM-2b's job.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
