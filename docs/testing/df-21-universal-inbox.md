# Manual test checklist — DF-21 Universal Inbox (the notification bell "grows up")

> Branch `t/maciej/df-21-universal-inbox`. Covers **DF-21a** (bell → dropdown) + **DF-21b** (dismiss + undo).
> **Live-verified on the hosted account (Claude Test S2):** DF-21b's migration is **applied to prod** (round-trip-verified) and the dismiss/undo cycle was driven end-to-end with a seeded-then-deleted synthetic notification. DF-21a's empty + populated states both confirmed. Run top-to-bottom; each item is step → expected → surface.

## What these blocks do
The notification bell is now the calm cross-module "needs you" feed. DF-21a swapped the side `Sheet` for a **dropdown popover** and dropped the Workspace/Global toggle (current-workspace only). DF-21b adds **dismiss** (an × per card, with 8s Undo) — a dismissed notification leaves the active feed + badge but stays for the DF-21c history modal. Pref-muting is inherited from DF-19f (the provider filters muted types before the bell sees them).

## DF-21a — dropdown form factor
- [ ] **Do:** Click the bell (top-right) — or press the notifications shortcut. → **Expect:** a **dropdown popover** opens *under* the bell (NOT a full-height right-side panel), headed "Notifications" with a "Mark all read" action. There is **no** Workspace/Global toggle. _(web / both)_
- [ ] **Do:** Open the bell with nothing waiting. → **Expect:** a calm empty state — "You're all caught up." + "New mentions and activity will show here." _(web / both)_
- [ ] **Do:** With notifications present, click a card. → **Expect:** it deep-links to the entity (e.g. `/tasks?id=…` selects the task) and the card marks read; the popover closes. _(web)_
- [ ] **Do:** Settings → Preferences → notification toggles → mute a type (e.g. "assigned"). → **Expect:** that type stops appearing in the bell (and drops from the badge); un-muting brings it back. (DF-19f's toggle, honored by the bell.) _(web)_

## DF-21b — dismiss + undo
- [ ] **Do:** Open the bell on a card. → **Expect:** each card shows a small **×** (dismiss) on its right; the unread badge counts unread cards. _(web)_
- [ ] **Do:** Click the **×** on a card. → **Expect:** the card leaves the list immediately, the unread **badge decrements** accordingly, and a neutral toast appears: **"Notification dismissed"** with an **Undo** button (the app's 8s undo grammar). _(web / both)_
- [ ] **Do:** Click **Undo** within 8s. → **Expect:** the card returns to the list in its **prior read/unread state** (an unread card comes back unread + re-counts in the badge). _(web)_
- [ ] **Do:** Dismiss a card and let the toast expire (don't undo). → **Expect:** it stays gone from the active bell; it is NOT deleted — it will appear in the DF-21c "See all" history when that ships. _(web)_
- [ ] **Do:** Clicking the **×** must NOT open the entity. → **Expect:** dismiss only dismisses; the card's deep-link fires only when you click the card body (not the ×). Keyboard: focus the ×, press Enter → dismisses without also navigating. _(web)_

## Regression checks
- [ ] **Do:** "Mark all read" with unread cards. → **Expect:** unread dots clear + badge → 0; cards stay in the list (mark-read ≠ dismiss). _(web)_
- [ ] **Do:** A legacy invite / membership notification (if present). → **Expect:** it still shows; it has **no** × (legacy rows can't be dismissed — they relocate to the DF-21c Invitations area). _(web)_

## Known gaps / not-yet-testable
- **History modal + Invitations area** are DF-21c — a dismissed row currently just disappears from the active feed (it persists in `notification_state.dismissed_at`, ready for the history view).
- **Cross-workspace invites** surface nowhere until DF-21c (current-workspace scope only).
- The populated bell was live-verified with a **synthetic** notification (seeded via SQL, dismissed/undone, then deleted) because the test account has no organic unread notifications and DF-9's generation trigger isn't applied to prod yet.

---
*Convention: [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per branch.*
