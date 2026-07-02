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
