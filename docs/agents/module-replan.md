# Module rebuild plan: the reusable prompt

The process that produced Tasks v3 (2026-10-09 → 2026-10-10: `.design/tasks-v3/REPLAN.md` → `specs/tasks-v3.md`), written as a prompt Maciej pastes for any module. Every module is expected to be largely **wiped and rebuilt on Tasks v3's foundations**, so the prompt plans a rebuild, not a patch.

**How to use it:** fill the four `<…>` lines and paste the block as the first message of a fresh session, on **Opus 5.5 at high effort**. Switch to **Fable 5.1 (high)** only for the final spec step, when the session asks.

---

```
Plan the rebuild of the <MODULE> module, the way Tasks v3 was planned. Follow docs/agents/module-replan.md exactly (it's on the branch t/maciej/tasks-v3-build).

SETUP
- Start your branch from the Tasks v3 integration branch, which holds the north star: git switch -c t/maciej/<module>-replan t/maciej/tasks-v3-build.
- Work in LOCAL BUILD MODE: read the 🟠 box at the top of the "Tasks v3" section in specs/BUILD_ORDER.md. Local Supabase is prod; no pushes to maciej/develop and no PRs until Maciej says "release"; backing up your branch to origin is fine.
- Title the session "[<Module>] rebuild plan".

READ FIRST
- AGENTS.md, docs/PRODUCT_BRIEF.md, docs/ROADMAP.md, docs/data-layers.md, docs/moduo-module-contract.md.
- .design/<module>/BRIEF.md and DESIGN_BRIEF.md, the module's specs in specs/, docs/decisions/<area>.md, docs/gotchas/<area>.md.
- The Tasks v3 north star:
  - specs/tasks-v3.md
  - .design/tasks-v3/REPLAN.md (principles 38–46a, 48a, 48b; §5 kit; §8 calls)
  - docs/decisions/tasks.md
  - .design/tasks-v3/research/keymap.md
  - the prototypes in .design/tasks-v3/prototypes/

GOAL
Make <MODULE> complete and pleasant for <ROLES, e.g. students, developers, PMs, founders and teams of up to 5, freelancers/agencies, creators, founder-led sales>, so each can run a normal week without <THE TOOLS IT REPLACES>. Not 1-to-1 copies. Earlier decisions can be overturned with evidence. The module is done only when it wires into the spine, ships its MCP tools and defines its dashboard widgets.

KNOWN INPUTS: <paste dogfood notes, reviews, links, Mike's notes, or "none">
CONSTRAINTS: <e.g. "desktop only", "no new routes", or "none beyond AGENTS.md">

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
- Keep the plan in one file, .design/<module>-v2/REPLAN.md, with a status block at the top listing what's open. Write every answer into it before replying, so a compaction loses nothing. Research lanes write their own files under research/.
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

---

## The rounds the session runs

1. **Orient and diagnose** (read-only):
   - the root cause (who the module was first specified for; which reversals share one shape);
   - what's genuinely strong;
   - what's broken, by kind: structure, trust bugs, capability gaps, visual seams, no way in;
   - which Tasks v3 pieces this module must adopt.
2. **Research lanes in parallel.** Each lane is a background agent that writes its own file and returns at most 300 words:
   - the current state from code and the live local app, in a seeded workspace with a second member;
   - a visual audit with measurements;
   - an audit of early decisions (keep / adjust / reverse);
   - structure across competitors;
   - role journeys (a normal week per role, plus the gap map);
   - competitor comparisons view by view, as the rounds go.
3. **Round 1: the shape.** Calls on structure, vocabulary and principles; a consistency pass across the calls; a structure prototype.
4. **Rounds 2a/2b: every surface.**
   - Go view by view and state by state: empty, loading, error, read-only, offline, very large.
   - Cover how this module plugs into the shared pieces: its panel views, its capture type, its References previews, its MCP tools, its notifications.
   - Run a gap audit by a separate agent: it walks every role's week and every view in every state, and reports only what's unaddressed, contradictory or too thin.
   - Fold the audit's findings into calls, and fix contradictions in place.
5. **Round 3: reconcile in-flight work** (open PRs, half-built blocks): keep, re-scope, close and salvage, or mark superseded, each with effort and order.
6. **The spec** (switch to Fable 5.1, high), `specs/<module>-v2.md` from `specs/_template.md`:
   - **How to write it:** section by section into the file, never in one message.
   - **Inside the spec:**
     - acceptance criteria written as one normal week per role;
     - a test for every AC sub-item;
     - a notification table and a key map;
     - migrations named per block;
     - the readiness (DoR) gate.
   - **Blocks:**
     - continue the module's id lanes;
     - list dependencies on Tasks v3 blocks (e.g. DS-6, SH-1, RF-1, TV-D11a the shared store);
     - get their own section in BUILD_ORDER, under LOCAL BUILD MODE.
   - **Then, in order:**
     1. the decision entries (4 lines each: who · what · why · rejected) in `docs/decisions/<area>.md` and the index;
     2. a supersession banner on the old spec;
     3. a `validator` pass;
     4. fixes;
     5. "Ready to execute".
7. **Memory:** keep a project memory note with the re-entry point (the REPLAN status block), and update it every round.

## What the Tasks re-plan taught (keep these)

- **Prototypes decide more than paragraphs.** Maciej answers fastest to frames with variants.
- **One name per concept, app-wide** (section, never column; Focus, never Queue). Check the `@ # /` grammar before proposing any token.
- **Avoid jargon** ("scale bar"); say it in product terms.
- **Visual don'ts:**
  - no label clutter in sidebars;
  - no user-picked icons;
  - no rotated text;
  - no red;
  - no AI badge or colour;
  - pink is not an accent.
- **The 3×3 layout is a founding rule.** Edge strips and rails are off the table; switching happens in a panel's own title row.
- **Connections are the product.** When in doubt, link by default and make the link easy to remove.
- **Security findings never go into repo files.** Report them privately and fix them in their own session.
- **Every module is rebuilt after Tasks.** Design shared pieces as contracts the next module adopts, not against today's code.
