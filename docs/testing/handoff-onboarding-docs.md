# Manual test checklist — handoff onboarding docs

> Generated 2026-07-11 · branch `claude/project-progress-summary-830fba` · **Live-verified:** partial — content cross-checked against source docs + the code graph; **HTML render not verified in-environment** (the preview sandbox binds to another worktree and hung). The artifact renders on claude.ai.

This was a **docs-only session** — no product code, schema, or migrations changed. Checks below are "does the handoff read correctly and render."

## Onboarding handoff (docs/onboarding/)
- [ ] **Do:** Open `docs/onboarding/HANDOFF.md` → **Expect:** reads top-to-bottom; read-first order, the 8-wave delta, module table, frontend, backend (incl. the code-graph subsection), decisions, gotchas, and the future backlog are all present and internally consistent _(any)_
- [ ] **Do:** Open `docs/onboarding/backend-refactor-memo.md` → **Expect:** the A/B/C/D decomposition, the §4-justified vs §5-not bar, the plpgsql-vs-MCP crux, and the 5 questions for Mike read as even-handed (not a veto) _(any)_
- [ ] **Do:** Double-click `docs/onboarding/handoff-overview.html` to open in a browser → **Expect:** a quiet **monochrome** page (no pink); module grid, since-you-left timeline, two-runtime diagram, code-graph backend bars, A/B/C/D, backlog, and "start here" all render without layout breaks _(any browser)_
- [ ] **Do:** Toggle dark ↔ light (OS or the page's theme) → **Expect:** both themes legible; tokens flip cleanly _(any browser)_
- [ ] **Do:** In HANDOFF.md, click the internal links (architecture.md, data-layers.md, BUILD_ORDER.md, backend-refactor-memo.md) → **Expect:** all resolve within the repo _(GitHub or editor)_

## Stale-doc fixes
- [ ] **Do:** Open `docs/data-layers.md` → **Expect:** the **⚠ STATUS UPDATE (2026-07-11, refreshed 2026-08-14)** banner near the top corrects the stale status (43 migrations, 7+ modules cloud-first, spine built) and points to `specs/BUILD_ORDER.md` as the status of record _(any)_
- [ ] **Do:** Open `docs/ROADMAP.md` §B item 5 → **Expect:** now reads **✅ RESOLVED → central `entities` registry** (the stale "lean trigger-based" line is corrected) _(any)_
- [ ] **Do:** Open `specs/contacts-v2.md` header → **Expect:** Status reads **Done** (superseded by `contacts-v3-fixpack.md`), not "In progress" _(any)_

## Known gaps / not-yet-testable
- **HTML render not verified in-environment** — the preview sandbox hung (worktree binding). Eyeball the artifact at `claude.ai/code/artifact/ca17f8c6-0f9f-4177-957b-edcaea2eceed` (or open the local file) for spacing/theme.
- The **Graphify code-graph** is a point-in-time snapshot (commit `5e487582`). Regenerate if the code moves: `graphify extract . --code-only` (local, no API). The 35 SQL migrations don't parse (graphify's SQL grammar is nascent) — the schema is enumerated in HANDOFF.md instead.
