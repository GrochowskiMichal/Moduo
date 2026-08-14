# Manual test checklist — DF-18 eyebrow / detail-title / toolbar standardization

> Generated 2026-08-14 · branch `t/maciej/df-18-eyebrow-toolbar` · **Live-verified: partial** — every item marked ✅ below was driven on the hosted test account against the local dev server (Contacts, Calendar, Notes, Tasks). Email and the menu/select group labels were **not** reachable there; those are the ones that actually need your eye.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

This block has almost no new behaviour — it is a typography + structure sweep across ~45 files. So the checklist is mostly "does anything look *wrong* now", plus the one genuinely new interaction: **keyboard navigation inside toolbars**.

## Eyebrows (the 11px small-caps section labels)

The one rule: every uppercase label in the app is now 11px, medium weight, muted. Nothing should read at 12px anymore.

- [ ] ✅ **Do:** Open Contacts, look at the A–Z letter headers and ★ FAVORITES in the left rail → **Expect:** small-caps, 11px, muted grey — unchanged from before. _(both)_
- [ ] ✅ **Do:** Open a contact, scan the section headers down the page (PEOPLE, TASKS, NOTES, EMAILS, EVENTS, PAYMENTS, ACTIVITY) → **Expect:** all identical in size/weight/colour. _(both)_
- [ ] ✅ **Do:** Open Notes, look at the sidebar groups (INBOX / WORKSPACE / PUBLISHED / TRASH) → **Expect:** these are **visibly smaller than before** (they were 12px, now 11px) and now match Contacts exactly. This is the intended change. _(both)_
- [ ] ✅ **Do:** Open Calendar, look at CALENDARS in the left rail and the per-account sub-header under it → **Expect:** the account line is the *dimmer* of the two; same size. _(both)_
- [ ] **Do:** Open Settings (⌘,) and walk the nav groups (PERSONAL / WORKSPACE / APP) and the section labels inside Appearance, Preferences, About → **Expect:** all 11px, matching the rest of the app (Settings was one of the 12px offenders). _(both)_
- [ ] **Do:** Open the notification centre (bell) → **Expect:** INVITATIONS / ACTIVITY / OVERDUE headers now match everything else (were 12px). _(both)_
- [ ] **Do:** Open the Focus view (Tasks → Focus tab) → **Expect:** the bucket name, SUBTASKS, ADD TIME, UP NEXT labels look the same as Plan-view labels — they used to be on a different type face. _(both)_

### Kind tags should be *quieter* than section headers
- [ ] ✅ **Do:** Open a task with links, look at the linked-entity rows in the right rail → **Expect:** the small tag at the end of a row (BLOCKS, MENTIONS) is the same size as the section header above it but **lighter weight and dimmer** — it should recede, not compete. _(both)_
- [ ] **Do:** Press ⌘K, type a few letters, look at a result row → **Expect:** the trailing type chip (TASK / NOTE / CONTACT) reads the same quiet way. _(both)_
- [ ] **Do:** In a note, type `@` and look at the picker rows → **Expect:** the "PERSON" tag is quiet in the same way. _(both)_

### Emphasis labels (deliberately louder)
- [ ] **Do:** Sign out, go through email sign-in until the recovery-phrase screen appears → **Expect:** the "12-WORD PHRASE" label is **bolder and more widely tracked** than a normal section header — it is meant to stand out. _(both)_
- [ ] **Do:** Open a note containing an embedded mindmap → **Expect:** the "MINDMAP" badge over the canvas is likewise bold/wide. _(both)_

### ⚠️ Not verified — please eyeball
- [ ] **Do:** Open any `Select` (e.g. Settings → Appearance → a dropdown with grouped options), right-click a task row for the context menu, and open ⌘K → **Expect:** the group headings inside those menus are now the **same size as a Contacts section label** (they used to be a size bigger and slightly different). This is the change most likely to look off. _(both)_
- [ ] **Do:** Open Email, look at the thread-list date groups (TODAY / YESTERDAY), the ACCOUNTS rail header, and the snooze/move popovers → **Expect:** all consistent 11px small-caps. _(desktop — email doesn't render on web)_

## Detail-panel titles

Five different title sizes collapsed to one scale per surface type.

- [ ] ✅ **Do:** Tasks → click a task → look at the title at the top of the right rail → **Expect:** 15px, medium weight, clearly the head of the panel above the 13px field rows. _(both)_
- [ ] ✅ **Do:** Contacts → click a person, then a company → **Expect:** name renders as a large 24px heading, unchanged in size (the typeface role changed underneath, but with one font installed it should look identical). _(both)_
- [ ] ⚠️ **Do:** Calendar → click an event → look at the title under the "EVENT" eyebrow → **Expect:** **slightly larger than before** (14px → 15px) and now matching the task title exactly. _(both)_
- [ ] ⚠️ **Do:** Email → open a thread → look at the subject line at the top of the reader → **Expect:** **noticeably larger than before** (13px → 15px), matching task/event titles. Check a long subject doesn't now wrap to three lines and push the message body down. _(desktop)_

## Toolbars — keyboard navigation (the one real behaviour change)

Control rows are now proper toolbars: **the whole row is a single Tab stop**, and you move between its buttons with ← / →. This is new; before, every button was its own Tab stop.

- [ ] ✅ **Do:** Tasks → Plan view. Press Tab until focus lands in the header row, then press → repeatedly → **Expect:** focus walks Group select → Filter → List → Board → Timeline → New, then wraps. Critically, **you can reach "New"** — you should never get stuck inside the view switcher. _(both)_
- [ ] ✅ **Do:** Same row — press Tab once more from anywhere in it → **Expect:** focus leaves the whole toolbar in one press (it does not step through each button). _(both)_
- [ ] ✅ **Do:** Calendar → Tab into the toolbar, press → → **Expect:** ‹ → › → Today → the Day/Week switcher. _(both)_
- [ ] ✅ **Do:** Contacts left rail → Tab into the People/Companies row, press → → **Expect:** People → Companies → Import → New contact. Then Tab into the Status/Tag row and press → → **Expect:** Status → Tag → sort toggle, wrapping. _(both)_
- [ ] ✅ **Do:** With focus on a Contacts *toolbar* button, press ↓ → **Expect:** **nothing happens** — the contact list highlight underneath must NOT move. (It did before this block.) _(both)_
- [ ] **Do:** Notes sidebar → Tab into the header row → **Expect:** one stop; → moves between Import and New note. The two buttons are also slightly larger than before (they're proper icon buttons now). _(both)_
- [ ] **Do:** Any toolbar — press Home and End → **Expect:** jump to first / last control in the row. _(both)_

## Toolbars — visual

- [ ] ✅ **Do:** Calendar toolbar → **Expect:** unchanged spacing — ‹› tight together, then Today, the date range, and the Day/Week switcher pinned right. _(both)_
- [ ] ✅ **Do:** Contacts left rail, both control rows → **Expect:** unchanged spacing; nothing wraps or overflows at the rail's default width. _(both)_
- [ ] **Do:** Drag the Contacts rail as narrow as it goes → **Expect:** the People/Companies row still fits without the two icon buttons falling off. _(both)_
- [ ] **Do:** Notes sidebar header → **Expect:** "Notes" left, Import + New note right, vertically centred; the slightly taller buttons shouldn't have thrown the header rhythm off. _(both)_
- [ ] **Do:** Switch density (Settings → Appearance → Layout → Density) to dense and back → **Expect:** every migrated toolbar's controls still line up on one baseline at each density. _(both)_

## Edge cases

- [ ] **Do:** Open Notes as a **viewer** (a workspace where you can't edit), or with editing disabled → **Expect:** the sidebar header shows just "Notes" with no buttons and no leftover empty space where they were. _(both)_
- [ ] **Do:** Contacts → switch to the Companies tab → **Expect:** the toolbar's second row loses the Status filter; arrow navigation still works across what remains. _(both)_
- [ ] **Do:** Resize the window narrow enough to trigger the mobile/sheet layout, open Contacts → **Expect:** the directory sheet's toolbars behave the same (one Tab stop, arrows work). _(web)_
- [ ] **Do:** Turn on reduced motion (System Settings) and re-check a toolbar → **Expect:** no change in behaviour; nothing animates that didn't before. _(both)_

## Migrations / data

- [ ] None. This block is presentation-only — no schema, no edge functions, no stored data touched.

## Known gaps / not-yet-testable

- **Email surfaces** (thread list, reader, rail, snooze/move popovers, connect dialog) — email doesn't render on the web dev server, so none of the ~9 email eyebrows or the reader subject were seen live. Highest-risk unverified area alongside the menu labels.
- **Select / DropdownMenu / ContextMenu / ⌘K group headings** — the shadcn primitives were re-pointed at the shared recipe, but no surface with a group *label* rendered during verification. Type-checked and unit-tested, not seen.
- **The auth recovery-phrase screen and the embedded-mindmap badge** — both use the new `strong` emphasis tone; neither was rendered live (the test account is already signed in, and no note in it embeds a mindmap).
- **Focus/Execute view labels** — the six `font-display` eyebrows there moved to the body face. Invisible while one font is installed, but unverified.
- **Density interaction** — toolbars were only checked at the default density.
- The dev-server preview repeatedly collapsed the centre pane to zero width; several checks were done by reading the DOM rather than by eye. Anything above marked ✅ was confirmed by measured values (font sizes, weights, focus order), not screenshots alone.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
