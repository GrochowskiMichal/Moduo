# How AI agents use task systems via MCP and APIs (October 2026): research for Moduo Tasks

> Raw research report, 2026-10-09, kept for its sources. The synthesis and the open calls are in [../RESEARCH-2026-10.md](../RESEARCH-2026-10.md). Nothing here is decided.

Researched 2026-10-09. Confidence: **H** = official docs, changelogs or observed tool schemas · **M** = one official source plus secondary sources, or my own inference from strong precedent · **L** = search snippets or aggregators only.

---

## 0. Moduo's current MCP task surface (origin/maciej, `supabase/functions/moduo-mcp/modules/tasks.ts`)

The 23 task tools on `maciej` as of 2026-10-09:

- **Reads (View):** `tasks_list_buckets`, `tasks_list` (bucket/status/`assignee: me|anyone`/`top_level`; `limit` ≤200 + `offset`), `tasks_focus_settings`, `tasks_queue`, `tasks_today` (alias), `tasks_drift`, `tasks_list_tags`, `tasks_search` (substring over title and description, ≤100), `tasks_get` (edges, subtasks, recent trail), `tasks_attachments_list`, `tasks_activity`, `tasks_list_assignees`.
- **Writes (Edit, intent ops only):** `tasks_queue_add/remove/reorder`, `tasks_commit/uncommit/skip_today` (legacy aliases), `tasks_set_status` (todo/in_progress/done/archived; the server runs the recurrence port), `tasks_reschedule`, `tasks_unschedule`, `tasks_assign` (uuid, `"me"` or null), `tasks_skip_occurrence`.
- **Task tools in other modules:** `comments_add` (Links module; `entity_type` + uuid + `mentioned_user_ids`), `links_*`, and Calendar's `calendar_schedule_task/move_block/complete_block/roll_forward`.
- **How the server is built** (`index.ts`, `docs/moduo-mcp-connector.md`):
  - Transport: hand-rolled Streamable HTTP, one stateless POST, no SSE. Protocol versions up to **2025-06-18**. `tools` is the only capability, with `listChanged:false`.
  - Results: JSON stringified into a text block. No `outputSchema` or `structuredContent`, and **no tool annotations**.
  - IDs: every argument is a **UUID** ("Task uuid.").
  - Auth and scopes: Bearer `moduo_sk_…` keys, with OAuth deferred. Scopes are none/view/edit per module and are capped live by the creator's permissions. A key acts as its creator and owns the rows it creates.
  - Attribution: writes are logged as `actor_type 'api_key'` plus the key's name, and comments carry `author_kind 'api_key'`. An `agent` actor type is CHECK-reserved but unused.
- **Gaps that block agent workflows:**
  - No way to create a task (capture), edit title/description/priority/energy/estimate/tags/due, create subtasks, or edit dependencies. The doc says these are "not ops yet".
  - No In flight or hand-off tools.
  - No human-readable handle.
  - Search is substring only.

---

## 1. Agents as first-class task actors

| Product | Agent identity | Assign vs delegate | How progress shows | Human gate / accountability | Guardrails | Conf |
|---|---|---|---|---|---|---|
| **Linear** | App user installed with OAuth `actor=app`, using the app's name and icon. Can't sign in or reach admin; not billed as a seat. Scopes `app:assignable` / `app:mentionable` ([agents](https://linear.app/developers/agents.md), [docs](https://linear.app/docs/agents-in-linear)) | "Issues can only be assigned to humans, and only delegated to agents": a separate **Delegate** field, so "humans maintain ownership" ([agents](https://linear.app/developers/agents.md); [changelog 2025-07-30](https://linear.app/changelog/2025-07-30-agent-interaction-guidelines-and-sdk)) | **AgentSession** states `pending/active/error/awaitingInput/complete/stale`. **Activities** `thought/action/elicitation/response/error`; thought/action can be *ephemeral*. Session **plan** checklist; `externalUrls` (PR, dashboard). Agent must acknowledge within 10 s; a session goes stale after 30 min of silence ([interaction](https://linear.app/developers/agent-interaction.md), [best practices](https://linear.app/developers/agent-best-practices)) | AIG: disclose that it's an agent; give "immediate, but unobtrusive" feedback; show internal state; stop at once when asked; "final responsibility should always remain with a human" ([AIG](https://linear.app/developers/aig.md)) | Team-scoped install. Workspace and team "guidance" markdown | H |
| **GitHub Copilot cloud agent** (renamed from "coding agent") | Bot user "Copilot" in Assignees | Assignment. Commits are authored by Copilot, **co-authored by the person who asked**, signed, and each links to the session log ([risks](https://docs.github.com/en/copilot/concepts/agents/cloud-agent/risks-and-mitigations)) | 👀 reaction → "Copilot has started work" timeline event → draft PR. Session logs and an Agents tab. When done it **adds you as reviewer**, which is the one notification ([how-to](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/cloud-agent/use-cloud-agent-on-github)) | A human must review and merge; the requester can't approve their own PR; Actions need approval | Only users with write access can trigger it. Comments from non-writers are never shown to the agent. Hidden characters are filtered. Pushes to one branch only; firewall | H |
| **Jira + Rovo** (Apr 27 2026) | Agents appear in the assignee picker: Rovo plus third parties (Copilot, Figma) ([announcement](https://jirareleases.atlassian.com/announcements/put-ai-teammates-to-work-right-inside-jira)) | Assign, @mention, workflow transition, or board column | "Agents" section on the work item | Output is **private to the person who triggered it** until they "Publish" or "Draft comment" ([docs](https://support.atlassian.com/jira-software-cloud/docs/collaborate-on-work-items-with-ai-agents/)) | "Operate inside Jira's existing permissions… and audit trails" | H |
| **Asana AI Teammates** (beta Sept 2025) | Agent actor with a gid; typeahead `type=agent`. API is early access as of May 28 2026 ([forum](https://forum.asana.com/t/upcoming-ai-teammates-and-agent-api-support/1142767)) | The `assignee` field accepts agent gids | Posts comments and creates subtasks; "checkpoints" | Checkpoints for oversight ([press](https://asana.com/nl/press/releases/pr/asana-announces-new-ai-teammates-collaborative-agents-that-deliver-results)) | Answers only from what *both* the triggering user and the agent can see; it can't elevate itself (help page returned 403; this comes from a search snippet) | M |
| **Notion** (3.0, Sept 2025; Custom Agents) | Personal Agent plus Custom Agents running on triggers or schedules ([3.0](https://notion.com/releases/2025-09-18)) | Triggers, not assignment | Its MCP exposes `spawn-session`/`get-session-status`/`wait-session` and `get-async-task` polling (seen in the tool schemas) | — | "Follow your instructions and permissions" | M |
| **ClickUp Super Agents** (Feb 2026) | Named agent "teammates" ([clickup.com/ai](https://clickup.com/ai)) | Assign, DM, @mention | — | — | — | L–M |
| **monday** (Agent Factory, Sept 2025; MCP, Mar 2026) | Connected agents get their own identity and can be assigned or @mentioned. Both fetches failed, so this comes from search summaries only | | | | | L |
| **Height** | Pivoted to an "autonomous" AI "Copilot", then **shut down Sept 24 2025** ([AlternativeTo](https://alternativeto.net/news/2025/3/height-project-management-tool-to-shut-down-by-september-2025/)). The reasons weren't disclosed; claims of an "AI 2.0 backlash" come only from aggregators | | | | | L |
| **Beads** (agent-native tracker) | — | `bd update --claim` sets the assignee and in_progress **atomically**. `bd ready` lists unblocked work. Hash IDs `bd-a1b2` avoid collisions between agents ([README](https://github.com/steveyegge/beads)) | | | | H |

**Patterns across these products:**

1. The products that thought hardest about it (Linear, GitHub, Jira) keep a **named human accountable** and record the agent as a separate role: a delegate, a co-author, or the person who triggered it.
2. Progress goes to a **dedicated session/activity surface**, not the comment thread.
3. Each makes **exactly one loud moment**: GitHub's review request, Jira's Publish, Linear's `response`.

---

## 2. Official MCP servers for task tools

| Server | How tasks are identified | Design notes | Conf |
|---|---|---|---|
| **Linear** `mcp.linear.app/mcp` (+ `/mcp/readonly`), OAuth 2.1 or API key ([docs](https://linear.app/docs/mcp)) | `ENG-123` **or** UUID. The API says the id "can be either the uuid… or the shorthand id like `BLA-123`" ([API](https://linear.app/developers/graphql)) | Read-only endpoint. The tool list isn't published (use `tools/list`) | H |
| **Asana V2** (GA Feb 4 2026) | gid | `get_task(s)`, `create_task`, `update_task`, `search_tasks`, `search_objects`… Tool count cut **by more than half using usage data**; `asana_` prefix dropped; OAuth only ([forum](https://forum.asana.com/t/new-v2-mcp-server-now-generally-available/1122647)) | H |
| **Atlassian Rovo MCP** | Issue ID or **key** | Admin-togglable permission groups `read/write/search/delete/manage`; **delete and manage are off by default**. `transitionJiraIssue`, `addOrEditJiraIssueComment` ([tools](https://support.atlassian.com/atlassian-rovo-mcp-server/docs/supported-tools/)) | H |
| **GitHub** | owner/repo/number | Consolidated `issue_read(method)`/`issue_write(method)`; cursor pagination; `--read-only`. The `X-MCP-Tools` header loads individual tools (**60–90% less context**). Lockdown mode; sanitization on by default ([repo](https://github.com/github/github-mcp-server), [changelog](https://github.blog/changelog/2025-12-10-the-github-mcp-server-adds-support-for-tool-specific-configuration-and-more)) | H |
| **Notion** | URL **or** UUID | `update-page` refuses to delete child content until the user confirms `allow_deleting_content`. Large writes return a pollable async `task_id` (from the schemas) | H |
| **Todoist** `ai.todoist.net/mcp` | Opaque IDs; `fetch` takes `"task:{id}"` | "A small set of tools that enable complete workflows" ([repo](https://github.com/Doist/todoist-ai)). Batch `add-tasks` (≤25) and `complete-tasks(ids[])`. `manage-assignments` has `dryRun` and atomic rollback. **`reschedule-tasks` keeps recurrence; `update-tasks` wipes it.** `responsibleUser` takes "me", a name or an email. Cursor pagination; Markdown `get-overview`; widgets; OpenAI-style `search`/`fetch` (from the schemas) | H |
| **ClickUp** `mcp.clickup.com` | — | Search, create/update task, comment with mentions, time entries ([blog](https://clickup.com/blog/how-to-use-clickup-mcp-server/)) | M |
| **Plane** `mcp.plane.so` | Name, identifier or ID, resolved to UUIDs server-side (third-party guide) | — | L |

---

## 3. MCP and agent-tool design practices

1. **Shape tools around workflows, and consolidate.** Anthropic: `schedule_event` rather than `list_users` + `list_events` + `create_event` ([Anthropic, Sept 11 2025](https://www.anthropic.com/engineering/writing-tools-for-agents)). Asana halved its tools using usage data; GitHub folds read variants into a `method` parameter.
2. **Return fields with meaning, not opaque IDs.** "Eschew low-level technical identifiers (e.g. `uuid`…)". Add a `response_format: concise|detailed` enum, so the default output is short while the IDs needed for follow-up calls stay available.
3. **Keep outputs token-efficient.** Paginate, filter and truncate with sensible defaults, and have truncation notices steer the agent toward narrower queries. Claude Code caps tool results at 25k tokens (Anthropic).
4. **Make errors actionable.** Return validation failures as tool execution errors (`isError`) so the model can correct itself (2025-11-25, SEP-1303). Moduo's scope errors already say how to fix them.
5. **Add annotations** (`readOnlyHint/destructiveHint/idempotentHint/openWorldHint`):
   - Anthropic recommends them, and **OpenAI requires all three hints, with justifications, at app submission** ([OpenAI](https://developers.openai.com/plugins/plan/tools)).
   - The spec says clients must treat annotations as untrusted hints ([2025-06-18 tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)).
   - OpenAI adds: "Annotations do not replace server-side authorization…"
6. **Use `outputSchema` + `structuredContent`, with JSON also in a text block** for older clients (2025-06-18). Typed clients and MCP Apps widgets rely on this.
7. **Keep writes intent-shaped and split by risk.** Todoist's reschedule-vs-update split is exactly the bug Moduo's intent ops already prevent. OpenAI: split tools when "permissions, safety risks, or confirmation requirements" differ. Destructive operations should fail closed until the user confirms (Notion).
8. **Support batches and dry runs** for bulk changes (Todoist).
9. **Use server `instructions`** to steer tool choice (Todoist's are extensive; Moduo's only list scopes).
10. **Follow the spec's direction (2026-07-28, [changelog](https://modelcontextprotocol.io/specification/2026-07-28/changelog)):**
    - The core is now **stateless**, which Moduo's design already is.
    - `server/discover` replaces `initialize`.
    - Clients **SHOULD send `clientInfo` with every request**, which would give Moduo a free attribution label.
    - **MRTR** (`resultType:"input_required"` + retry) replaces server-initiated elicitation and sampling ([MRTR](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr)).
    - `tools/list` should be returned in a deterministic order.
    - **Tasks** and **Apps** are now extensions. Roots, Sampling and Logging are **deprecated**.
11. **Treat extension support as uneven.** [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview) runs in Claude web/desktop, ChatGPT, Cursor and VS Code (Claude Code isn't listed). The **Tasks extension isn't in the [client matrix](https://modelcontextprotocol.io/extensions/client-matrix.md) at all**, so adoption is low.
12. **Allow trimming.** Linear has a read-only endpoint; GitHub has per-tool selection.

### Do human-readable IDs (TB-001) help LLMs?

- **Direction: yes (H).** Anthropic: "merely resolving arbitrary alphanumeric UUIDs to more semantically meaningful and interpretable language (or even a 0-indexed ID scheme) significantly improves Claude's precision in retrieval tasks by reducing hallucinations."
- **Practitioners agree:**
  - A UUID costs roughly 10–23 tokens depending on the tokenizer; a short handle costs about 2–4.
  - Errors include "swapping two characters, mixing up two IDs, or hallucinating one", and they grow with the number of UUIDs in context ([Dexter](https://engineering.getdexter.co/2026/03/10/short-ids-for-llms/), [Verma](https://dev.to/nikhilverma/llms-as-unreliable-narrators-dealing-with-uuid-hallucination-151e)).
  - I found **no controlled public benchmark** of `PROJ-123` vs UUID, so treat the size of the effect as **M**.
- **Precedent:**
  - Linear, Jira, GitHub and Plane all accept short keys, and Linear accepts both forms.
  - Handles let PRs link themselves: Linear links from the branch name, PR title, or "Fixes ENG-123", and moves the issue to In Progress or Done ([Linear GitHub](https://linear.app/docs/github)). That matters for In flight.
- **The design choice the founder hasn't seen:**
  - **Prefix keys that belong to a container change when the item moves.** In Linear, moving an issue to another team gives it a new identifier. Old URLs redirect, but inline references keep showing the old ID ([Linear move](https://linear.app/docs/move-to-new-team)).
  - Moduo buckets are exclusive and tasks move between them, so **don't prefix handles by bucket.**
  - A **workspace-wide, immutable sequence** (GitHub-style) never changes.
  - Beads chose hash IDs because several writers create items concurrently. Moduo has a single Postgres, so a per-workspace counter is fine but **must increment atomically**.
- **Security (H):** handles are guessable, so they must never grant access. The spec says servers "MUST NOT treat possession of a state handle as authentication" ([security BP](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices.md)). Moduo already checks reach on every call.

---

## 4. Patterns in agent workflows

- **Picking up work:** a ready-work query (Beads `bd ready`: open with no blockers) plus an **atomic claim** that sets the owner and in-progress together. Linear's agents move the issue to the first "started" status on delegation.
- **Progress:**
  - Use activities rather than comments, because comments can be edited and are unreliable for reconstructing what happened (Linear best practices).
  - Transient "thinking" lines replace each other (ephemeral).
  - Show one external link (PR or session) and an optional plan checklist.
- **Two different kinds of "needs input":**
  - **Synchronous, inside one tool call:** elicitation (server-initiated in 2025-06-18; MRTR in 2026-07-28). Only MRTR fits Moduo's single-POST, stateless server.
  - **Persistent, visible to humans:** Linear's `awaitingInput` session state plus an `elicitation` activity; the Tasks extension's `input_required`. This is the product state In flight needs ("agent is blocked on a question").
- **Hand-back:** GitHub requests your review; Jira's output stays private until Publish; Linear ends on a `response` activity and `complete`.
- **Stopping:** honour a stop signal immediately and never resume without permission (AIG).
- **Keeping noise down:** "immediate, but unobtrusive" acknowledgement, ephemeral progress, and **one notification at hand-back or needs-input**. This matches Moduo's quiet-notifications north star.
- **The constraint specific to Moduo (M, my inference):**
  - Under MCP-only, Moduo **cannot push** work to a user's Claude or ChatGPT. Linear's model relies on webhooks to an agent *server*.
  - So "delegate to an agent" in Moduo means one of:
    - (a) the user tells their agent "take TB-142", and the agent claims it through MCP; or
    - (b) a scheduled or looping agent (Claude routines, Cursor background agents) polls a ready queue.
  - Either way, **the agent itself must be able to write** In flight status, links and heartbeats. Check-back timers stay Moduo's job.

---

## 5. Security and trust

- **Scoping:**
  - Moduo's per-module none/view/edit, capped by the creator, already matches or beats most competitors.
  - Missing compared with them: a *container* scope (Linear installs are team-scoped), **delete as a separate level that's off by default** (Atlassian), read-only presets or endpoints (Linear, GitHub), and the spec's scope minimisation (see [security BP](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices.md)).
- **Audit:**
  - Linear renders app actions as "**User (via Application)**", with optional `createAsUser` and `displayIconUrl` ([actor auth](https://linear.app/developers/oauth-actor-authorization)).
  - GitHub uses co-authorship plus a link to the session log in each commit.
  - Moduo records the key's name but not *which client* used it.
- **Undo:** I found **no documented "undo everything this agent did" feature** in any competitor (evidence is thin). Moduo's attributed trail plus `deleted_batch_id` is a primitive Moduo could build that on.
- **Prompt injection (H):**
  - **Invariant / GitHub MCP:** a malicious public issue hijacked an agent into leaking private-repo data into a public PR ([Invariant](https://invariantlabs.ai/blog/mcp-github-vulnerability)).
  - **Supabase MCP:** the agent ran with `service_role`. Text in a support ticket made it read `integration_tokens` and **write them back into the ticket thread**, where the attacker could read them ([General Analysis](https://www.generalanalysis.com/blog/supabase-mcp-blog)).
  - Simon Willison's "lethal trifecta": private data + untrusted content + a way to send data out ([Willison](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/)).
  - GitHub's mitigations: strip invisible Unicode and HTML comments, lockdown mode by author trust, and gate on write access.
- **Cross-tenant bug, not injection:** Asana's MCP leaked data between organisations for about a month in 2025, affecting ~1,000 customers ([BleepingComputer](https://bleepingcomputer.com/news/security/asana-warns-mcp-ai-feature-exposed-customer-data-to-other-orgs/)). Lesson for any connector: workspace isolation deserves a structural test, not only per-query care.
- **Hardening to plan for (general, not a finding):**
  - Treat any text that came from outside the workspace (email bodies turned into tasks, imported content, future guest comments) as untrusted when it's returned to an agent, and label where it came from.
  - The Supabase case shows that *writing into a surface someone outside can read* is a way out for data. Treat agent writes to anything outsiders can see as sensitive, and keep the connector free of open-world tools.

---

## 6. Personal-productivity use cases: used or hyped?

- **What has shipped:**
  - Todoist MCP: `find-tasks-by-date`, `reschedule-tasks`, `get-productivity-stats`, `analyze-project-health`.
  - Todoist **Ramble**: voice → structured tasks in 40 languages ([Ramble](https://www.todoist.com/ramble)).
  - Notion: meeting notes can trigger Custom Agents (July 31 2026; from a release-list snippet, M).
  - Anthropic's productivity plugin: `/update --comprehensive` scans email, calendar and chat, flags overdue items and syncs trackers ([plugin](https://github.com/anthropics/knowledge-work-plugins/tree/main/productivity)).
- **Evidence of real use is thin (M):**
  - HN comments mostly come from people *building* integrations: Claude Desktop ↔ Todoist, meeting transcripts → Todoist "so commitments don't get lost", morning briefings. They aren't reports of using it for months. Reddit couldn't be reached.
  - Goblin Tools' HN thread (346 points, 234 comments, Mar 2025) is mixed. It helps beat activation energy ("blank page effect"), but people report over-granular or hallucinated steps, vague prompts that fail, and wild time estimates ([HN](https://news.ycombinator.com/item?id=43461375)).
- **My read:**
  - The most concretely used flows are **capture** (meeting notes, email, voice → tasks) and **morning sync / plan my day**.
  - Breaking a task down helps when the result is short, editable and optional.
  - AI estimates should be shown as suggestions, never stored as fact.

---

## 7. Recommended agent capabilities for Moduo Tasks

**R1. Add capture and edit ops for agents (H).**
- What: `tasks_capture` (batch of up to about 25, lands in **Inbox**, optional parent); `tasks_update` for title, description, priority, energy, estimate, tags and due; subtask create; dependency add/remove; and `tasks_comment` taking a handle.
- Why: without these, triage, meeting notes → tasks, and breaking work down are impossible today.
- It also fixes a scope gap: `comments_add` lives in Links at Edit, so **a key with Tasks = Edit but Links = None can't comment on a task at all**. A `tasks_comment` on the Tasks module removes that dependency.
- Precedent: Todoist `add-tasks`, Asana `create_task`/`update_task`, GitHub `issue_write`.

**R2. Human-readable handles (H on direction, M on effect size).**
- Shape: workspace-wide, immutable sequence, **not bucket-prefixed**, with an atomic counter.
- Zero-padding is cosmetic. Linear and GitHub don't pad; if Moduo keeps it, never fix the width (TB-1000 must still work).
- In tools: every `task_id` argument accepts the handle **or** the UUID. Results lead with `handle` + `title`.
- Order matters. Today every cross-module tool that takes a task accepts only a UUID: `comments_add(entity_id)`, `links_create`, `calendar_schedule_task`, `notes_link`, `email_link`, `contacts_link`, all through `assertReach`.
  1. **First** resolve handles in the shared reach/argument layer, so every `task_id`/`entity_id` across modules accepts `TB-142`.
  2. **Only then** drop the UUID from concise output. Until step 1 lands, keep the UUID in concise results, because the agent needs it for the next call (Anthropic's `response_format` point).
- For people: handles work as mentions in comments, notes and chat, and in PR titles for future auto-linking.
- Never treat a handle as authorization.
- Sources: Anthropic, Linear API and move behaviour, the MCP security best practices.

**R3. The agent is a delegate; a human stays the assignee (H).**
- Keep `assignee_id` human-only.
- An In flight record carries "with <agent>": the key id plus the client label.
- This matches what Moduo already does (a key acts as its creator and owns what it creates).
- Sources: Linear's delegate model, GitHub co-authorship, the AIG accountability principle.

**R4. Make In flight an agent-writable session (M–H).**
- States: `working / needs input / ready for review / failed / stopped`.
- Fields: `external_urls` (PR, agent session), `last_activity_at` heartbeat (stale after about 30 min, as Linear does), `check_back_at`.
- Tools: `tasks_handoff` (claim and mark in flight, atomically), `tasks_flight_update`, `tasks_flight_resolve`.
- Today `focus_in_flight` is tied to a Focus run and a user, so letting agents write it is a **product decision to make**.

**R5. "Needs input" as a persistent state first (H); synchronous confirmation later (M).**
- Show the agent's question on the card and in the trail, with a reply that the agent reads on its next poll.
- Add MRTR or elicitation once Moduo supports 2026-07-28.
- Don't build on the MCP Tasks extension yet: no client in the matrix supports it.

**R6. Agent activity belongs in the trail, not in comment spam (H).**
- Progress goes in collapsible trail entries; transient lines replace each other.
- One notification only at **ready for review**, **needs input** or **failed**.
- Agent @mentions go through the quiet-notification rules.
- Sources: Linear activities and AIG, GitHub's single review request, Jira's private-until-Publish.

**R7. Attribution: "Claude for Maciej" (M).**
- Store the key name and the creator now; users already name keys after their client ("Claude Desktop").
- After Moduo moves to 2026-07-28, also store `clientInfo.name`. Clients only SHOULD send it, so some won't, and it's self-reported, so treat it as a label, not identity. Under 2025-06-18, `clientInfo` arrives only in `initialize`, which a stateless single-POST server never links to `tools/call`.
- Render it in Linear's "via" style.
- Use the CHECK-reserved `agent` actor type only when Moduo has in-app agents; for MCP, keep `api_key` plus the client label.

**R8. Scoped keys, version 2 (H for annotations, M for the rest).**
- Read-only preset.
- **Optional bucket allow-list.**
- A separate **destructive** level (archive, delete, trash), off by default.
- Expiry, plus a per-key "last used" and activity view.
- Add tool **annotations** so clients ask before destructive calls.

**R9. Undo by key or session (L–M; no competitor precedent).**
- Each agent write batch gets a batch id. Offer "Undo Claude's changes from the last N min", replaying inverse intent ops and `deleted_batch_id`.

**R10. Prompt-injection hygiene (H).**
- Label where each piece of returned text came from (member, guest, external email sender, agent).
- Strip invisible Unicode and HTML comments.
- Server instructions state that task text is data, not instructions.
- Keep the connector free of open-world tools.
- Treat writes to guest-visible surfaces as sensitive.
- Add a structural test that every connector read filters `workspaceId` (the Asana lesson).

**R11. Tool hygiene (H).**
- `outputSchema` + `structuredContent`; concise output by default.
- Cursor pagination; deterministic tool order.
- A `tasks_ready` tool: open, unblocked, mine or in my queue.
- Search that matches handles and is better than substring search.
- Richer server instructions, in the style of Todoist's.

**R12. Personal-productivity prompts, then an optional widget (M).**
- Ship MCP **prompts** for "Plan my day" (tasks + calendar + queue), "Weekly review" (drift, done, stale), and "Break this down" (3–7 editable subtasks; estimates labelled as suggestions).
- An MCP Apps queue widget can come later, since Claude, ChatGPT and Cursor render it.

**Evidence gaps:** Linear's MCP tool list isn't published; monday and ClickUp details are thin; there's no benchmark for the size of the handle effect; there's no usage data for AI daily planning.
