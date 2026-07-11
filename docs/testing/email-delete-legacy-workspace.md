# Manual test checklist — email-delete-legacy-workspace

> Generated 2026-07-11 · branch `t/maciej/email-delete-legacy-workspace` · **Live-verified:** partial — `bun run verify` (typecheck + lint + 1010 tests) green on the fresh maciej base; the deletion is non-observable dead code, so the live checks below are regression confirmation, not first-discovery.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.
>
> **What this session did:** deleted the entire dead legacy `email-workspace.tsx` tree (7 files) flagged by the whole-app critique §4.6 / §5-B. The live `/email` page is `EmailPageView` and was **not** touched functionally — only two stale doc-comments that named the deleted components were tidied. Nothing user-facing should change.

## Email — live surface (regression: must be unchanged)
- [ ] **Do:** Open `/email` on desktop with a connected account → **Expect:** rail · thread-list · reader render exactly as before; no console error, no missing-component blank pane _(desktop)_
- [ ] **Do:** Open `/email` on web (no desktop engine) → **Expect:** the calm desktop-gate banner + "Nothing linked yet" empty state, unchanged _(web)_
- [ ] **Do:** Select a thread → read it → convert-to-task → snooze → move → compose _(the full EM-flow)_ → **Expect:** every interaction works as it did pre-deletion _(desktop)_

## Build / tooling (the reason this tree was deleted)
- [ ] **Do:** `bun run verify` → **Expect:** typecheck 0 errors, `lint:tw` clean, `lint:css` clean, all tests green (was 1010/113 files at wrap) _(both)_
- [ ] **Do:** `bun run storybook` and open the email stories group → **Expect:** `email-connect-dialog`, `email-rail`, `email-reader`, `email-thread-list` stories still present; the old `features/email/ui/email-workspace` story is **gone** and its absence causes no error _(both)_
- [ ] **Do:** `grep -rn "EmailWorkspace\|EmailMessageDetail\|EmailConnectionSetup\|EmailAccountSidebar\|EmailComposePanel\|EmailMessageList" src/` → **Expect:** zero hits (all references, including the two stale comments, are gone) _(both)_

## Edge cases
- [ ] **Do:** Touch/edit any file in `src/features/email/ui/` and re-run `lint:tw` → **Expect:** no legacy hex/arbitrary-value violations resurface (the ~120-violation dead tree that would have tripped the gate is gone) _(both)_

## Known gaps / not-yet-testable
- The live `/email` regression checks were **not** driven in a browser this session: the preview harness cannot boot a dev server inside a `.claude/worktrees/*` worktree (`EPERM uv_cwd`; see docs/gotchas.md). Because the change is a pure deletion of code that renders nowhere, a green full-repo typecheck + 1010 passing tests is strong proof the live surface is untouched — but the three live-surface checks above are worth a 30-second confirm pass on desktop.
- Storybook renders nothing in this worktree (dynamic-import failure, see docs/gotchas.md) — the story check above confirms the story set *compiles*, not that each renders; the deleted story simply no longer exists.
