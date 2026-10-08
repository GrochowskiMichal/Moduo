# Manual test checklist — Edge Function drift check

> Generated 2026-10-08 · branch `t/maciej/edge-function-drift` · **Live-verified:** partial. Everything except the Management API success path (it needs a real token) was run on 2026-10-08. The prod calls only read (`supabase functions list`); nothing was deployed or deleted.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Against prod
- [x] **Do:** `bun run functions:reconcile` (with the Supabase CLI logged in, no `SUPABASE_ACCESS_TOKEN`) → **Expect:** "via the supabase CLI"; orphans: none; in the repo but not deployed: none; known external (3): `stripe-setup`, `stripe-webhook`, `stripe-worker`, each ACTIVE and none marked "NOT THE INTEGRATION'S BUILD"; "Deployed and in the repo: 15"; "OK"; exit code 0. `git status` stays clean (the CLI no longer rewrites `supabase/.temp/cli-latest`) _(terminal; checked 2026-10-08)_
- [ ] **Do:** `SUPABASE_ACCESS_TOKEN=<your sbp_ token> bun run functions:reconcile` → **Expect:** the same report, "via the Management API", exit 0. This is the path CI would use _(terminal; not run: needs a token)_

## Failure paths (no prod access needed)
For the `--fixture` runs, save the JSON from `supabase functions list --project-ref wtoonrvuqumihpkbvwvs -o json` and edit a copy.
- [x] **Do:** add `{"slug": "founders-apply", "status": "ACTIVE", "version": 12}` to the list, then `bun scripts/functions-reconcile.ts --fixture <file>` → **Expect:** `founders-apply` under orphans, a FAIL block whose first step is `git log --all …` and whose last is the `supabase functions delete` command to run by hand, exit 1 _(terminal; checked 2026-10-08)_
- [x] **Do:** same fixture, with `supabase/functions/founders-apply/index.ts` on disk and staged (`git add`, not committed); unstage and delete it afterwards → **Expect:** still an orphan, exit 1. Only folders committed on the branch count _(terminal; checked 2026-10-08)_
- [x] **Do:** in the list, set `stripe-webhook`'s `entrypoint_path` to `file:///tmp/x/source/supabase/functions/stripe-webhook/index.ts` (a CLI deploy from a checkout), then to `file:///tmp/x/source/stripe-webhook/index.ts` (the MCP connector's slug-folder shape) → **Expect:** both times "NOT THE INTEGRATION'S BUILD" on its row, "FAIL: the deployed stripe-webhook does not have the …/source/index.ts entrypoint …", exit 1 _(terminal; checked 2026-10-08)_
- [x] **Do:** check out `origin/main`, which still has `stripe-webhook/`, in a throwaway worktree (`git worktree add --detach <dir> origin/main`), copy `scripts/functions-reconcile.ts` and `src/lib/functions-reconcile-core.ts` into it, run the script there against the unedited list, then `git worktree remove --force <dir>` → **Expect:** "FAIL: supabase/functions/stripe-webhook/ uses the slug of a function installed by the Stripe Sync Engine integration"; `founders-apply`, `sync-subscription` and `trial-extension` under "in the repo but not deployed"; the 11 functions newer than `main` listed as orphans (the branch-relative limit); exit 1 _(terminal; checked 2026-10-08)_
- [x] **Do:** `--fixture` with `[]` → **Expect:** "could not check: the deployed list is empty but the repo has 15 functions …", exit 2 _(terminal; checked 2026-10-08)_
- [x] **Do:** `SUPABASE_ACCESS_TOKEN=$'“not-a-real-token”' bun run functions:reconcile`, and again with a two-line value → **Expect:** "contains spaces, line breaks or non-ASCII characters (a bad paste?), so it was not sent", exit 2, and the value never printed _(terminal; checked 2026-10-08)_
- [x] **Do:** `SUPABASE_ACCESS_TOKEN=not-a-real-token bun run functions:reconcile` → **Expect:** "the Management API answered HTTP 401 …", exit 2 _(terminal; checked 2026-10-08)_
- [x] **Do:** `bun run functions:reconcile --delete` and `--project-ref ../x` → **Expect:** a usage error / "not a Supabase project ref", exit 2 _(terminal; checked 2026-10-08)_

## Tests
- [x] **Do:** `bun run test -- src/lib/functions-reconcile-core.test.ts` → **Expect:** 31 passed, including the repo guard that no committed folder under `supabase/functions/` uses a Sync Engine slug, and four runs of the script itself on fixtures (exit 0, 1 and 2, and a malformed token refused without being printed) _(terminal; checked 2026-10-08)_

## Known gaps / not-yet-testable
- Not in CI yet. Running it there needs a `SUPABASE_ACCESS_TOKEN` secret, and a Supabase personal access token can act on every project that account can reach, so it should come from an account with no more access than this needs.
- Names only: a function deployed from older code than the repo's still counts as in the repo.
- The verdict is relative to the branch you run it on. A function that only a newer branch has shows up as an orphan; the FAIL steps start with `git log --all` for that reason.
- A Sync Engine function replaced by a deploy with `index.ts` at the bundle root (possible through the Management API or the MCP connector) has the same `…/source/index.ts` entrypoint as the integration's own, so the replacement check misses it.
