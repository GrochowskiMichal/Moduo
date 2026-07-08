# Manual test checklist — alpha spine+contacts specs + workflow hardening

> Generated 2026-06-25 · branch `t/maciej/alpha-specs-dor` · **Live-verified:** partial — hook execution, settings JSON, and spec/ledger coherence verified by the agent; a real fresh-session firing of the hook and a live `/execute next` run could not be exercised from inside this session (noted under Known gaps).
> Run top-to-bottom; check off as you go. This was a **planning + tooling** session — no app/source code changed, so there is nothing to click in the product. The checks below confirm the workflow infrastructure behaves.

## SessionStart hook (the one runnable artifact)
- [ ] **Do:** In a worktree whose base is current with `maciej`, start a new Claude Code session (or run `bash .claude/hooks/session-start.sh`). → **Expect:** "## Moduo session preflight" + "✓ Base current with maciej (N ahead, 0 behind)" + the read-list (decisions/gotchas/BUILD_ORDER) + the /execute·/plan·/wrap line. _(both)_
- [ ] **Do:** Start a session on a branch deliberately behind `maciej` (e.g. cut one off an old commit). → **Expect:** "⚠️ STALE BASE — this branch is N commit(s) behind maciej …" with the correct N, advising reconcile-before-edit. _(both)_
- [ ] **Do:** Confirm the hook never blocks. Run it in a repo with no `maciej`/`origin/maciej`. → **Expect:** the "• No 'maciej'/'origin/maciej' base found" line, exit 0, session proceeds. _(both)_
- [ ] **Do:** Inspect `.claude/settings.json`. → **Expect:** valid JSON with `SessionStart`, `Stop`, `Notification` hooks; SessionStart calls `session-start.sh`. _(both)_

## Build-order ledger + /execute auto-select
- [ ] **Do:** In a fresh session on a current base, run `/execute next` (or `/execute` with no target). → **Expect:** it opens `specs/BUILD_ORDER.md`, picks **CT-1** (first unchecked, deps satisfied), states the pick, and only then starts building. _(both)_
- [ ] **Do:** After a block completes via `/execute`, re-open `specs/BUILD_ORDER.md`. → **Expect:** that block's box is ticked (date + branch). _(both)_
- [ ] **Do:** Read `specs/BUILD_ORDER.md` → "Running sessions & parallelism". → **Expect:** the lane table + serialization-points list match the specs' block deps. _(both)_

## Specs pass the Definition-of-Ready gate (doc review)
- [ ] **Do:** Open `specs/connective-tissue.md` and `specs/contacts.md`. → **Expect:** every DoR box checked; Open questions = "(none)"; every AC appears in a "Tests that prove them" row; execution blocks sequenced with deps. _(n/a — doc)_
- [ ] **Do:** Spot-check the briefs the specs reference. → **Expect:** `connective-tissue/BRIEF.md` §7 shows the `entities` registry + `link_suggestion_declines` and §8 Q2 reads "RESOLVED → central entities registry"; `contacts/BRIEF.md` footer links are repo-relative (no `quizzical-faraday` paths). _(n/a — doc)_
- [ ] **Do:** Open `CLAUDE.md` → "Active plan". → **Expect:** it names `specs/BUILD_ORDER.md` as the live execution ledger. _(n/a — doc)_

## Known gaps / not-yet-testable
- The hook's **real fresh-session firing** (vs. running the script by hand) and a **live `/execute next` run** can only be confirmed by actually starting a new session off the merged `maciej` — verified by inspection here, not by execution.
- `bun run verify` was **not run**: this session changed only markdown, one shell hook, and JSON config — no TS/CSS/SQL — so the typecheck/lint/test gate exercises none of it (and `node_modules` is absent in this worktree). The relevant verification was the hook run + JSON validity + spec coverage greps, all done.
- The hardening only protects sessions **once this is merged into `maciej`** (new sessions branch off `maciej`).

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
