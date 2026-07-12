# Manual test checklist — DF-7 Rollup snippets + company parity

> Generated 2026-07-12 · branch `t/maciej/df-7-rollup-snippets` · **Live-verified:** yes (hosted "Claude Test S2" account — contact + company hubs, task + event snippets, both last-touch lines, graceful degradation). Note snippets unit-tested only (no linked note in the test workspace); email is desktop-only.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Contact hub — row snippets
- [ ] **Do:** Open Contacts → a person with linked tasks (e.g. **Jane Cooper**) → **Expect:** each task row shows a status snippet after the name — "Untagged filter-test task **· To do**", "Session 8 ops probe **· To do**" — not just the bare name. _(both)_
- [ ] **Do:** Link (or find) a task that is **in progress** to a contact → **Expect:** its row reads "**· In progress**"; a task with a **due date** reads "**· <status> · due <today/tomorrow/Fri/Jul 18>**". _(both)_
- [ ] **Do:** Confirm the contact's **last-touch line** still renders under the action row ("Last touch: linked/updated … · N open tasks") → **Expect:** unchanged from before (no regression). _(both)_

## Contact hub — note / event snippets
- [ ] **Do:** Attach a **note** to a contact (Note button / Link) → **Expect:** the note row reads "**· Edited <N> days ago**" (a "Pinned"/"Archived" prefix if applicable), not a bare name. _(both — note: needs a linked note; none existed in the test workspace)_
- [ ] **Do:** Link an **event** to a contact/company → **Expect:** the event row reads its "when" — "**· Tomorrow, 2:00 PM**" / "**· Yesterday, 2:00 PM**" / an all-day event drops the time ("**· Tomorrow**"). _(both — verified live on Bluebird Ventures: "DF-23 notes mention probe · Yesterday, 2:00 PM")_

## Company hub — last-touch line (NEW) + union snippets
- [ ] **Do:** Open Contacts → **Companies** tab → a company (e.g. **Acme Corp**) → **Expect:** a **"Last touch: linked … ago"** line now renders under the action row (parity with the contact card — the company card previously had none). _(both)_
- [ ] **Do:** On the same company, look at the **Tasks** union → **Expect:** each linked task shows its status snippet, including tasks inherited from people ("… **· To do · via Jane Cooper**") and the company's own ("Verify cloud consolidation end-to-end **· In progress**"). _(both)_
- [ ] **Do:** Open a brand-new company with no links/activity → **Expect:** the last-touch line reads **"No activity yet"** (never an error tone). _(both)_

## Edge cases
- [ ] **Do:** A hub row whose target entity was **deleted** but the link/registry linger (deleted-but-not-tombstoned) → **Expect:** the row shows the entity's **name with NO snippet** (graceful degradation — no stale/misleading status), not a crash or a "Deleted" dim. _(both — verified live: a soft-deleted "Water plants" task)_
- [ ] **Do:** A **tombstoned** target (registry `deleted_at` set) → **Expect:** the row reads "Deleted task/note/…" dimmed, with **no snippet**. _(both)_
- [ ] **Do:** Open a contact/company hub while **offline / a module read fails** (e.g. Calendar unavailable) → **Expect:** the hub still renders its links and last-touch; only the affected module's snippets are absent (degrades per-module, never walls the whole hub). _(both)_
- [ ] **Do:** Open a task/note detail panel's right-rail EntityHub (the generic rail, not the contact/company hub) → **Expect:** unchanged from before DF-7 — rows show names without snippets (no regression; only the contact/company hubs enrich). _(both)_

## Migrations / data
- [ ] **Do:** — → **Expect:** **No migration.** DF-7 is client-only — the `entities` registry is untouched; snippets are a projection over existing live module reads. Nothing to apply/verify server-side. _(n/a)_

## Known gaps / not-yet-testable
- **Note snippets** are unit-tested (`snippet-format.test.ts`) but were **not live-shown** — the "Claude Test S2" workspace has no contact/company with a linked note. To confirm live: attach a note to a contact and verify the "Edited … ago" caption.
- **Email snippets** are intentionally unpopulated on **web** (email is desktop-only; no cheap cloud batch read). An email row shows its subject (the registry label) with no body-preview snippet. A desktop follow-up can register email meta the same way.
- **Recurring events** show the **series anchor** `startsAt` (first occurrence), not the next occurrence — an accepted limit of the cheap batch read. One-off events (the common contact link) are exact.
- Screenshots in this session's live-verify were low-contrast (plum/dark theme + high-DPI clipping); verification was done via frame-independent DOM reads (authoritative), consistent with the worktree live-verify recipe.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
