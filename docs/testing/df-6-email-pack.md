# Manual test checklist — DF-6 Email daily-use pack

> Generated 2026-07-10 · branch `t/maciej/df-6-email-pack` · **Live-verified:** partial — the iframe security core (remote blocking + auto-height postMessage) was proven in a real headless Chromium run against the actual `buildEmailSrcDoc` output (blocked doc fired **zero** network requests; height messages arrived both modes). Everything below that needs the desktop app + a connected mailbox is manual.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Remote images blocked by default (DF-6 §1)
- [ ] **Do:** open a newsletter / marketing email (anything with remote images) in the reader → **Expect:** images do NOT load; a slim "Remote images blocked" bar sits above the body with **Load images** and **Always allow from this sender** _(desktop)_
- [ ] **Do:** click **Load images** → **Expect:** the message reloads with images visible; the bar disappears; the iframe grows to fit _(desktop)_
- [ ] **Do:** open a different message from the same sender → **Expect:** images blocked again (Load images is per-message) _(desktop)_
- [ ] **Do:** click **Always allow from this sender**, then open another message from that sender → **Expect:** toast "Images from … will always load"; images load with no bar, in this and future messages _(desktop)_
- [ ] **Do:** open a plain-text or local-images-only email → **Expect:** NO "Remote images blocked" bar (nothing to unblock) _(desktop)_
- [ ] **Do:** restart the app, reopen a message from the always-allowed sender → **Expect:** still allowed (pref persists; it also cloud-syncs via the email prefs domain) _(desktop)_

## Reader iframe auto-height (DF-6 §2)
- [ ] **Do:** open a two-line email → **Expect:** the body area is short (no giant white void under it); the panel below is usable _(desktop)_
- [ ] **Do:** open a long newsletter → **Expect:** ONE scrollbar (the reader panel's) — the message doesn't scroll-trap inside a nested iframe scrollbar _(desktop)_
- [ ] **Do:** in a long thread, expand an older collapsed message → **Expect:** its body sizes to content too _(desktop)_

## Sync state + manual refresh (DF-6 §3)
- [ ] **Do:** look at the center header (next to search) → **Expect:** a refresh icon button; hover shows "Sync now — last synced …" _(desktop)_
- [ ] **Do:** click it → **Expect:** "Syncing…" text appears, the icon spins and disables; new mail lands after the sync finishes _(desktop)_

## Broken-account banner (DF-6 §3)
- [ ] **Do:** break one account (e.g. revoke its app password / change the IMAP password server-side), sync, and select **All inboxes** → **Expect:** a warning banner under the header: "<address> isn't syncing — new mail may be missing." with **Reconnect** (reauth) or **Retry sync** (error) _(desktop)_
- [ ] **Do:** click **Reconnect** → **Expect:** the reconnect dialog opens pre-filled for that account _(desktop)_
- [ ] **Do:** fix the account → **Expect:** banner disappears after the next sync _(desktop)_

## Convert-to-task compensating cleanup (DF-6 §4)
- [ ] **Do:** normal convert (`t` on a thread) → **Expect:** unchanged happy path — task created, Task panel opens, undo toast works _(desktop)_
- [ ] **Do:** (hard to force manually — optional) kill the network mid-convert (toggle Wi-Fi right after pressing `t`) → **Expect:** error toast, and NO orphan task appears in Tasks inbox afterwards _(desktop)_

## Keyboard `r` + `?` (ride-along)
- [ ] **Do:** select a thread, press `r` → **Expect:** reply composer opens for that thread _(desktop)_
- [ ] **Do:** press `?` on /email (not while typing) → **Expect:** a compact "Keyboard shortcuts" dialog listing j/k, Enter, r, e, t, s, m, p, #, /, ? _(desktop)_

## Regressions to spot-check
- [ ] **Do:** open an email with inline (cid:) images, e.g. a signature logo → **Expect:** inline images still render even while remote images are blocked _(desktop)_
- [ ] **Do:** open an email with attachments → **Expect:** attachment chips + save still work _(desktop)_
- [ ] **Do:** web /email → **Expect:** unchanged desktop-gate + tissue cards; no new errors _(web)_

## Known gaps / not-yet-testable
- Convert failure path was code-reviewed + compensations mirror the tested undo path, but a real mid-sequence RPC failure wasn't inducible in-session.
- Storybook in this worktree fails to boot on a pre-existing `@/lib/utils` vite-alias error (not from this branch) — the new RemoteImagesBlocked/Allowed stories couldn't be eyeballed there; the same surfaces were proven via the headless-Chromium harness instead.
- The always-allow list currently has no management UI (add-only); removing a sender means clearing the `moduo:email:prefs:<userId>` localStorage key / waiting for a Settings surface.
- Cross-version caveat: a pref write from an OLD (pre-DF-6) build can wipe the allow-list (whole-object domain sync — see gotchas §Email reader hardening). Rebuild the desktop app from this branch before relying on it.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
