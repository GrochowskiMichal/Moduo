# Start prompt: the Calls re-plan (huddles + the Google Meet replacement)

Decided 2026-10-14 in the Chat v2 re-plan (CH76: huddles and meetings designed together, on one engine, in a re-plan of Moduo Meet; CH77: Chat reserves five seams, `specs/chat-v2.md` §18; CH78: the hackathon is on site). This is [`docs/agents/module-replan.md`](../../docs/agents/module-replan.md)'s prompt with its four lines filled. **Paste the block below as the first message of a fresh session on Opus 5.5 at high effort**; switch to Fable 5.1 (high) only for the spec step, when the session asks. It can run while Chat v2 builds: planning is read-only and the call blocks touch no Chat file.

```
Plan the rebuild of the Calls module (Moduo Meet re-planned: huddles + the Google Meet replacement), the way Tasks v3 was planned. Follow docs/agents/module-replan.md exactly (it's on the branch t/maciej/tasks-v3-build).

SETUP
- Start your branch from the Tasks v3 integration branch, which holds the north star: git switch -c t/maciej/calls-replan t/maciej/tasks-v3-build.
- Work in LOCAL BUILD MODE: read the 🟠 box at the top of the "Tasks v3" section in specs/BUILD_ORDER.md. Local Supabase is prod; no pushes to maciej/develop and no PRs until Maciej says "release"; backing up your branch to origin is fine.
- Title the session "[Calls] rebuild plan".

READ FIRST
- AGENTS.md, docs/PRODUCT_BRIEF.md, docs/ROADMAP.md, docs/data-layers.md, docs/moduo-module-contract.md.
- The module has no .design brief yet: read specs/moduo-meet.md (the plan of record until this re-plan supersedes it), docs/decisions/meet.md, docs/gotchas/desktop.md (Tauri webview permissions), docs/gotchas/supabase.md, and specs/chat-v2.md §10, §11 and §18.
- The Tasks v3 north star:
  - specs/tasks-v3.md
  - .design/tasks-v3/REPLAN.md (principles 38–46a, 48a, 48b; §5 kit; §8 calls)
  - docs/decisions/tasks.md
  - .design/tasks-v3/research/keymap.md
  - the prototypes in .design/tasks-v3/prototypes/

GOAL
Make Calls complete and pleasant for teams of 2–5 on Duo/Team (founders, developers, PMs, agencies with clients), freelancers and agencies meeting clients through booking links and events, and later online hackathons and classes, so each can run a normal week without Slack huddles, Discord voice channels, Google Meet, Zoom and Microsoft Teams calls. Not 1-to-1 copies. Earlier decisions can be overturned with evidence. The module is done only when it wires into the spine, ships its MCP tools and defines its dashboard widgets.

KNOWN INPUTS:
- Moduo Meet is already specced but not built: specs/moduo-meet.md (Mike, Ready 2026-10-06; blocks MEET-0a…MEET-10 in specs/BUILD_ORDER.md; docs/decisions/meet.md). Self-hosted LiveKit in Azure Poland Central, booking links + events + instant calls, up to 12 people, 4 h, recording + transcripts, a Call note afterwards, a desktop mini-player, a guest join page that works on phone browsers. Audit it like Chat v1: keep what's strong, reverse what's weak, record what changes so Mike can follow. It was planned before Tasks v3's north star: its "floating glass control dock" meets rule 81 (no blur), its full-screen stage meets the 3×3 layout (48b), and it leaves "chat's own call UI" out on purpose. Its first block waits on Azure capacity (the subscription showed no VM quota on 2026-10-06).
- Huddles are new (Maciej, 2026-10-14): Slack-style voice inside a conversation: drop-in, audio first, members only, alive while anyone is in it. One engine and one call UI must serve huddles and meetings (Chat v2 call CH76).
- Chat v2 is specced (specs/chat-v2.md, Ready to execute) and reserves five seams for you (§18, CH77): a "Start a huddle" slot in the conversation toolbar, a live-huddle mark on the sidebar row, a quiet event line in the stream when a huddle ends, "In a call" as a sixth presence state, and a huddle notice held by Focus, quiet hours and do not disturb. Decide the rules for each (who hears that a huddle started, whether a huddle in a direct message rings, recording, guests). Chat starts a call through startCall({ source: "chat" }). Read .design/chat-v2/REPLAN.md §8 (CH6, CH7, CH9, CH28a–d, CH41, CH47) for Chat's quiet-notification and presence rules.
- Calendar is re-planned in parallel (t/maciej/calendar-replan, paused for the hackathon): it owns events, booking links ("Meet / Zoom / their choice" today) and whether events get guests; agree the boundary there. Notes is re-planned in parallel (t/maciej/notes-replan): the Call note's home.
- The hackathon is on site (Chat CH78): calls are not in its cut.
- Mike owns specs/moduo-meet.md: involve him (send him the audit and the database/infra list as a round-3 file, as Chat did in .design/chat-v2/research/round-3-database.md). Product calls stay Maciej's.
CONSTRAINTS: the Moduo app is desktop and web only (the guest join page may work on phone browsers, as Meet decided); AI only through MCP (no built-in summaries); EU-only media; chat-style quiet notifications (PRODUCT_BRIEF §7; a call never rings loudly by default); no new top-level routes without Maciej's ask; Chat v2's seams (§18) are the contract on Chat's side.

REUSE, DON'T REINVENT. Everything Tasks v3 decided for the whole app is binding unless you show evidence and I agree to change it:
- the 3×3 layout (48b), and the visual rules 38–46a;
- the north-star kit (DS-6: Row, Card, GroupHeader, MetaCount, PropertyRow, NavRow, Toolbar, FilterBar/DisplayMenu, Chip, EmptyState, Feed, DateField, Avatar);
- the right-panel view registry with its title dropdown and "← item" stack (SH-1);
- the app-wide capture with a type registry: ⌘⇧K, ⌘N, ⌘1–7 inside the modal;
- the References primitive (RF-1): this module defines its item's link, chip, card and hover preview, plus "Private item" and "Deleted …";
- the @ # / grammar and the /today date chips;
- the bottom-bar mode pattern (82b);
- the key map's conventions;
- the notification-table format;
- Time & region;
- the motion tokens (no blur);
- the agent-session status pattern;
- the decision-entry format;
- the state rules: loading, empty, filtered to nothing, offline, read-only, very large.
Contracts Tasks already defines for this module (e.g. specs/tasks-v3.md §18 for Calendar and Home) must be honored, or explicitly renegotiated.

RULES OF THE CONVERSATION
- I'm the product designer. Ask me only product, UX, scope and priority questions, each with a recommendation. Research and decide implementation, infra, data model and libraries yourself, and record each decision with the alternative you rejected.
- Number every call once; never renumber. Ask each call under its number. Record my answer under it, in my words. Re-ask what I questioned with fuller reasoning; never re-argue what I decided.
- When words can't settle a UI question, build a throwaway HTML prototype:
  - reuse the visual system of .design/tasks-v3/prototypes/round-2b.html;
  - keys 1–9 switch frames, V cycles variants;
  - always show the full 3×3 layout with the bottom bar;
  - never use rotated text;
  - send it to me.
- Keep the plan in one file, .design/calls-v2/REPLAN.md, with a status block at the top listing what's open. Write every answer into it before replying, so a compaction loses nothing. Research lanes write their own files under research/.
- When I defer a choice ("you decide", "I trust you"), record it as "agent's choice, deferred to by Maciej — confirmed for building, may be reconsidered", with a one-line why and the rejected alternative.
- Every proposal says whether people outside its target group would still want it (48a).
- Reply format:
  - a Status line first;
  - what was decided;
  - the open calls, with ★ on the load-bearing ones;
  - new topics get one opening call each;
  - end with a Session line (safe to archive or not; what's uncommitted).
- Never put security findings in repo files; tell me privately.
```
