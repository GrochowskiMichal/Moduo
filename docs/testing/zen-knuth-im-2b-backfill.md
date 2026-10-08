# Manual test checklist — IM-2b backward backfill engine

> Generated 2026-07-30 · branch `t/maciej/im-2b-backfill-engine` · **Live-verified: no.** Email is desktop-only and driving the backfill end-to-end needs a real IMAP account in the OS keychain plus a mailbox with >90 days of history. What *was* verified: `cargo check` + `--features lite` clean, `cargo test --lib` **67/67**, `bun run verify` **1282**, and every state-machine test proven non-vacuous by reintroducing the bug it guards and watching it fail.
> Run on **desktop** with at least one real mailbox holding more than 3 months of mail.
>
> **⚠️ Read this first — two things this block does NOT deliver.** (1) The backfilled mail is currently **invisible**: the list is capped at 500 rows, instant search filters only the rows already loaded, and the Rust search scans only bodies you've already opened. So "12 months synced" will not show up as *anything you can see* until a list/search surface lands. (2) Only **INBOX** syncs — archived mail (where the year-old invoices actually are) is untouched at any depth. Both are recorded as open questions in [specs/import.md](../../specs/import.md); they need your product call, not a bug report.

## Nothing regressed (the important part)
- [ ] **Do:** Launch, open Email, let it sync. → **Expect:** Inbox lists as before — same recent mail, same order, same read/starred state. No empty list, no error banner. _(desktop)_
- [ ] **Do:** Check that every connected account is still connected (Settings → Integrations). → **Expect:** All of them, still `active`. _(This is the upgrade hazard: the account blob gained a `historyDepth` field, and the loader turns any parse failure into "no accounts at all". If accounts vanished, stop and report — that's the worst case.)_ _(desktop)_
- [ ] **Do:** Send yourself mail from another client with the app open. → **Expect:** It arrives without a manual refresh, as before. _(desktop)_
- [ ] **Do:** Mark read/unread, star, archive, delete a message. → **Expect:** All behave exactly as before and survive a restart. _(desktop)_

## The backfill actually walks
- [ ] **Do:** Hit Refresh a few times on your largest mailbox, then check whether mail older than ~90 days is present. The engine walks **500 older UIDs per sync round**, so this takes many rounds — the point is that the oldest visible date *moves backwards* over time, not that it finishes. → **Expect:** Older mail progressively appears (as far as the 500-row list cap lets you see it). _(desktop)_
- [ ] **Do:** Quit the app mid-backfill (force-quit), relaunch, refresh. → **Expect:** It resumes from where it stopped — it does not restart from the newest mail. Nothing already fetched is re-fetched. _(desktop)_
- [ ] **Do:** Watch the Refresh button's responsiveness during a backfill. → **Expect:** One click = one 500-UID batch, not a long stall. If a refresh ever hangs for tens of seconds, report it. _(desktop)_
- [ ] **Do:** On a mailbox with *less* than 3 months of mail, refresh a few times. → **Expect:** Completes quietly; no error, no endless re-walking. _(desktop)_

## Edge cases (the data-loss ones — please actually try these)
- [ ] **Do:** Let a mailbox backfill for a while, then **force a `uid_validity` change**: in Gmail, delete and recreate a label, or on an IMAP server rename the mailbox away and back. Refresh. → **Expect:** Already-synced history is **still there**. The old behavior deleted every local row not in the just-fetched set; the whole point of this block is that it doesn't. Mail may temporarily appear duplicated (old and new UID numbering) — that is the ratified trade-off, and it should settle as the walk re-covers the mailbox. **A shrinking inbox here is a bug — report immediately.** _(desktop)_
- [ ] **Do:** Kill the network mid-backfill (turn off Wi-Fi during a refresh), then restore it and refresh again. → **Expect:** The account does **not** get stuck showing an error banner forever, and the walk picks up again. New mail still syncs while the backfill is failing. _(desktop)_
- [ ] **Do:** Set your Mac's clock far into the future or past, refresh, then set it back. → **Expect:** No mass re-download and no mass deletion — the engine skips the backfill rather than treating a broken clock as "sync everything". _(desktop)_
- [ ] **Do:** After a backfill has run, install the **previous** build (drop-in replace backwards), open Email, then reinstall this one. → **Expect:** Accounts survive both directions; the older build ignores the new fields. _(desktop)_

## Migrations / data
- [ ] Nothing to do — **no SQL migration, no cloud schema change, no redb schema change.** Additive `#[serde(default)]` fields only: `historyDepth` on the stored account, and `oldestSyncedUid` / `historyFloorMs` / `backfillComplete` / `backfillLastError` on the per-folder sync cursor. Old stores upgrade in place; the older build reads them back fine.

## Known gaps / not-yet-testable
- **No end-to-end IMAP verification from this session** — needs a desktop build and real mailbox credentials. The engine's state machine is unit-tested (including every transition that used to be wrong), but no message crossed a socket.
- **AC7 is partial.** Mail is fetched but not reachable — see the warning at the top. This is the single most important thing to decide next.
- **AC9 is partial.** Resumable ✓ (tested). **Cancellable ✗** and **determinate progress ✗** — both are IM-2c.
- **No depth picker yet** (IM-2c). Every account is on the 12-month default, so the 3 / 6 / Everything paths and the change-depth-later behaviour can't be exercised by hand — only by unit test.
- **The walk needs a real driver.** It advances only inside a sync round, and for an IDLE-capable account (Gmail) there is effectively no periodic round — it progresses on Refresh clicks and archive events. Covering a year of a busy mailbox therefore takes many deliberate refreshes. A proper background driver belongs with IM-2c's progress + cancel.
- **A failing backfill is quiet.** It records `backfillLastError` on the cursor (so IM-2c can render it) but shows nothing today, by design — the alternative was letting one bad message pin the whole account at "error".
- **`SINCE` matches the server's INTERNALDATE while the local filter uses the `Date:` header.** On a migrated mailbox (every INTERNALDATE = migration day) a "3 months" choice can walk the whole mailbox and store almost none of it. Recorded in [docs/gotchas.md](../gotchas.md).
- **The window is computed in UTC**, so a depth boundary is off by up to a day for a non-UTC user. Harmless, recorded.
- **AC11 at the new scale is unproven.** Depth goes 90 days → 12 months (~4× the envelope table) while the "All inboxes" list still walks every key. IM-2a fixed the sync path; the default list scope was its handed-off item and is now the one that matters.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
