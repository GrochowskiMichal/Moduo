# Manual test checklist — DOC-1: doc reconcile

> Generated 2026-08-14 · branch `claude/doc-staleness-audit-wave-d-99c4d9` · **Live-verified:** partial — `handoff-overview.html` was rendered and inspected in a real browser (layout, link targets, copy); everything else is prose whose *facts* were cross-checked against `specs/BUILD_ORDER.md`, the tree, and `docs/reviews/ops-2-schema-reconciliation.md`. A skeptical-senior validator pass ran over the whole diff (5 MAJOR + 12 MINOR/NIT, all fixed).
> **Docs-only — zero source changes.** Nothing in the app's behavior can regress from this branch; the risk here is a *wrong fact*, so the checks below are read-and-compare, not click-through.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## The headline — is the handoff honest now?

- [ ] **Do:** Open `docs/onboarding/handoff-overview.html` in a browser, scroll to **"What's left before alpha"** → **Expect:** five cards — *DF wave — done (23 of 24)* · *DF — still open (1 block)* · *Wave D — dogfood & alpha (in progress)* · *Pre-alpha gates* · *Post-alpha / open*. **No card says "Ready now — 14 blocks" or "Blocked on a sibling — 3 blocks".** _(any browser)_
- [ ] **Do:** On the same page, check the eyebrow at the top and the footer line → **Expect:** both read "written 2026-07-11 · reconciled 2026-08-14", and the footer states `specs/BUILD_ORDER.md` is the status of record. _(any)_
- [ ] **Do:** Toggle dark ↔ light on that page → **Expect:** the new/edited cards are legible in both; no card overflows or scrolls sideways. _(any)_
- [ ] **Do:** Open [`docs/onboarding/HANDOFF.md`](./onboarding/HANDOFF.md) §10 → **Expect:** it opens with "**The DF wave is done — 23 of 24**", lists **DF-15** as the single open DF block, and has a **Wave D** section. The old "Pre-alpha, ready now (DF wave)" list of 14 shipped blocks is gone. _(any)_
- [ ] **Do:** Read HANDOFF §5's Settings and Mindmap rows → **Expect:** Settings is "Shipped" with the DF-19 overhaul named (no "overhaul pending"); Mindmap says **out of alpha** and that **MCP-1 no longer waits on it**. _(any)_

## Authority — can a fresh session tell which doc to trust?

- [ ] **Do:** Open [`docs/ROADMAP.md`](./ROADMAP.md) and read the header block → **Expect:** it says plainly that it is the **direction** doc, **not** the status of record, and that where it and `specs/BUILD_ORDER.md` disagree, **the ledger wins**. _(any)_
- [ ] **Do:** Scan ROADMAP's wave list → **Expect:** Waves 0/1/2/3/5 carry ✅ SHIPPED markers with dates; Wave 5 (Email) no longer says "PULLED FORWARD / NEXT build"; there are sections for **Tasks Timeline**, **Wave 6 — Dashboard**, **DF**, and **Wave D**. _(any)_
- [ ] **Do:** Open [`docs/reviews/whole-app-critique-2026-07-plan.md`](./reviews/whole-app-critique-2026-07-plan.md) → **Expect:** a header line saying this file is the DF wave's *spec* and its checkboxes are a mirror of the ledger; **23 ticked, 1 unticked**; DF-15 is the only `[ ]` and is marked ⏳ with its designer gate. _(any)_
- [ ] **Do:** Open any shipped spec header — [`email.md`](../specs/email.md), [`notes.md`](../specs/notes.md), [`calendar.md`](../specs/calendar.md), [`connective-tissue.md`](../specs/connective-tissue.md), [`settings-overhaul.md`](../specs/settings-overhaul.md), [`universal-inbox.md`](../specs/universal-inbox.md) → **Expect:** each reads **Status: Shipped** with its block range + dates, and points at `BUILD_ORDER.md` as the status of record. None still says "Ready" / "DoR-ready" / "Draft". _(any)_

## Migration claims — the part that actually misleads

- [ ] **Do:** Open [`specs/BUILD_ORDER.md`](../specs/BUILD_ORDER.md), read the banner directly under the Legend → **Expect:** it says per-block "deploy-ready but unapplied" notes are **history**, that every repo migration is applied as of OPS-1/OPS-2, **and** that the reconciliation is a name+function-body check only — *"applied" ≠ "audited"*. _(any)_
- [ ] **Do:** Search [`docs/gotchas.md`](./gotchas.md) for `notify_user_ids` → **Expect:** the ⚠️ entry now opens with **✅ RESOLVED** and explains the branch went live 2026-07-27; it no longer asserts "NEVER APPLIED to prod". _(any)_
- [ ] **Do:** Open [`docs/testing/notes-no6-8.md`](./notes-no6-8.md) → **Expect:** a green migration-status banner under the title saying the 17 `[post-deploy]` rows are runnable now and `/notes` is not in degraded mode. _(any)_
- [ ] **Do:** Open [`docs/testing/notes-no9-10.md`](./notes-no9-10.md) → **Expect:** its banner resolves the file's self-contradiction **and** explicitly carves out the `moduo-mcp` redeploy as *still outstanding*. Same carve-out in [`spine-wave0-finish-contacts-hub.md`](./spine-wave0-finish-contacts-hub.md). _(any)_
- [ ] **Do:** Search `docs/` + `specs/` for `DEPLOY-GATED: apply only AFTER` → **Expect:** the one hit (NO-1 in BUILD_ORDER) is immediately followed by "applied to prod — gate satisfied and closed". _(any)_

## Edge cases

- [ ] **Do:** Grep the repo for `35 migrations` → **Expect:** **zero hits** (was 5: data-layers, the backend memo ×3, the HTML). Current count is 43. _(any)_
- [ ] **Do:** Grep for `16 open` and `Ready now` → **Expect:** zero hits outside unrelated prose. _(any)_
- [ ] **Do:** Open [`docs/onboarding/backend-refactor-memo.md`](./onboarding/backend-refactor-memo.md) → **Expect:** all three "re-express N migrations" mentions read **43**, so proposal A's cost isn't understated. _(any)_
- [ ] **Do:** Compare the object/file counts in [`docs/reviews/ops-2-schema-reconciliation.md`](./reviews/ops-2-schema-reconciliation.md) §1 vs §4, and vs `docs/testing/ops-2-schema-reconciliation.md` → **Expect:** §4 and the testing copy both now say which figures were superseded mid-session (42→43 files, 193→195 objects); no bare contradiction. _(any)_
- [ ] **Do:** Open [`specs/import.md`](../specs/import.md) header and §Scope → **Expect:** block ids read **IM-1 … IM-4** (not IM-5), and the task-importer deferral points at **IM-3**, matching its own block table. _(any)_
- [ ] **Do:** In HANDOFF, click through the internal links in §0 and §7 (architecture.md, data-layers.md, BUILD_ORDER.md, backend-refactor-memo.md, ops-2-schema-reconciliation.md) → **Expect:** all resolve inside the repo; §0's data-layers caveat points at **§11**, not §9. _(GitHub or editor)_

## Migrations / data

- [ ] **Do:** Nothing to apply — **this branch adds no migration and changes no schema.** Confirm with `git diff --stat origin/maciej...HEAD -- supabase/` → **Expect:** empty output. _(local)_
- [ ] **Do:** *(optional, proves the docs' central claim)* Run `bun run db:reconcile` and paste its two queries into the Supabase SQL editor → **Expect:** both return **no rows** — i.e. every object the 43 migration files declare exists in prod with no semantic drift, exactly as the new banners state. _(web)_

## Known gaps / not-yet-testable

- **This is prose, so "verified" means cross-checked, not executed.** Every date, block id and count was checked against `specs/BUILD_ORDER.md` and the working tree, and a validator subagent re-derived them independently — but there is no automated guard that keeps these docs honest. They will drift again; the mitigation shipped here is the "last reconciled" date on HANDOFF plus the authority banners, not a test.
- **The `bun run db:reconcile` round-trip was not run this session** (no Supabase MCP connection). The "every migration is applied" claim rests on OPS-1's and OPS-2's own 2026-07-29 probes, which were authed and rolled back. The optional check above is how you'd confirm it independently.
- **~115 lines across `docs/` and `specs/` still contain "unapplied / deploy-gated / post-deploy" wording.** That is deliberate — they are accurate *history* inside completed-block notes, and rewriting them would destroy the audit trail OPS-1/OPS-2 depended on. They are neutralized by banners, not removed. If that judgement call is wrong, the alternative is a mechanical sweep of all ~115.
- **DF-18 landed on `maciej` mid-session**, after this reconcile had already been written against a stale local ref (see the `gh` account gotcha in `docs/gotchas.md` §Git/branching). `maciej` was merged in and ~10 claims corrected from "22 of 24 · DF-15 + DF-18" to "23 of 24 · DF-15". **Worth a skim of the DF counts specifically** — they changed late.
- **Not audited:** `docs/build-log.md`, `docs/improvement-plan.md`, `docs/moduo-tasks-feature-spec.md` and the other Tasks-era docs. They are labelled history in HANDOFF §11 rather than reconciled, on the grounds that nobody should be reading them for status.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
