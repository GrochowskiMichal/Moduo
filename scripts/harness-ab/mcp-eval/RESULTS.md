# MCP agent-experience eval: results

AC38 (specs/harness-v3.md, HV-29): 15 user tasks × 5 runs against the Moduo connector (`moduo-mcp` at this branch), on the eval's own local stack. How it runs and what each number means: [README.md](./README.md). Raw rows: [results/](./results/).

## 2026-10-27, Sonnet 5.5 (the run AC38 asks for)

`bun run mcp-eval run --repeats 5` · model `sonnet` (`claude-sonnet-5-5`), default effort, 3 in parallel · 75 runs in 3 minutes · $1.17 at list price.

| task | pass | errors | calls/run | wrong-tool rate | tool-error rate | tokens/run | output tokens/run | cost/run | time/run |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 01-task-with-due | 5/5 | 0 | 1.0 | 0% | 0% | 58k | 166 | $0.012 | 6s |
| 02-complete-task | 5/5 | 0 | 2.0 | 0% | 0% | 88k | 174 | $0.016 | 6s |
| 03-queue-question | 5/5 | 0 | 1.0 | 0% | 0% | 58k | 70 | $0.011 | 6s |
| 04-project-with-tasks | 5/5 | 0 | 4.8 | 0% | 0% | 112k | 500 | $0.025 | 9s |
| 05-move-task-to-project | 5/5 | 0 | 3.0 | 0% | 0% | 88k | 250 | $0.018 | 7s |
| 06-note-create | 5/5 | 0 | 1.0 | 0% | 0% | 58k | 169 | $0.010 | 7s |
| 07-note-append | 5/5 | 0 | 2.6 | 0% | 0% | 105k | 267 | $0.017 | 9s |
| 08-note-question | 5/5 | 0 | 2.0 | 0% | 0% | 58k | 159 | $0.011 | 6s |
| 09-link-note-to-task | 5/5 | 0 | 3.0 | 0% | 0% | 88k | 315 | $0.018 | 7s |
| 10-contact-create | 5/5 | 0 | 3.6 | 22% | 0% | 106k | 442 | $0.020 | 9s |
| 11-calendar-event | 5/5 | 0 | 1.0 | 0% | 0% | 58k | 261 | $0.012 | 7s |
| 12-schedule-task-block | 5/5 | 0 | 2.0 | 0% | 0% | 88k | 350 | $0.018 | 7s |
| 13-chat-post | 5/5 | 0 | 1.0 | 0% | 0% | 58k | 119 | $0.010 | 5s |
| 14-push-due-date | 5/5 | 0 | 4.0 | 0% | 0% | 117k | 317 | $0.021 | 9s |
| 15-task-comment | 5/5 | 0 | 2.0 | 0% | 0% | 88k | 195 | $0.015 | 9s |
| **all** | 75/75 | 0 | 2.3 | 2% | 0% | 82k | 250 | $0.016 | 7s |

Failures:
- none

Wrong-tool calls in passing runs:
- `20261026-232925-10-contact-create-r1`: contacts_import
- `20261026-232925-10-contact-create-r2`: contacts_import
- `20261026-232925-10-contact-create-r4`: contacts_import
- `20261026-232925-10-contact-create-r5`: contacts_import

## 2026-10-27, Haiku 5.5 (a weaker agent, to see whether the eval discriminates)

`bun run mcp-eval run --repeats 5 --model haiku` · `claude-haiku-5-5` · 75 runs in 3 minutes · $0.10 at list price.

| task | pass | errors | calls/run | wrong-tool rate | tool-error rate | tokens/run | output tokens/run | cost/run | time/run |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 01-task-with-due | 5/5 | 0 | 1.0 | 0% | 0% | 58k | 185 | $0.003 | 6s |
| 02-complete-task | 5/5 | 0 | 2.0 | 0% | 0% | 88k | 174 | $0.001 | 10s |
| 03-queue-question | 5/5 | 0 | 1.0 | 0% | 0% | 58k | 60 | $0.001 | 5s |
| 04-project-with-tasks | 5/5 | 0 | 4.0 | 0% | 0% | 89k | 481 | $0.002 | 7s |
| 05-move-task-to-project | 5/5 | 0 | 3.0 | 0% | 0% | 88k | 259 | $0.001 | 8s |
| 06-note-create | 5/5 | 0 | 1.0 | 0% | 0% | 58k | 155 | $0.001 | 4s |
| 07-note-append | 5/5 | 0 | 3.0 | 0% | 0% | 117k | 331 | $0.002 | 7s |
| 08-note-question | 5/5 | 0 | 2.0 | 0% | 0% | 58k | 194 | $0.001 | 5s |
| 09-link-note-to-task | 5/5 | 0 | 3.0 | 0% | 0% | 88k | 346 | $0.001 | 6s |
| 10-contact-create | 5/5 | 0 | 2.4 | 0% | 0% | 88k | 458 | $0.001 | 6s |
| 11-calendar-event | 5/5 | 0 | 1.0 | 0% | 0% | 59k | 375 | $0.001 | 5s |
| 12-schedule-task-block | 5/5 | 0 | 3.6 | 17% | 22% | 113k | 703 | $0.002 | 8s |
| 13-chat-post | 5/5 | 0 | 1.2 | 0% | 0% | 64k | 119 | $0.001 | 4s |
| 14-push-due-date | 5/5 | 0 | 4.0 | 0% | 0% | 118k | 405 | $0.002 | 7s |
| 15-task-comment | 5/5 | 0 | 2.0 | 0% | 0% | 88k | 205 | $0.001 | 6s |
| **all** | 75/75 | 0 | 2.3 | 2% | 2% | 82k | 297 | $0.001 | 6s |

Failures:
- none

Wrong-tool calls in passing runs:
- `20261026-233241-12-schedule-task-block-r2`: tasks_schedule_task
- `20261026-233241-12-schedule-task-block-r3`: tasks_schedule_task_placeholder
- `20261026-233241-12-schedule-task-block-r4`: tasks_work_session_remove

## What it says

1. **Every everyday task succeeds, on both models: 150/150.** Success alone is at its ceiling with this set, so it can't rank a connector change yet. Wrong-tool and tool-error rates are what moved. The next tasks should be harder: several steps across modules, ambiguous references ("the contract task" when there are two), and tasks that should be refused.
2. **Adding a contact with a company makes the agent reach for `contacts_import` (Sonnet 4 of 5).** `contacts_create` takes only a `company_id`, so for "Jane Cooper from Northwind" the agent finds no Northwind and uses the bulk import, the one tool that creates a company by name. It works, but a bulk importer is the wrong tool for one person. A `company` (name) argument on `contacts_create` would remove the detour.
3. **Scheduling a task block has no duration (Haiku 3 of 5).** `calendar_schedule_task` takes only `scheduled_at`, so "block two hours" took a second call. Haiku also invented tool names (`tasks_schedule_task`, `tasks_schedule_task_placeholder`, both errors) and in one run added a work session, then removed it. Sonnet went straight to `tasks_work_session_add` (start and end) every time. A `duration_minutes` on `calendar_schedule_task` would cover it.
4. **Context cost is the tool list, not the work.** Each run reads ~29k tokens of definitions for 101 tools before the first call (58k tokens for a one-call task), and Claude Code loaded them all up front (no tool search in any run). Output was 250 tokens a run. Fewer or shorter tool descriptions would cut every conversation's cost.
5. **The deprecated `tasks_today` was never picked.** For "what's next in my queue" every run used `tasks_queue`.

## Running it again

`bun run mcp-eval up`, `check-tasks`, `run --repeats 5`, `report <file> --out …`, `down` (README.md). Compare a connector change by running both batches on the same stack and putting the two reports side by side.
