# Designer brief: how Maciej works, and what earlier rebuilds taught

Read this before planning or building any UI in Moduo. It collects what Maciej (the product designer) has asked for across many sessions and what the Tasks v3, Chat v2 and Mail rebuilds taught. AGENTS.md has the rules; this file has the taste and the history behind them. Where they disagree, AGENTS.md and the hooks win; tell Maciej about the conflict.

## Who decides what

- **Maciej** decides product: the feature set, UX, UI, copy, keyboard, how it feels, scope and priorities.
- **Mike** (the CTO) decides systems: backend, data model, sync engines, servers, infrastructure, architecture. His recent rebuilds (for example the Mail engine and Calendar sync) are the foundation to build on.
- **Build on the existing foundation.** Don't rewrite backend or engine code unless the design can't be built without it. A change that would clearly improve performance or reliability is welcome as a recommendation. Raise it as a numbered call in product terms ("lists open instantly at 100k threads"), with the cost, and note it for Mike in the spec's assumptions and in the PR description.
- Technical choices inside that foundation are yours: research them, decide them, and record each with the alternative you rejected. Never ask Maciej implementation, library or data-model questions.

## How Maciej likes to work

- **He reads only your last message.** Do the work, then report. No narration between steps.
- **Questions come in large batches, not a drip.** Gather everything first, then send one round.
- **Number every call once and never renumber.** Ask each call under its own number, and keep using that number in every later round. Never add a renumbered "Your calls" recap at the bottom: he answers by number while reading ("10. ok … 14. drop it").
- **Each call stands on its own in the message:** the actual question, the options (a/b/c), your recommendation and a one-line why. For mechanics he can't picture, add the use case and the risks. A prototype frame is a pointer, never the question itself.
- **Prototypes beat paragraphs.** He answers fastest to frames with variants: several directions side by side, each with what it's good and bad at. Preview cheaply in artifacts instead of iterating in code.
- **Record his answers in his words**, under the call, before you reply. Re-ask what he questioned, with fuller reasoning; never re-argue what he decided.
- **Decision provenance:** when he defers ("you decide", "I trust you"), record it as "agent's choice, deferred to by Maciej: confirmed for building, may be reconsidered", with a one-line why and the rejected alternative. Never present an agent's choice as his.
- **Force decisions before a round ends.** Don't close a planning round with open questions he hasn't been asked.
- **End build reports in this order:** Status (Landed · Built, not landed · Blocked · Not started, with the PR link) · To finish · Needs you · Found (one line each) · whether the session is safe to archive.

## The process that worked (Tasks v3, then Chat v2)

1. **Design phase, with Maciej.** Research and evidence, then rounds of numbered calls, each round with an artifact of frames and variants. The plan lives in one `REPLAN.md` with a status block at the top. The rules are in [module-replan.md](./module-replan.md).
2. **Spec.** The spec cites a prototype frame for every UI section, then `/s1` grills only the gaps and cuts the blocks.
3. **Build phase, unattended.** After the spec is Ready, the build runs without Maciej: one orchestrated run, blocks built by waves of subagents on one task branch (the execution mode `specs/mail-rebuild.md` uses), or an orchestrator with up to three builders ([chat-v2-build.md](./chat-v2-build.md)). Never stop to ask mid-run; record agent's choices in the block's record instead. After a usage limit, resume at the reset.
4. **Close the loop.** Compare the built module with the prototype, frame by frame.

## What Tasks v3 taught about prototypes and builds

Tasks v3 shipped visibly less polished than the prototypes Maciej approved, because nothing made the builders match them. So:

- What he approved in a frame is the default. Only a numbered call to him changes it, and a spec writer never changes a drawn layout on their own.
- A written rule never overrides a drawing (Tasks' "nothing truncates" squashed the drawn "+2" overflow).
- Every builder brief lists its frames under "Read first", and "Done when" includes a side-by-side screenshot against the frame.
- Prototype the hard states too: editing, focus, empty, loading, error, offline, long text, every density, light and dark.
- "Agent's choice" may only cover what he never saw drawn.
- Ratified choices aren't open. If a specced approach looks too costly mid-build, build it anyway or raise it as a call before building; never swap it quietly.

## Standing design rules

- **The 3×3 layout is sacred.** Top bar = global. Middle row = the module's left panel (navigation), centre (main surface) and right panel (context). Bottom bar = the module's tools, plus each side panel's toggle under that panel. No edge strips, activity bars, rails or extra columns. Prototypes always show the full layout, bottom bar included.
- **The right panel switches views.** Each module hand-picks a short list of right-panel views with a default, switched from the panel's own title-row dropdown. Linked items open in it with a "← item" back arrow. Never hard-code one purpose.
- **Customization is a product value.** Density, text size, accent, theme and fonts are user settings, and the densest setting should reach Linear and Notion levels. "Simpler" means fewer knobs, never removing a picker. Route every surface colour through tokens, so a future theme-shade axis can re-tint the app.
- **Colour:** the default accent is mono. Pink is just one of the eight accent options, never the brand, a highlight or an "AI colour". No AI badges, dots or colours: assistant actions show the assistant's name, in neutral.
- **Never rotate text.** No red as decoration, no user-picked icons, no label clutter in sidebars.
- **One name per concept, app-wide.** Check the `@ # /` grammar before proposing a token. Say things in product terms, not jargon.
- **Connections are the product.** Link by default and make the link easy to remove.

## Product direction (2026-10-21)

- **The own / connect / skip test.** Own a feature when its value comes from links to the rest of Moduo. Connect to an outside tool when the hard part is the thing itself. Skip it when it links to nothing.
- **First user:** a small agency (2–5 people). Freelancers and solo users should still get the best experience.
- **AI only through MCP.** There is no built-in model. Every module ships its MCP tools and its dashboard widget.
- **Calls:** huddles first (audio and screen share, for the team, started from channels and DMs), on a vendor such as LiveKit or Daily, never self-built media. Guest links and a "Moduo call" booking location come later.
- **Clients** aren't workspace members. The plan is a live, shared client page per project: clients can view, approve, comment and upload, but not edit or chat; access is by magic link.
- **Files** are a project view, not a module. Notes are the only native authoring; Drive and OneDrive files are linked as pointers.
- **Out:** whiteboard, mindmap and finance. Plugins and a marketplace aren't planned for now.
- **Two speeds:** sketch mode behind flags, and production grade once a shape survives dogfooding.

## Benchmarks per module

- **Email:** Spark first. It's free and covers everything Maciej needs, so match its feature set. Superhuman second, for speed and keyboard flow. Email is a desktop-first client on the Rust mail engine.
- **Calendar:** Morgen and Amie for the feature set and how they work (time-blocking, scheduling tasks, booking links). Maciej never found a calendar that worked for him; that's part of why Moduo exists.
- **Tasks**, the UI north star for every module: Linear-light with focus mode, see `specs/tasks-v3.md`.

## Working on this Mac

- **One local Supabase stack is shared by every session** (AGENTS.md rule 13). Never reset or stop it. Leave rows other sessions seeded.
- **Push access:** `gh` must be on the `En5hi` account (`gh auth switch --user En5hi`). The other account gets "Repository not found".
- **The repo is public.** Security gaps are never described in commits, PRs or docs. Report them privately and fix them in their own session.
