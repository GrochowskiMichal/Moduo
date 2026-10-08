# Manual test checklist — Contacts hub "calm card" reorganization

> Generated 2026-07-02 · branch `claude/upbeat-morse-d9e772` · **Live-verified:** yes — all checks below were confirmed on the hosted test workspace (web dev server, dark+Geist and light+mono, seeded demo contacts) except where noted under Known gaps.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Contact page (view mode)
- [ ] **Do:** open Contacts → click a rich contact (test data: Jane Cooper) → **Expect:** header shows avatar · name · "Head of Product · 🏢 Acme Corp · ● Active" (status pill now lives in the header line, not mid-page) _(both)_
- [ ] **Do:** look below the action row → **Expect:** all fields (emails / phone / URLs / address / birthday / note) sit inside **one bordered card** with hairline dividers between groups and a type icon on each group's first row — no more floating label pile _(both)_
- [ ] **Do:** hover an email / phone / URL value → **Expect:** underline; click acts (mailto / tel / opens site). URLs display without `https://` _(both)_
- [ ] **Do:** check the birthday row → **Expect:** humanized date ("April 17, 1988"), cake icon on the dates group _(both)_
- [ ] **Do:** check the note row → **Expect:** the one-line scratch note is inside the card (pen icon), wraps if long — no longer looks like UI caption text _(both)_
- [ ] **Do:** look for "Change company" in view mode → **Expect:** gone. The company is the header chip (click → opens the company) _(both)_
- [ ] **Do:** check "Open work" rows → **Expect:** relation captions are quiet sentence case ("Follow-up"); rows whose relation is plain "References" show **no** caption; the "Other → Acme Corp · WORKS AT" row that duplicated the header company is gone _(both)_
- [ ] **Do:** click ⋯ in the header → **Expect:** menu with "Share as vCard…" and a destructive "Delete contact" (the old bottom-of-page delete button and header share icon are gone) _(both)_
- [ ] **Do:** ⋯ → Share as vCard → **Expect:** a `.vcf` downloads, same as before _(web)_
- [ ] **Do:** star / unstar in the header → **Expect:** favorite toggles, directory Favorites section updates _(both)_

## Contact page (edit mode)
- [ ] **Do:** pencil → **Expect:** same inline form as before, plus a new **Company** field (button showing the current company) under Title/Status → picking a company links + sets it immediately _(both)_
- [ ] **Do:** edit a value → Done → **Expect:** card updates in place; Cancel discards _(both)_
- [ ] **Do:** in dark mode, open the birthday date input → **Expect:** the native date control renders dark (was light-on-dark before the `color-scheme` fix) _(both)_

## Company page
- [ ] **Do:** Companies tab → Acme Corp → **Expect:** details card shows **website (clickable, protocol-less) · domains · note** — the note used to be invisible outside edit mode _(both)_
- [ ] **Do:** click a person under People → **Expect:** navigates to that contact, unchanged _(both)_

## Activity / scrolling
- [ ] **Do:** open a contact with >6 activity rows → **Expect:** trail caps at 6 with "Show all (N)"; expanding shows the rest; switching contacts collapses again _(both)_
- [ ] **Do:** scroll a long contact page in dark mode → **Expect:** thin dark scrollbar at the pane edge — the **white scrollbar strip is gone** _(both)_

## Edge cases
- [ ] **Do:** open a sparse contact (test data: Kasia Wiśniewska — email+phone only) → **Expect:** small card with just those two groups; "Nothing linked yet" teaching empty state; no stray separators _(both)_
- [ ] **Do:** open a contact with no details at all → **Expect:** no empty card frame renders (header + actions + last-touch only) _(both)_
- [ ] **Do:** switch appearance (light/dark, mono/Geist, sharp/round) → **Expect:** the card, dividers, pills and captions follow tokens in every combination _(both)_

## Round 2 (designer feedback, 2026-07-02)
- [ ] **Do:** open any contact → **Expect:** linked work shows **fixed sections in order: Tasks · Notes · Emails · Events · Payments** — empty ones render a quiet one-liner ("Fills automatically when Email syncs." etc.), never disappear; cross-links to people/companies fall under **Other** (only when non-empty) _(both)_
- [ ] **Do:** open a company → **Expect:** the same fixed sections under People (read-only) _(both)_
- [ ] **Do:** view + edit a contact and a company → **Expect:** **no "note" row and no Note edit field anywhere** — attaching a Notes-module note (the "+ Note" action) is the only note concept; old inline notes are hidden, not deleted _(both)_
- [ ] **Do:** edit → Custom fields → Add field → open the type select → **Expect:** text / number / url only — **no "date"** (dates belong to the Dates section) _(both)_
- [ ] **Do:** look at the directory list → **Expect:** status dots form an aligned column at the row's outer edge; the favorite star sits **inside** the dot, hover-revealed (filled + always visible on favorites) _(both)_

## FX-1 — deep links + URL selection + palette (2026-07-02)
- [ ] **Do:** open a contact → **Expect:** URL becomes `/contacts?type=contact&id=…`; reload keeps the same contact; browser back returns to the previous selection _(web)_
- [ ] **Do:** on a contact, click the header company chip → **Expect:** the company page opens, URL says `type=company`, and the directory switches to the Companies tab with the row highlighted _(both)_
- [ ] **Do:** click a linked task row (e.g. "Water plants" on Acme) → **Expect:** navigates to /tasks (page-level; in-page task selection is a Tasks follow-up) _(both)_
- [ ] **Do:** on the dashboard, click a "Recently linked" / "Needs attention" row → **Expect:** it now actually navigates (these were dispatching into the void before) _(both)_
- [ ] **Do:** ⌘K from any page → **Expect:** "Open Contacts", "New contact", "Import contacts" entries; "New contact" from /tasks lands on /contacts with the dialog open and a clean URL _(both)_
- [ ] **Do:** open `/contacts?type=contact&id=00000000-0000-0000-0000-000000000000` → **Expect:** after ~2s, a quiet "That contact no longer exists" toast and the URL clears to /contacts _(web)_
- [ ] **Do:** create a new contact via the modal → **Expect:** it opens selected (URL carries its id) with no false "no longer exists" toast _(both)_

## FX-2 — tags on contacts & companies (2026-07-02)
- [ ] **Do:** open a contact → header shows a tag row under the subtitle ("Add tag" when empty) → **Expect:** the picker lists the same workspace tags Tasks uses (#deep-work etc.) _(both)_
- [ ] **Do:** create a tag from the picker ("Create #…") → **Expect:** chip appears immediately (auto-colored), survives reload; the same tag is now offered in the Tasks tag picker too _(both)_
- [ ] **Do:** × a chip → **Expect:** it detaches from this contact only — the tag still exists in the workspace pool _(both)_
- [ ] **Do:** tag a company (e.g. Acme) → **Expect:** same behavior on the company header _(both)_
- [ ] **Do:** switch quickly between two contacts → **Expect:** no flash of the previous contact's tags _(both)_
- [ ] Cleanup note: test data left a `#client` tag on Jane Cooper + Acme Corp — remove if unwanted.

## FX-3 — directory power (2026-07-02)
- [ ] **Do:** look at the segmented control → **Expect:** "People 11 · Companies 3"-style counts _(both)_
- [ ] **Do:** search "acme" on People → **Expect:** everyone at Acme matches (company name is searched now, plus title/phones/all emails) _(both)_
- [ ] **Do:** Status ▾ → Active → **Expect:** list narrows; trigger shows "● Active"; "No status" option matches only status-less contacts _(both)_
- [ ] **Do:** Tag ▾ → #client → **Expect:** combined with status, narrows further (Jane only in test data); tag/untag a contact on its card while the filter is active → the list updates by itself _(both)_
- [ ] **Do:** click the sort icon → **Expect:** flat "Recent" list (no letter headers, favorites still pinned, freshest first); click again → A–Z returns _(both)_
- [ ] **Do:** click into search, ↓ ↓ Enter → **Expect:** highlight walks the rows and Enter opens the highlighted one; `/` refocuses search; Enter on a focused star/button still does its own thing _(both)_
- [ ] **Do:** rows with title + company → **Expect:** secondary reads "Head of Product · Acme Corp" _(both)_

## Regression sweep
- [ ] **Do:** Tasks → open a task detail → **Expect:** the right-rail links section (when a task has links) is unchanged — compact uppercase relation tags still there (only the contacts *page* variant got the quiet captions) _(both)_
- [ ] **Do:** app-wide sanity in dark mode → **Expect:** native scrollbars everywhere now render dark (the `color-scheme` token change is global — spot-check Notes/Email if anything looks off) _(both)_

## Migrations / data
- No schema changes. `tokens.css` gained `color-scheme` in both theme blocks (system-wide, intentional).
- Demo data was seeded into the hosted test workspace (3 companies, 10 people, links to existing tasks) — left in place for your pass.

## Known gaps / not-yet-testable
- Desktop (Tauri) build not exercised — web dev server only; the changes are pure web-layer so risk is low.
- The suggestion strip ("Link to …?") styling was left as the spine ships it — flagged as a possible follow-up, not changed.
- Drag-onto-hub linking still unwired (pre-existing CT-3 deferral, unrelated to this pass).

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
