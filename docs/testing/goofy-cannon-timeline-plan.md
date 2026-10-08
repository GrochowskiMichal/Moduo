# Manual test checklist — Timeline plan + session naming

> Generated 2026-07-02 · branch `claude/goofy-cannon-21b41e` · **Live-verified:** partial — the title hook was pipe-tested and schema-validated, but a real rename only happens on a session resume, which can't be observed from inside the session.

This was a **planning + workflow session** — no app code changed. Two things to confirm:

## Session naming (the new hook)
- [ ] **Do:** restart the Claude Code desktop app (or close and reopen any Moduo session on a branch that has this merge) → **Expect:** this session's title becomes `[Tasks] Timeline view plan` _(desktop app sidebar)_
- [ ] **Do:** start a fresh session off `maciej` and run `/plan <anything>` → **Expect:** after its first reply, the worktree has `.claude/SESSION_TITLE` with a `[Module] …` line; on the session's next resume the sidebar title matches _(desktop app)_
- [ ] **Do:** in any session, run `/execute next` → **Expect:** `.claude/SESSION_TITLE` reads `[Tasks TL-1] Static timeline` (or whichever block it picked) _(desktop app)_
- [ ] **Do:** `git status` in a session that wrote a title → **Expect:** `.claude/SESSION_TITLE` does NOT appear (gitignored) _(both)_

## Timeline spec (paperwork only — nothing runs yet)
- [ ] **Do:** open [specs/tasks-timeline.md](../../specs/tasks-timeline.md) → **Expect:** the fade grammar matches what you approved (solid edge = known date, faded = unknown; no diamonds; bucket swimlanes; bottom tray; light dependency-creation in TL-3)
- [ ] **Do:** open [specs/BUILD_ORDER.md](../../specs/BUILD_ORDER.md) → **Expect:** TL-1 → TL-2 → TL-3 listed as unchecked blocks, so `/execute next` in a fresh session can pick TL-1 up

## Known gaps / not-yet-testable
- The rename itself (hook → sidebar title) fires on session start/resume only — untestable from inside the session that wrote it. The hook script's output was verified by piping a synthetic payload: correct JSON, correct title, silent no-op without the file.
- Existing/parallel sessions won't self-title until their worktree base includes this merge; brand-new sessions show the auto title until their first resume.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
