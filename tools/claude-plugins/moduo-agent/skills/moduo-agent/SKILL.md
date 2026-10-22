---
name: moduo-agent
description: Track your build work in Moduo through the moduo connector — pick up a block's task in its milestone project (Closed alpha, Open alpha or Beta & later), post status (working · needs_you · ready · failed) with step n of m and the PR link, complete it on merge, and hand off to another person as a task comment. /s2 and /s3 call it; use it directly to report status or hand work over. Every step is skipped quietly when the connector or its key is missing.
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
Load the tools: `ToolSearch` query `+moduo tasks_session_status`. You need `mcp__moduo__tasks_session_status`, `projects_list`, `tasks_list`, `tasks_search`, `tasks_assign`, `tasks_claim`, `tasks_set_status`, `tasks_create`, plus `tasks_list_assignees`, `comments_add` and `tasks_handoff` for hand-offs (`select:` them in one call). No match → Moduo off ("not connected"). The first call that fails with "Missing, invalid, revoked or expired API key" or a network error → Moduo off ("key rejected" / "unreachable").

## Stages (the task's status, not your live state)
`tasks_session_status` says what you are doing right now. The task's **status** says where the work is in its life. Move it yourself, one `tasks_set_status {task_id, status: "<name>"}` per hop, never skipping ahead:

| Status (category) | Set it when | Who |
| --- | --- | --- |
| **Backlog** (backlog) | captured, not yet specced or planned | people |
| **To do** (to do) | planned and specced, ready to pick up | people, when `/s1` ends |
| **Building** (in progress) | you claim the block (Pick up) | you |
| **In review** (in progress) | the PR is ready for review (Hand back) | you |
| **Awaiting release** (in progress) | merged into the personal branch or `develop`, not yet in a `vX.Y.Z` release (Finish) | you |
| **Shipped** (done) | the release carrying it is tagged; also the only done status, so work that never ships (docs, research, ops) ends here too | `/ship`; you for work that never ships |
| **Won't do** (won't do) | dropped on purpose; say why in a comment | people |

- Forward only. A review that sends the block back to work moves it to **Building** again; say so in the note.
- **Blocked is not a stage:** use the task's blocked flag, `waiting_on` and `tasks_handoff`.
- The stage names live in every milestone project (they carry the same seven statuses). Check `statuses_list {project_id}` of the task's own project once; if a name is missing, set the category word instead (`todo`, `in_progress`, `done`) and carry on. Never create statuses.
- Set **Shipped** yourself only for work that never ships; code waits for `/ship`. Never move a task you don't hold.

## Pick up (from /s2 Claim, after the draft PR exists)
1. **Know the board:** `projects_list`. Work is organised by milestone, not by module: the active projects **Closed alpha**, **Open alpha** and **Beta & later** hold the block tasks (each project's sections are themes such as Security & privacy, Platform & sync, Release & infra, Notes, Tasks, Calendar & scheduling, Email & notifications, Contacts, Chat, Home, Launch ops, Integrations & MCP, Meet, Quality & polish). The project named `Moduo` holds undated bugs and ideas. None of the three milestone projects → Moduo off ("no milestone projects").
2. **Find the block's task by its ID in the title, in any project:** `tasks_search {q: "<ID>"}` (no project filter), keep the live rows whose title starts with the block ID followed by " — " (e.g. `TV-D16 — Agent sessions`), or has it in brackets at the end (`… (TV-D16)`); ignore archived projects. A closed one counts: reopen it below. A found task stays in its own project; never move it between milestones unless the person says so.
3. **None yet → create it:** pick the project from the block's spec and `specs/BUILD_ORDER.md`: gates the closed alpha (2 Nov) → **Closed alpha**; needed for public sign-up (16 Nov) → **Open alpha**; anything else, or when unsure → **Beta & later** (never guess a milestone sooner than the spec says). `tasks_create {title: "<ID> — <block name>", project_id, assignee_id: "me", status: "Building", tags: ["block"]}` in the section for the block's theme (`sections_list {project_id}`; none fits → leave it out), and add a 🔎 Found line "Created <handle> for <ID> in <project>". Blocks enter the ledger in `/s1`; block tasks carry the `block` tag and mirror `specs/BUILD_ORDER.md`, which stays the source of truth for the block's spec. A block task is an epic: its subtasks are the small todos, so tick the ones you finish (`tasks_set_status {task_id: "<subtask handle>", status: "done"}`) and add new ones with `parent_id` only for real remaining steps. Add no other tags.
4. **Take it:**
   - unassigned and routed to a team → `tasks_claim {task_id}`;
   - unassigned, or already yours → `tasks_assign {task_id, assignee_id: "me"}` (skip if already yours);
   - assigned to someone else → don't take it and don't report on it. The draft PR is the claim, so keep building, and add a 🔎 Found line "<handle> is <name>'s in Moduo". Moduo is off for this block.
   Then `tasks_set_status {task_id, status: "Building"}` unless it already is.
5. **Report working:** `tasks_session_status {task_id: "<handle>", state: "working", note: "Claimed <ID>", step: 2, steps: 7, links: [{url: "<draft PR url>", label: "Draft PR"}], agent}`. The steps are `/s2`'s seven: 1 Select · 2 Claim · 3 Load context · 4 Build · 5 Verify · 6 Review · 7 Record.
6. **Remember it:** `printf 'task=%s\nstate=working\nstep=2\nsteps=7\n' <handle> > .claude/MODUO_TASK`.

## Checkpoint (at the start of /s2 steps 3–7)
`tasks_session_status {task_id, state: "working", note: "<step name>: <what, under 80 characters>", step: n, steps: 7, agent}` (skip step 6 when the diff isn't Tier 2), then rewrite `.claude/MODUO_TASK` with the new step. Links persist between reports; send them again only when they change.

## Needs you / failed
- A hard blocker or a decision only the person can take → `state: "needs_you"`, the question as the note (at most 280 characters). It notifies them once.
- The block can't be built (verify won't pass, scope is wrong) → `state: "failed"`, the reason as the note.
- Either way, write `state=needs_you` or `state=failed` into `.claude/MODUO_TASK`, so the presence hook leaves the line alone. Reporting `working` again later starts a new run; that is right once you resume.

## Hand back (from /s3, once the PR is ready for review)
`tasks_session_status {task_id, state: "ready", note: "Ready for review · PR #<n>", links: [{url: "<PR url>", label: "PR #<n>"}], summary: "<Changed + Test this from the report, at most 4,000 characters>", agent}`. Also `tasks_set_status {task_id, status: "In review"}`. Then set `state=ready` in `.claude/MODUO_TASK`.

## Finish (from /s3, after the merge into the personal branch)
`tasks_set_status {task_id, status: "Awaiting release"}` (a block that never ships, such as docs or ops, goes to `Shipped`), then `rm -f .claude/MODUO_TASK`. `/ship` moves released tasks to `Shipped`. A block that stays open (built, not landed; blocked) keeps its task open and its last state.

## Hand off to the other person
When work needs the other founder (a review, a design call, a piece in their lane), it goes as a comment on the Moduo task (AGENTS.md §Agent tooling):
1. Find their member id with `tasks_list_assignees`.
2. `comments_add {entity_type: "task", entity_id: "<handle>", body, mentioned_user_ids: ["<their id>"]}`. Write the body to the person: what is done, what you need from them, the PR or branch, and where the context lives. Never write it as an instruction to their agent ("MaciuśAI, do …"), and never message their sessions any other way.
3. If the task now waits on them, `tasks_handoff {task_id, person_id: "<their id>"}`; it clears itself when they comment.
Your own parallel sessions talk through Claude Code's cross-session messages, not Moduo: Moduo carries only what crosses between people.

## Notes
What doesn't belong in git (research scratch, hand-off context too long for a comment) can go in a Moduo note linked to the task. Specs, decisions and gotchas stay in the repo: agents need them versioned and offline.
