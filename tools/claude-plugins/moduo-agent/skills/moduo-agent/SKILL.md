---
name: moduo-agent
description: Track your build work in Moduo through the moduo connector — pick up a block's task (the queue's, in Closed alpha, Open alpha or Beta & later), post status (working · needs_you · ready · failed) with step n of m and the PR link, and hand off to another person as a task comment. GitHub events move the task's stage; you never do. /s2 and /s3 call it; use it directly to report status or hand work over. Every step is skipped quietly when the connector or its key is missing.
---

# moduo-agent: your build work, mirrored in Moduo

You are the person's agent: **MichaśAI** for Mike, **MaciuśAI** for Maciej (`printenv MODUO_AGENT_NAME`). The connector acts as your person, through their API key. Everything here is status, not conversation (product decision 52); you are their delegate, never a member of your own (decision 6). Setup: `docs/agent-setup.md` §Moduo connector.

## Rules that always hold
- **Moduo never blocks the work.** If the `moduo` tools are missing, or a call fails on the key or the network, Moduo is **off** for the rest of the session: skip every step below, never retry, never ask, and say "Moduo: off (<reason>)" once in your report's **Session** line. A refusal on one task (not found, someone else took it) is a 🔎 Found line, not a stop.
- **`moduo` is the dogfood workspace, `moduo-local` is the stack under test.** Track work only through `moduo`; test only through `moduo-local`. Never log your own work into the database you're testing.
- **Pass `agent: "<MODUO_AGENT_NAME>"`** on every `tasks_session_status` (leave it out when the variable is empty: the key is named after you).
- **One report per step, not per tool call.** Each call costs a turn. Each report replaces the last one's note and step, so always resend `step`/`steps`.
- **Keep `.claude/MODUO_TASK` current** (gitignored, one `key=value` a line). The presence hook reads it to post "online" at session start and "idle" at each stop, and stays quiet once `state` isn't `working`. Write it with one `printf … > .claude/MODUO_TASK` whenever you report.
- **Cross-person hand-offs are a comment on the task**, addressed to the person, never an instruction to their agent (see Hand off).
- Read Moduo only through your own key. Never read a teammate's private data another way (AGENTS.md rule 10).

## Is Moduo on?
Load the tools: `ToolSearch` query `+moduo tasks_session_status`. You need `mcp__moduo__tasks_session_status`, `tasks_search`, `tasks_assign`, `tasks_claim`, `tasks_set_status` (subtasks only), plus `tasks_list_assignees`, `comments_add` and `tasks_handoff` for hand-offs (`select:` them in one call). No match → Moduo off ("not connected"). The first call that fails with "Missing, invalid, revoked or expired API key" or a network error → Moduo off ("key rejected" / "unreachable").

## Stages move by themselves
A block task's **status** says where the work is in its life; GitHub events move it, never you (`.github/workflows/moduo-sync.yml`, no model call): a draft PR titled `[<ID>] …` → **Building**, ready for review → **In review**, merged → **Awaiting release**, closed unmerged → **To do** (with a comment), the release tag → **Shipped**. **Backlog**, **To do** and **Won't do** are people's calls. So never `tasks_set_status` a block task; your job is the live report (`tasks_session_status`) and the subtasks. Blocked is not a stage: dependencies are "blocks" edges between block tasks (`bun run queue:import` keeps them), and a wait on a person is `tasks_handoff`.

## Pick up (from /s2 Claim, after the draft PR exists)
1. **Find the block's task by its ID in the title, in any project:** `tasks_search {q: "<ID>"}` (no project filter), keep the live rows whose title starts with the block ID followed by " — " (e.g. `TV-D16 — Agent sessions`), or has it in brackets at the end (`… (TV-D16)`); ignore archived projects. A found task stays in its own project.
2. **None yet → import it:** `bun run queue:import specs/<feature>.md` creates the spec's missing block tasks (tagged `block`, with the spec link and their dependency edges, beside their siblings, else in **Beta & later**); search again. Add a 🔎 Found line "Created <handle> for <ID>". Never create a block task by hand. A block task is an epic: its subtasks are the small todos, so tick the ones you finish (`tasks_set_status {task_id: "<subtask handle>", status: "done"}`) and add new ones with `parent_id` only for real remaining steps.
3. **Take it:**
   - unassigned and routed to a team → `tasks_claim {task_id}`;
   - unassigned, or already yours → `tasks_assign {task_id, assignee_id: "me"}` (skip if already yours);
   - assigned to someone else → don't take it and don't report on it. The draft PR is the claim, so keep building, and add a 🔎 Found line "<handle> is <name>'s in Moduo". Moduo is off for this block.
4. **Report working:** `tasks_session_status {task_id: "<handle>", state: "working", note: "Claimed <ID>", step: 2, steps: 7, links: [{url: "<draft PR url>", label: "Draft PR"}], agent}`. The steps are `/s2`'s seven: 1 Select · 2 Claim · 3 Load context · 4 Build · 5 Verify · 6 Review · 7 Record.
5. **Remember it:** `printf 'task=%s\nstate=working\nstep=2\nsteps=7\n' <handle> > .claude/MODUO_TASK`.

## Checkpoint (at the start of /s2 steps 3–7)
`tasks_session_status {task_id, state: "working", note: "<step name>: <what, under 80 characters>", step: n, steps: 7, agent}` (skip step 6 when the diff isn't Tier 2), then rewrite `.claude/MODUO_TASK` with the new step. Links persist between reports; send them again only when they change.

## Needs you / failed
- A hard blocker or a decision only the person can take → `state: "needs_you"`, the question as the note (at most 280 characters). It notifies them once.
- The block can't be built (verify won't pass, scope is wrong) → `state: "failed"`, the reason as the note.
- Either way, write `state=needs_you` or `state=failed` into `.claude/MODUO_TASK`, so the presence hook leaves the line alone. Reporting `working` again later starts a new run; that is right once you resume.

## Hand back (from /s3, once the PR is ready for review)
`tasks_session_status {task_id, state: "ready", note: "Ready for review · PR #<n>", links: [{url: "<PR url>", label: "PR #<n>"}], summary: "<Changed + Test this from the report, at most 4,000 characters>", agent}`. Marking the PR ready moves the task to In review by itself. Then set `state=ready` in `.claude/MODUO_TASK`.

## Finish (from /s3, after the merge into the personal branch)
`rm -f .claude/MODUO_TASK`. The merge moves the task to Awaiting release and the release tag to Shipped. A block that stays open (built, not landed; blocked) keeps its task open and its last report.

## Hand off to the other person
When work needs the other founder (a review, a design call, a piece in their lane), it goes as a comment on the Moduo task (AGENTS.md §Agent tooling):
1. Find their member id with `tasks_list_assignees`.
2. `comments_add {entity_type: "task", entity_id: "<handle>", body, mentioned_user_ids: ["<their id>"]}`. Write the body to the person: what is done, what you need from them, the PR or branch, and where the context lives. Never write it as an instruction to their agent ("MaciuśAI, do …"), and never message their sessions any other way.
3. If the task now waits on them, `tasks_handoff {task_id, person_id: "<their id>"}`; it clears itself when they comment.
Your own parallel sessions talk through Claude Code's cross-session messages, not Moduo: Moduo carries only what crosses between people.

## Notes
What doesn't belong in git (research scratch, hand-off context too long for a comment) can go in a Moduo note linked to the task. Specs, decisions and gotchas stay in the repo: agents need them versioned and offline.
