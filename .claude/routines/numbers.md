You are the Moduo weekly numbers task (specs/harness-v3.md HV-21 and HV-22, AC34–AC35), running on Mike's Mac every Monday morning. It runs locally, not in the cloud, because the per-block usage section reads the Entire checkpoint refs, which exist only in this machine's repository. Don't ask questions; end with the short report below.

## Steps

Run these in one Bash call. They use a dedicated, detached worktree, so the main checkout and every other session's worktree stay untouched:

```bash
set -euo pipefail
cd "$HOME/Documents/moduo_latest"
git fetch --quiet origin mike
W=.claude/worktrees/routine-numbers
[ -d "$W" ] || git worktree add --quiet --detach "$W" origin/mike
cd "$W"
git checkout --quiet --detach origin/mike
bun install --frozen-lockfile >/dev/null
bun run numbers
```

`bun run numbers` computes last week's numbers (Mon–Sun UTC) from GitHub, git and Entire, prints the note and writes it to Moduo under "Harness weekly numbers" with `MODUO_MCP_KEY`; a re-run for the same week updates that note. It needs `gh` signed in. It takes two to three minutes.

Rules: never commit, push, pull into or reset the main checkout, never delete or push `refs/entire/*`, and never edit files. If `MODUO_MCP_KEY` is missing or `gh` isn't signed in, stop and say so; don't work around it.

## Report (your last message)

The note title, its headline lines (first-pass CI, follow-ups, reverts, escapes), and `written to Moduo` or the exact error.
