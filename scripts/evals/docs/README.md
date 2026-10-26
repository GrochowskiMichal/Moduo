# Docs eval

46 questions agents really asked about Moduo's docs (the 23 Oct transcript study), answered by an agent with grep in a clone of the repo and graded without a model (specs/harness-v3.md, HV-13, AC32). It guards the knowledge diet: a change that compiles, splits or deletes docs must score at least the baseline, or the missing fact goes back before merge.

```bash
bun run eval:docs                       # the 46 questions at the baseline commit, compared with baseline.json
bun run eval:docs --base HEAD           # the same questions against this branch's docs (the after run)
bun run eval:docs --tasks E02,E17       # some questions only
bun run eval:docs score .harness-ab/results/<batch>-docs.jsonl [--regrade] [--record]
bun run eval:docs sync [--check]        # regenerate scripts/harness-ab/tasks/docs/ after editing questions.jsonl
```

A run goes through the A/B rig (`scripts/harness-ab/`, set `docs`, arm `docs`: Opus at medium effort, one repeat, no MCP, no verify). One question costs about $0.30 and about a minute; the whole set about $13 and 45 minutes (the baseline run).

## Files

- `questions.jsonl`: one question per line (type `Question` in `grade.ts`): the question, where the answer lives at the base commit, a gold answer, and the key: `must` (groups of patterns; the answer matches one pattern of every group) and `stale` (patterns only an outdated answer contains). Traps carry a `staleAnswer`, abstain items `abstain: true`.
- `grade.ts`: the key applied to one answer. The rig writes the agent's final message to the workspace and runs `grade.ts <id>` from this checkout, so the agent never sees the key; tasks also `hide` this folder, for bases that contain it.
  On a `--base` that contains this folder, the key is still in git history (`git log -p`); the rows' `agent.tools` show if a run went there.
- `run.ts`: generates the rig's task set, runs it, scores the batch and compares it with `baseline.json`.
- `baseline.json`: the recorded score, per question, with its base commit, arm and batch.

## The questions

Kinds: how 24, why 13, id 5, status 4 (the study's mix, give or take the replacements). They include supersession traps (an older decision is still in the repo next to the one that replaced it, e.g. E02, E15, E17, E33, E39), one abstain item (E25: the docs don't say, and the answer must say so) and the stale-vocabulary item E30. `note` says where a question differs from the 23 Oct draft (the build log and the ledger are gone, so E39, E40 and E42 were replaced).

Keys are about facts, not file names, so they survive a gotcha moving into a rule. When a knowledge change makes a key wrong (the fact itself changed), fix the key and its gold answer in the same PR, run `bun run eval:docs sync`, and say so in the PR; `docs-eval.test.ts` checks every gold answer passes its key and every stale answer fails it.

## Reading a result

`score` prints the pass share, the questions missed, and against the baseline the questions lost and gained. One repeat is noisy: a question can flip on wording. When the score drops, re-run the lost questions with `--tasks` and read their answers (`agent.result` in the results row, the transcript in `.harness-ab/runs/<runId>/`) before calling it a regression. A miss can also be the key's fault: an answer that quotes the outdated line to say it is outdated still matches a `stale` pattern. Keep `stale` patterns to assertions, fix a key that fails a right answer, and apply it to the batch's stored answers with `score <file> --regrade` instead of re-running the agents. Re-record the baseline (`score … --record`) only after a deliberate change to the questions, the keys or the arm.
