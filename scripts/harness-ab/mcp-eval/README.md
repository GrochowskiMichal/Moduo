# MCP agent-experience eval

How well does a Claude agent get everyday things done through the Moduo connector? 15 user tasks, each run N times by an agent whose **only** tools are the connector's (specs/harness-v3.md, HV-29, AC38). Results: [RESULTS.md](./RESULTS.md).

```bash
bun run mcp-eval up                          # start the eval's own Supabase stack (≈1 min)
bun run mcp-eval check-tasks                 # no model: each oracle fails on the seeded workspace, passes after the reference
bun run mcp-eval run --repeats 5             # the full 15 × 5 (sonnet by default; --model, --effort, --tasks, --parallel 3, --max-turns 20)
bun run mcp-eval report .harness-ab/results/<batch>-mcp.jsonl --out scripts/harness-ab/mcp-eval/RESULTS.md
bun run mcp-eval down                        # stop and delete the eval stack
```

A full 15 × 5 takes about 3 minutes at 3 in parallel. On Sonnet 5.5 it cost $1.17 at list price (about $0.016 a run), on Haiku 5.5 $0.10. Nearly every token is the connector's ~29k tokens of tool definitions, read from the prompt cache after the first run.

## Where it runs: its own stack, never the shared one

The rig refuses the shared local Supabase stack (ports 54320–54329), and that stays. The eval brings up a **second stack** instead (`stack.ts`): a copy of `supabase/` in the temp folder with `project_id = "moduo-mcp-eval"` and every port moved up by 1000 (API 55321, DB 55322), started by the Supabase CLI without Studio, Mailpit, analytics or the pooler, and built from the same prod schema snapshot as the shared stack (`scripts/local/stack.sh isolated <url>`, which refuses the shared ports and never dumps prod). `down` stops only that project (`supabase stop --workdir` on a workdir whose `project_id` it checks first) and deletes its volumes and workdir.

The one exception added to `safety.ts` is `refuseMcpTarget`: the only MCP server a run may get is `http://127.0.0.1:<port>/functions/v1/moduo-mcp` on a port outside the shared stack's. Production, hosted Supabase and the shared stack are refused there too (tests in `mcp-eval.test.ts`).

## One run

1. **A fresh account.** A new person, their workspace (the app's own triggers seed the Inbox, roles and statuses) and a Moduo key with Edit on Tasks, Notes, Calendar, Contacts, Chat and Links, written by SQL on the eval stack only. The person's email goes into `founder_emails` there so every module is open (Chat needs Duo or up), and their time zone is this machine's, so "tomorrow at 10am" means the same thing to the agent, the server and the oracle.
2. **Seed.** The task's `seed` makes what the prompt talks about (a note to append to, a task to complete) through the connector itself.
3. **Agent.** `claude -p` in an empty temp folder with `--strict-mcp-config` and the eval connector as its only server (named `moduo`, as in a person's setup), `--tools ""` (no shell, no files, no web), `--allowedTools mcp__moduo`, a short assistant system prompt (date, time zone, "they are not available for follow-up questions"), `--max-turns 20` and the rig's scrubbed environment. No sandbox is needed because the agent has nothing but the connector.
4. **Oracle.** The task's `check` reads the result back through the connector (and the agent's final answer, for questions) and returns why it failed, or nothing.

## The numbers

- **Success:** the oracle passed. `error` means the run didn't happen (no stream, an extra MCP server); it isn't counted as a fail.
- **Wrong-tool rate:** wrong calls ÷ all connector calls. A call is wrong when it is a write the task doesn't call for (each task lists its acceptable `writes`) or a tool the connector marks `DEPRECATED`. Reads are never wrong: looking around is fine.
- **Tool-error rate:** connector calls that came back `isError` (bad arguments, a refusal).
- **Tokens:** input + output + cache read + cache write from the final `result` event; cost is Claude Code's list-price figure (on Max it counts against the plan, not a bill).

Rows go to `.harness-ab/results/<batch>-mcp.jsonl` (gitignored), transcripts to `.harness-ab/mcp-runs/<runId>/`. A batch worth keeping is copied next to RESULTS.md.

## Adding a task

Add it to `tasks.ts`: the prompt in the person's words (never a tool name), the `writes` that do the job, an optional `seed`, a `ref` (the calls a good agent makes) and a `check`. Then `bun run mcp-eval check-tasks --tasks <id>` must print `"sound": true`.
