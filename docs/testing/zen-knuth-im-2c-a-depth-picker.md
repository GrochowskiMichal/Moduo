# Manual test checklist — IM-2c-a email history depth picker

> Generated 2026-07-30 · branch `t/maciej/im-2c-depth-picker` · **Live-verified: no.** The email section is desktop-only and needs a real mailbox in the OS keychain. Verified here: `bun run verify` **1298**, `cargo test --lib` **70/70** (incl. new wire-format round-trip tests), `cargo check` + `--features lite` clean, clippy at base.
> Run on **desktop**. This is the picker half of IM-2c — **AC6 + AC8**. Progress and cancel (**AC9**) are NOT in this build; see the gaps below.

## Connect-time picker (AC6)
- [ ] **Do:** Settings → Integrations → connect a new mailbox. → **Expect:** An "Inbox history to sync" dropdown, defaulting to **12 months**, above the password field. The helper text says it applies to your inbox and that archived mail isn't synced yet. _(desktop)_
- [ ] **Do:** Pick **Everything**, then connect with **Sign in with Google**. → **Expect:** After connecting, Settings shows that account at "Everything". _(This was broken until the review caught it — the OAuth path ignored the picker entirely and silently gave every Gmail account 12 months.)_ _(desktop)_
- [ ] **Do:** Pick **3 months** and connect with an **app password** (Gmail, iCloud or custom IMAP). → **Expect:** Settings shows 3 months. _(desktop)_
- [ ] **Do:** Connect one mailbox at "Everything", then open the dialog again for a second mailbox. → **Expect:** The picker is back at **12 months**, not inheriting the previous pick. _(desktop)_
- [ ] **Do:** On an account showing "Sign-in expired", click **Reconnect**. → **Expect:** **No** depth picker — that repairs a credential, it shouldn't re-scope the mailbox — and the account's existing depth survives the reconnect. _(desktop)_

## Changing it later (AC8)
- [ ] **Do:** Settings → Integrations, change an account from 12 months to **Everything**. → **Expect:** A line appears saying Moduo starts fetching older mail, and it **stays** on screen (not a flash). A sync kicks off immediately. _(desktop)_
- [ ] **Do:** Now change it back **down** to 3 months. → **Expect:** The line reads "Moduo stops fetching older mail. **Nothing already synced is deleted.**" — and it stays. Then confirm: mail older than 3 months that had already synced is **still in your mailbox**. _(This is the promise the whole depth design rests on.)_ _(desktop)_
- [ ] **Do:** Check the label above the dropdown. → **Expect:** "Inbox history · this device" — depth is per-machine, so your other Mac keeps its own. _(desktop)_
- [ ] **Do:** Change the depth, then quit and relaunch. → **Expect:** The new depth is still shown and still in effect. _(desktop)_
- [ ] **Do:** Tab to the dropdown with the keyboard and listen with VoiceOver. → **Expect:** It announces the label *and* the selected value ("12 months"). _(desktop)_

## Edge cases
- [ ] **Do:** Change depth on two accounts in quick succession. → **Expect:** Both land; neither reverts to its old value. _(desktop)_
- [ ] **Do:** Raise the depth, then immediately hit Refresh a few times. → **Expect:** Older mail progressively appears; no error banner. _(desktop)_
- [ ] **Do:** With no network, change the depth. → **Expect:** An error is shown and the dropdown rolls back to the stored value rather than claiming a depth the engine isn't using. _(desktop)_

## Migrations / data
- [ ] Nothing to do — **no SQL migration, no schema change.** `historyDepth` was already on the stored account (IM-2b); this exposes it on the public DTO and adds the `email_account_set_history_depth` command.

## Known gaps / not-yet-testable
- **AC9 is not in this build.** No determinate progress, no cancel button. Recorded as **IM-2c-b**, with a spec amendment explaining why the transport should be a cursor-backed status read rather than the Tauri events the spec assumed (the app has no event channel at all, and an event stream tells a relaunched app nothing about a walk that survives restarts).
- **"Everything" means everything in your INBOX.** Only the inbox syncs at any depth — archived mail is untouched. The copy now says so, but this is still 🔴 **Open question 1** in the spec and needs your call.
- **You still can't see the backfilled mail.** 500-row list cap, search over loaded rows only — 🔴 **Open question 2**. The picker makes a promise the read surface can't yet show.
- **A raise kicks one sync round, not a background job.** After that the walk advances on Refresh clicks and archive events (500 UIDs at a time). That's why the copy says "as you use Mail" and not "in the background".
- **A failing backfill is still invisible** — `backfill_last_error` is recorded on the cursor and surfaced nowhere. IM-2c-b's job.
- **Not live-verified**: needs the desktop build and a real mailbox.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
