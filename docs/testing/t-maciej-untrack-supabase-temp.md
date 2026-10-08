# Manual test checklist — stop tracking `supabase/.temp/`

> Generated 2026-10-08 · branch `t/maciej/untrack-supabase-temp` · **Live-verified:** yes, in the branch's worktree, with a read-only `supabase functions list`: once with a stale cache (it rewrote `cli-latest`) and once with the folder deleted, as a pull leaves it (it rebuilt both files). `git status` stayed clean both times.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Before you pull (once per checkout)
- [ ] **Do:** `git status --short supabase/.temp` → **Expect:** nothing. If it shows ` M supabase/.temp/cli-latest`, run `git checkout -- supabase/.temp/cli-latest` first, or the pull stops with "Your local changes to the following files would be overwritten" _(terminal)_

## After the pull
- [ ] **Do:** `git ls-files supabase/.temp` → **Expect:** no output _(terminal)_
- [ ] **Do:** `git check-ignore -v supabase/.temp/cli-latest` → **Expect:** a line naming `.gitignore` and the `supabase/.temp/` rule _(terminal)_
- [ ] **Do:** from the repo root, `supabase functions list --project-ref wtoonrvuqumihpkbvwvs`, then `git status --short` → **Expect:** the function list, and no changes. The pull deleted the two cached files; the CLI writes them back on its own and git ignores them _(terminal)_

## Known gaps / not-yet-testable
- `develop`, `mike` and branches cut before this lands still track both files until they take this commit, so the dirty `cli-latest` can still show up there.
