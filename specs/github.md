# Spec: GitHub on tasks: chips, cards, auto-linking and status suggestions

> Status: **Ready to execute** (planned 2026-10-16) · Owner: maciej · Board task: MOD-156 · Grilling record: questions G1–G51, answered by Maciej 2026-10-16 ("g39. c, all ok": every recommendation, as amended by the research addendum, with G39 = c) · Related: [specs/tasks-v3.md](./tasks-v3.md) §9 (details) and §11 (references), [docs/moduo-module-contract.md](../docs/moduo-module-contract.md), [docs/PRODUCT_BRIEF.md](../docs/PRODUCT_BRIEF.md)

## Scope

Teams that write code link GitHub pull requests and issues to their Moduo tasks, and see each one's live state as a chip in text and as a card in the task. The links mostly make themselves: a branch, PR title or PR description that names the task's ID (`mod-142-…`, the format "Copy branch name" already produces) attaches the PR to the task. When a linked PR opens or merges, the task suggests the next status (In progress, Done), and a workspace setting can make that move automatic. A workspace admin connects GitHub once, as a read-only GitHub App with chosen repos. Nobody else connects anything, and workspaces that never connect GitHub see no GitHub UI.

The great moment (G2): *"I push `mod-142-fix-thing`, open a PR, and the task already shows the PR's live state. When it merges, the task offers Done, or, with the setting on, is Done, and I touched nothing."*

Why now: Maciej and Mike build Moduo with agents that open PRs all day. The agent session line already shows "PR #42 ↗" as a plain link (Tasks v3), and the developer persona in `.design/tasks-v3/research/role-journeys.md` needs it. Tasks v3 parked "GitHub PR status" as later (§ out of scope there); this spec un-parks it.

## Product behavior & UX

### Connecting (admins, once)
- **Settings → Integrations** gets a **GitHub** card next to Calendar, Email and AI & MCP (G26).
  - Not connected, admin view: one line ("See pull requests and issues on your tasks") and **Connect GitHub**.
  - Not connected, member view: "Ask an admin to connect GitHub."
- **Connect GitHub** opens GitHub's install page for Moduo's app. The admin picks a GitHub account or organisation and "All repositories" or chosen ones.
  - The install screen says what members will see (G20): "Members of this workspace will see the titles and status of pull requests and issues from the repos you choose."
  - GitHub returns to Moduo, and the card shows the account, its repos, "Manage on GitHub" (adding or removing repos happens on GitHub) and **Disconnect**.
- A workspace can connect several GitHub accounts or organisations, and one organisation can be connected to several workspaces (G24).
- After connecting, members see a read-only line: "Connected by Maciej · 3 repos" (G48).
- The app asks only for read access: pull requests, checks, commit statuses, issues and repo metadata (G37). Moduo never writes to GitHub: no comments on PRs, no labels.

### What can be linked (G3, G4)
- **Pull requests and issues** from connected repos. Each gets a chip and a card.
- A **branch** appears once it has a PR, through that PR. Bare branches and commits wait for later; they would need read access to code.
- Issues are linked, never imported or synced as tasks.

### How links are made
- **Automatically** (G11, G35, G36, G46): a PR links to every task whose ID appears in its branch name, title or description.
  - Matching ignores case (`MOD-142`, `mod-142`) and needs whole IDs (`mod-1420` never matches `MOD-142`).
  - A workspace's old task key still matches after a rename (G51).
  - "skip MOD-142" in the PR prevents that link.
  - "part of MOD-142", "ref MOD-142" and "related to MOD-142" link the PR but mark it **reference-only**: it never suggests or moves the task's status (G36).
  - Issues link the same way, from their title or body.
  - Commit messages don't count.
- **By hand** (G10, G45):
  - Paste a GitHub PR or issue URL anywhere on a task (description, comment) or in a note.
  - Or pick "GitHub PR or issue…" in the "/" menu, which searches connected repos by number or title.
  - A link made by hand is a normal link; unlinking it removes it.
- **Unlinking an automatic link** (G13): allowed from the card's ⋯ or the Pull requests group. The PR stays unlinked from that task even if it keeps naming the ID. Linking it again by hand undoes that.
- One task can have several PRs and issues (G12), listed newest first. One PR can link several tasks (G46).

### The chip (G6, G43)
- **Shape:** a small glyph for the kind (PR, issue), drawn in its state, then `repo#412` and the shortened title, e.g. `[PR glyph] moduo#412 Fix the rail gap`.
- **State glyphs and colours,** from Moduo's tokens: open = green, draft = muted, merged = violet, closed = red. An issue is open = green, closed as completed = violet, closed as not planned = muted.
- Otherwise it looks like every other reference chip.
- **Hover** shows the card (G43). **Click** opens the PR on GitHub in the browser (desktop: the system browser).
- **Not connected, or an unknown private repo** (G22): a plain link chip `owner/repo#412` with no state. Admins get a "Connect GitHub" hint in its hover.
- **Disconnected or removed repo** (G23): the chip keeps its last known number and title, greyed, and its hover says "Not synced".

### The card (G7, G8)
- **Line 1:** state glyph, title, `repo#412`, state word (Open · Draft · Merged · Closed).
- **Line 2:** author's GitHub picture and @username (G38); `branch → main`; checks as "✓ 12 ✗ 1" (or "Checks running"); review state ("Approved", "Changes requested", "Review requested"); +/− lines; "updated 2h ago".
- An issue card has no branch, checks or diff on line 2. It has labels (up to 3, then "+n") and assignees' GitHub pictures.
- **Actions:** **Open on GitHub** and **Unlink** are visible; **Copy link** and **Refresh** sit under ⋯. Read-only viewers get Open and Copy link only.

### Where chips and cards appear (G5, G9, G40, G41, G42, G44)
- **Task details:** a **Pull requests** group (PRs and issues; one name) above Linked, shown only when it has items, with cards folded after 3 ("Show n more"). A task's GitHub items never also show in Linked.
- **Text:** in descriptions, comments and notes, a GitHub link on its own line becomes a card, and inside a sentence a chip. This is Moduo's first link preview, and the rule for every later one (G9).
- **List rows and Board cards** (G27): a quiet PR glyph in the row's indicators, drawn in the state of the most relevant PR (open over draft over merged over closed), with a count when there are several. It belongs to the same family as the agent mark and the counts.
- **The right panel's In flight view:** each task shows its main PR's chip (G42).
- **The agent session line:** "PR #42 ↗" becomes a live chip once the PR's repo is connected (G41).
- **Chat:** waits for the Chat v2 rebuild (G44).

### Status suggestions and the automatic option (G14–G18, G39 = c, G47)
- **The rules**, for a PR linked to a task and not reference-only:
  - The PR opens (draft or not) while the task is in Backlog or To do → **In progress**.
  - The PR merges **into its repo's main (default) branch** and no other linked PR on the task is still open → **Done**. Linked PRs closed without merging don't count, and with several PRs, Done waits for the last open one (G15).
  - A PR from a fork, or by someone outside the GitHub organisation (not an owner, member or collaborator of the repo), links but never suggests or moves (research addendum).
  - A PR closed without merging, or a revert, does nothing to the task (G17).
- **Default: suggest** (G39 = c).
  - The task details show a quiet suggestion line under the title: "PR #412 merged · **Mark done**" (or "PR #412 opened · **Start**"), with × to dismiss.
  - One click applies it. Dismissing keeps it dismissed for that PR event.
  - A suggestion clears itself once the task already has that status.
  - List rows and cards show nothing extra; the PR glyph's state is the signal.
- **Workspace setting "Move tasks automatically"** (off by default; admins; in the GitHub card): the same rules apply the status instead of suggesting it.
  - Each PR event acts once. If a person moves the task back, GitHub doesn't move it again until a new event (G16).
  - It never moves a task backwards.
- **Attribution** (G18): every automatic move, and every automatic link, writes one quiet trail line, e.g. "Moved to Done · PR #412 merged" or "Linked PR #412", by **GitHub (app)** with the gray plug mark (MOD-149).
  - An applied suggestion is the person's own change: "Maciej moved this to Done", with "PR #412 merged" as its reason.
  - No new notification type (G49); the usual status-change rules apply.

### Freshness (G25)
- For connected repos, the state is within seconds of GitHub's own: GitHub notifies Moduo.
- Chips and cards always show what Moduo stored. They never call GitHub while you look, so they're fast and work offline (desktop shows the last state).
- "Refresh" on a card asks GitHub again.

### The connector (G30)
- Agents read a task's PRs and issues in `tasks_get`, with state, checks and review, and can link one by URL.

## Edge cases

- **E1 · Webhook lost or out of order:** a late "opened" never overwrites "merged" (newest GitHub update wins). A nightly check re-reads open items and fixes anything missed.
- **E2 · App uninstalled or suspended on GitHub:** the card in Settings says "Disconnected on GitHub", with Connect again. Chips grey to "Not synced". No links are deleted.
- **E3 · A repo removed from the install, deleted, renamed, transferred or made private:**
  - removed or deleted → its items grey to "Not synced";
  - renamed or transferred → chips show the new `owner/repo` on the next update;
  - made private in a still-connected install → nothing changes (members could already see it, per G20).
- **E4 · A PR linked to a task the viewer can't see:** the viewer never learns of the link. A GitHub item is visible to workspace members, and to anyone who can see a task it's linked to.
- **E5 · Two workspaces connect the same organisation:** each keeps its own items and links, so a PR naming `MOD-142` links only in the workspace whose key is MOD.
- **E6 · The handle names a task that doesn't exist or is deleted:** no link. A trashed task's link reappears if it's restored.
- **E7 · The handle appears in the PR description only after editing:** the edit is a PR update and links then.
- **E8 · A removed handle:** editing "MOD-142" out of the PR does not unlink an automatic link. People unlink by hand (keeps G13 simple and predictable).
- **E9 · Unlink, then the PR is renamed to name the task again:** it stays unlinked from that task.
- **E10 · A suggestion while the task is already Done or Won't do:** none shown. An "opened" suggestion for a task already In progress: none.
- **E11 · A task in a project with custom statuses:** the suggestion or move uses the project's first status in the target category (In progress or Done).
- **E12 · Automatic move on a recurring task:** Done completes the occurrence, like a person would.
- **E13 · A reference-only PR merges:** nothing happens to status.
- **E14 · Several suggestions at once** (two PRs merge): one line, "2 PRs merged · Mark done".
- **E15 · A pasted URL to a repo that isn't connected while the workspace has GitHub connected:** plain chip. Admins' hover says "This repo isn't connected · Add it on GitHub".
- **E16 · A pasted URL that isn't a PR or issue** (a file, a branch, a commit, a repo): stays a normal link. Branch and commit chips are later.
- **E17 · Desktop offline:** chips and cards show the last state; "Refresh" is disabled with "Offline".
- **E18 · An admin leaves the workspace:** the connection stays, and the card's "Connected by" shows the former member's name.
- **E19 · Account deletion:** the connector's "connected by" is cleared; the workspace's connection and items stay (they belong to the workspace).
- **E20 · A read-only viewer:** sees chips and cards, can open them, can't unlink or apply suggestions.
- **E21 · GitHub is down or rate-limited:** stored state stays, and "Refresh" says "GitHub didn't answer. Try again later." Nothing errors in the task.

## Acceptance criteria

- **AC1** — An admin can connect GitHub from Settings → Integrations, choose repos on GitHub, and come back to a card showing the account and its repos; members see "Connected by …"; admins can disconnect. Non-admins can't start the install.
- **AC2** — When a PR in a connected repo names a task's ID in its branch, title or description (any case, whole ID, current or old key), the PR is linked to that task within a minute, and the task's trail says "Linked PR #n" by GitHub (app).
- **AC3** — "skip MOD-142" prevents the link; "part of / ref / related to MOD-142" links it as reference-only; commit messages and PR comments never link.
- **AC4** — Unlinking an automatic link keeps it unlinked even when the PR keeps naming the task; linking by hand undoes that.
- **AC5** — Pasting a PR or issue URL from a connected repo into a description, comment or note shows a chip inside a sentence and a card on its own line, and links it to the task (descriptions and comments); a URL from an unconnected repo shows a plain `owner/repo#n` chip with no state.
- **AC6** — The "/" menu offers "GitHub PR or issue…", searching connected repos by number or title, and inserts the chip.
- **AC7** — A chip shows the kind and state glyph in the state's colour token, `repo#n` and the shortened title; hovering it shows the card; clicking opens GitHub.
- **AC8** — The card shows title, `repo#n`, state, author @name and picture, `branch → base`, checks counts, review state, +/− lines and updated time (issues: labels and assignees instead); Open on GitHub and Unlink are visible; Copy link and Refresh sit under ⋯; read-only viewers get no Unlink.
- **AC9** — Task details show a Pull requests group above Linked only when the task has GitHub items, folded after 3, newest first, and GitHub items never also appear in Linked.
- **AC10** — List rows and Board cards show a PR glyph in the most relevant PR's state, with a count when there are several; the In flight view shows the main PR's chip; the agent session line's PR link becomes a live chip for connected repos.
- **AC11** — When a linked, non-reference-only PR opens (draft or not) on a Backlog or To do task, the task shows "PR #n opened · Start"; when it merges into its repo's default branch and no other linked PR is open, the task shows "PR #n merged · Mark done"; one click applies it as the person's change; × dismisses it for that event.
- **AC12** — With "Move tasks automatically" on, the same events move the task instead, once per event, never backwards, attributed to GitHub (app) in the trail; with it off (the default), nothing moves on its own.
- **AC13** — PRs from forks or from authors outside the organisation (not owner, member or collaborator) link but never suggest or move; merges into a branch other than the default never suggest or move Done; closed-unmerged PRs do nothing.
- **AC14** — State changes on GitHub (draft → open, merged, closed, checks, reviews) reach chips and cards within a minute without reloading, and an out-of-order event never rolls the state back.
- **AC15** — Uninstalling the app, suspending it, or removing a repo greys its chips to "Not synced" and keeps every link; reconnecting brings them back.
- **AC16** — A GitHub item is visible only to workspace members and to people who can see a task it's linked to; nothing about it leaks to a viewer who can see neither.
- **AC17** — `tasks_get` returns a task's linked PRs and issues (state, checks, review, URL), and an agent can link one by URL with Tasks and Links at Edit.
- **AC18** — Workspaces without GitHub connected see no GitHub UI except plain link chips for pasted github.com URLs; the "/" menu entry and Settings' connect button are the only invitations, and the "/" entry shows only when GitHub is connected.
- **AC19** — Webhook deliveries are verified (signature over the raw body) and handled once each; an unsigned or wrongly signed request changes nothing.

## Tests that prove them

| Test (file · name) | Proves | Plain-English: what it checks |
| --- | --- | --- |
| `supabase/functions/_shared/github/handles.test.ts` · "finds whole task IDs in any case, old keys too" | AC2 | `mod-142-x`, `Fix MOD-142`, an aliased key all match; `mod-1420` and `xmod-142` don't |
| `supabase/functions/_shared/github/handles.test.ts` · "skip and part-of words" | AC3 | "skip MOD-142" drops it; "part of/ref/related to" marks it reference-only |
| `supabase/functions/_shared/github/signature.test.ts` · "accepts GitHub's test vector, refuses tampering" | AC19 | GitHub's documented HMAC example passes; a changed byte or missing header fails |
| `supabase/functions/_shared/github/app-auth.test.ts` · "signs an app JWT GitHub accepts" | AC1 | The JWT has the right claims and lifetime and is signed RS256 from a PKCS#8 key |
| `supabase/functions/github-webhook/handler.test.ts` · "same delivery twice is handled once" | AC19 | A redelivered event (same delivery id) changes nothing the second time |
| `supabase/functions/github-webhook/handler.test.ts` · "newest update wins" | AC14 | A late "opened" after "merged" leaves the item merged |
| `supabase/functions/github-webhook/handler.test.ts` · "links named tasks, respects declines" | AC2, AC4 | A PR naming two tasks links both; a declined pair stays unlinked |
| `supabase/functions/github-webhook/handler.test.ts` · "fork and outsider PRs never suggest" | AC13 | author_association CONTRIBUTOR or a fork head links with no suggestion or move |
| `supabase/functions/github-webhook/handler.test.ts` · "default branch only, all PRs merged" | AC11, AC13 | Merge into `staging` does nothing; Done waits for the last open PR |
| `supabase/functions/github-webhook/handler.test.ts` · "uninstall greys, keeps links" | AC15 | installation.deleted marks the connection and items not synced; links stay |
| `supabase/tests/github.test.sql` · "visibility follows workspace and linked task" | AC16 | A non-member can't read an item; a guest sees it only through a task they can see |
| `supabase/tests/github.test.sql` · "automatic move once, never backwards" | AC12 | The status op as the integration actor moves forward once per event and logs GitHub (app) |
| `src/features/spine/references/github.test.ts` · "chip and card facts from an item" | AC7, AC8 | State → glyph and token, title shortening, card lines, issue variant |
| `src/features/spine/references/ui/github-reference.test.tsx` · "hover shows the card, click opens GitHub" | AC7 | Hover card appears; click calls the external open |
| `src/features/spine/references/ui/github-reference.test.tsx` · "not synced and unconnected chips" | AC5, AC15 | Greyed chip with "Not synced"; plain `owner/repo#n` with no state |
| `src/features/spine/editor/github-paste.test.ts` · "own line → card, inside a sentence → chip" | AC5 | The paste rule in descriptions, comments and notes |
| `src/features/spine/editor/mention-menu-plugin.test.tsx` · "/ GitHub PR or issue searches connected repos" | AC6, AC18 | Entry shows only when connected; picking inserts the chip |
| `src/features/tasks/ui/task-github-group.test.tsx` · "Pull requests group" | AC9 | Shown only with items, folded after 3, newest first, not duplicated in Linked |
| `src/features/tasks/ui/task-row.test.tsx` · "PR glyph and count" | AC10 | Most relevant state wins; count when several |
| `src/features/tasks/ui/github-suggestion.test.tsx` · "Start and Mark done suggestions" | AC11 | Right line per event; one click applies as the person; × dismisses for that event |
| `src/features/settings/sections/github-card.test.tsx` · "admin connects, member reads" | AC1, AC18 | Admin sees Connect/Disconnect and the automatic setting; a member sees the read-only line |
| `supabase/functions/moduo-mcp/github.test.ts` · "tasks_get lists PRs; link by URL" | AC17 | Linked items appear with state; linking needs Tasks + Links at Edit |
| Playwright `tests/github.spec.ts` · "webhook to chip, live" | AC2, AC14 | A signed fake webhook against the local stack links a task and its chip updates without reload |

## Assumptions & technical decisions

Each is the agent's choice, deferred to it by Maciej during grilling: confirmed for building, revisitable.

- **A GitHub App, not an OAuth App.** Fine-grained read-only permissions (Metadata, Pull requests, Checks, Commit statuses, Issues), installer picks repos, one central webhook, 1-hour installation tokens. Rejected: an OAuth App (needs the `repo` scope, read+write to everything, webhooks per repo).
- **Owner** (G34, amended by Maciej 2026-10-16: "14 ok"): Maciej registers the app under his own GitHub account (En5hi). Mike, who owns the account that holds the Moduo repo (GrochowskiMichal), installs it there and picks the repo. If Moduo gets a GitHub organisation later, the app transfers to it in one step without breaking installs. Setup steps ship with GH-1 in `docs/github-app-setup.md`.
- **Proving the install belongs to the admin (GH-1, from GH-1's research, 2026-10-16).** GitHub's setup-URL docs warn that the `installation_id` on the return can be forged: nothing ties it to the person who installed. The connect flow therefore:
  - turns on "Request user authorization (OAuth) during installation" and "Redirect on update", with the app's callback URL set to `github-connect`;
  - on finish, exchanges the code (with the client secret, `GITHUB_APP_CLIENT_SECRET`) for a user token, checks that the installation id is in that user's `GET /user/installations` (paged), then throws the token away;
  - when GitHub returns without a code (an update to an organisation already connected to another workspace, G24), bounces once through GitHub's OAuth authorize URL, carrying the installation id in the signed state.
- **Disconnect** marks this workspace's link `disconnected` (a fourth status beside active / suspended / removed, so the card never says "Disconnected on GitHub" for a local disconnect). It calls `DELETE /app/installations/{id}` only when no other workspace still uses that installation.
- **GH-1 notes:**
  - Stamp the migration after the Chat v2 files (`20261017123000`).
  - `perm_can_see_entity`'s newest body is `20261014090000_chat_privacy_rules.sql`. Unknown types fall through as visible, so the GitHub branch is required.
  - There is no `ws.admin` key; the admin check uses `ws.manage_members`.
  - `ACTIVITY_ACTOR_TYPES` has no parse / normalize / is helpers yet, and `vocabularies.test.ts` pins the lists.
  - `links_op_create`'s newest body is `20261017112000_chat_v2_mention_rows.sql`, and it refuses unknown origins. GH-2's automatic links need their own definer path.
  - "Connected by" for a former member needs a SECURITY DEFINER read (and a `READ_RPCS` line in `src/lib/min-build.ts`).
- **Secrets** (app private key converted to PKCS#8, webhook secret, client secret `GITHUB_APP_CLIENT_SECRET`) are Edge Function secrets set by Maciej, never in the repo. App ID and client ID are public config.
- **Tables** (one migration in GH-1, workspace-scoped, service-role writes, member reads via RLS):
  - `github_installations` (workspace, installation id, account login and type, status active/suspended/removed, connected_by, auto_move boolean default false);
  - `github_repos` (installation, GitHub repo id, full name, private, default branch, active);
  - `github_items` (uuid id, workspace, repo, kind pr|issue, number, title, state, draft, merged, merged_at, base and head refs, author login, avatar URL and association, head-is-fork, additions, deletions, checks passed/failed/pending, review state, labels, assignees, html_url, gh_updated_at, synced_at, not_synced);
  - `github_events` (delivery id unique, event, action, payload, received_at, processed_at, error);
  - `github_suggestions` (task, item, kind start|done, event key, state open/applied/dismissed).
  - The items are registered in `entities` as types `github_pr` / `github_issue`, so links, references, the Linked hub and search work through the spine. Rejected: storing URLs on tasks (the spine needs uuid entities, and agent-session links stay plain).
- **Links** are ordinary `entity_links` (`references` kind) with a new origin `github` for automatic ones. Reference-only is a flag on the link's metadata. Unlinks of automatic links are remembered in a `github_link_declines` table, the same idea as `link_suggestion_declines`.
- **Actor:** a new `actor_type` value `integration` (CHECK + `@contracts` `ACTIVITY_ACTOR_TYPES` in the same migration), with label "GitHub". The webhook writes links and automatic moves through the normal intent ops (`links_op_create`, `tasks_op_set_status`) with that actor. The client maps `integration` to the plug mark (`AppAvatar`, MOD-149). Rejected: running as an API key (it would read "<person> · via <key>" and need a fake key).
- **Visibility:** `perm_can_see_entity` gets a GitHub branch: workspace members, or anyone who can see a task the item is linked to. This adapts G20 to Moduo's guest sharing (AC16).
- **Webhook pipeline:** `github-webhook` (verify_jwt off) reads the raw body, verifies `X-Hub-Signature-256` in constant time, inserts into `github_events` (unique delivery id), answers 200, then processes in the background (`EdgeRuntime.waitUntil`).
  - Processing upserts `github_items` only when the payload's `updated_at` is newer.
  - It refetches one checks summary per head commit on `pull_request` and `check_suite.completed`, and ignores `check_run` noise.
  - A nightly `pg_cron` job re-reads open items with ETags and asks GitHub to redeliver failed deliveries (GitHub never retries on its own).
- **Freshness to the client:** `github_items` is in the Realtime publication, and the reference store treats GitHub kinds as live (`isLiveKind`), so chips update without reload.
- **The handle matcher** lives in `_shared/github/handles.ts`. It's case-insensitive, word-bounded, knows the workspace key plus `task_key_aliases`, and understands "skip" and "part of / ref / related to". The client's uppercase-only `findHandles` stays as it is.
- **Paste and resolve:** a GitHub URL in a Lexical editor is recognised on paste; `github-resolve` (an edge function) fetches the item with the installation token, upserts it and returns its uuid. Unconnected repos come back as "plain". The "/" search reads `github_items` first, then asks GitHub's search for the connected repos.
- **Status mapping:** the target is the project's first status in the category (E11), applied through `tasks_op_set_status`. Done on a recurring task completes the occurrence (E12).
- **Fork and outsider rule:** `author_association` must be OWNER, MEMBER or COLLABORATOR, and the head repo must be the base repo, before any suggestion or move.
- **No public-repo previews without an install:** GitHub allows about 60 unauthenticated calls an hour per IP, shared by everyone (research addendum).
- **Erasure:** `connected_by` is cleared by `account-erasure.ts`; nothing else is per-user. A workspace's deletion cascades.
- **MCP:** `tasks_get` gains `github: [...]`; a new `tasks_link_github {task_id, url}` tool needs Tasks and Links at Edit. No new key scope.

## Execution blocks

| # | Block | Delivers | Covers ACs | Depends on |
| --- | --- | --- | --- | --- |
| GH-D | Chip, card and suggestion frames | A prototype file `.design/github/prototypes/github.html`: chip states, card (PR and issue, every state, not synced, plain), the Pull requests group, row glyph, suggestion line, Settings card states. Maciej approves before GH-3/GH-5/GH-6 build UI. | AC7–AC11, AC1 (look) | — |
| GH-1 | Connect GitHub | Migration (tables, `integration` actor, visibility, contracts), `_shared/github/app-auth.ts`, `github-connect` function (signed state, admin check, store install + repos), Settings card (connect, repos, manage, disconnect, members' line, the automatic setting stored but inert), `docs/github-app-setup.md` | AC1, AC16, AC18 | — |
| GH-2 | Webhooks, items and auto-linking | `github-webhook` (signature, idempotency, background processing), item upserts with newest-wins, checks summary, installation/repo lifecycle (not synced), the handle matcher, automatic links with declines, nightly reconcile cron | AC2, AC3, AC4, AC13 (linking part), AC14, AC15, AC19 | GH-1 |
| GH-3 | GitHub references: chips and cards | New reference kinds, resolver from `github_items`, chip and card per GH-D, hover, open external, not-synced and plain chips, live updates | AC7, AC8, AC14 (client), AC15 (client) | GH-D, GH-2 |
| GH-4 | Paste and "/" | URL paste rule (own line → card, in a sentence → chip) in descriptions, comments and notes; `github-resolve`; "/" GitHub PR or issue… search; manual link and unlink | AC5, AC6, AC4 (manual), AC18 | GH-3 |
| GH-5 | GitHub on task surfaces | Pull requests group in task details, row and Board glyph + count, In flight chips, agent session PR links as live chips | AC9, AC10 | GH-3 |
| GH-6 | Status suggestions and automatic moves | `github_suggestions`, the Start / Mark done line, dismiss, "Move tasks automatically" live, integration-actor moves once per event, trail lines | AC11, AC12, AC13 | GH-2, GH-5 |
| GH-7 | Connector | `tasks_get` GitHub items, `tasks_link_github`, docs, drift tests | AC17 | GH-2 |

GH-1 and GH-D can run in parallel. GH-2 needs Maciej's app registration (GH-1's setup doc) for its live check; it can be built and tested against signed fake events first.

## Out of scope

- Public-repo previews without connecting GitHub (rate limits). Branch-only and commit chips (they need read access to code).
- Writing to GitHub: linkback comments, labels, creating branches or PRs from a task.
- Per-person GitHub accounts: Moduo pictures for GitHub authors, per-person repo filtering.
- Syncing or importing GitHub issues as tasks.
- Filters ("Has a PR", "PR state"), ⌘K by PR number (G28, G50).
- GitHub notifications in Moduo (G49). Chat chips until Chat v2 (G44).
- Per-branch automation rules (staging vs main), draft / review / ready-to-merge statuses, deploy previews, diffs.
- GitHub Enterprise Server.

---

## Definition-of-Ready gate

- [x] **Scope, Product behavior, Edge cases, Acceptance criteria** are all filled and unambiguous.
- [x] **Every acceptance criterion has at least one test** in *Tests that prove them*, with its plain-English note.
- [x] **Open questions is empty**: G1–G51 answered 2026-10-16; technical unknowns researched (GitHub App docs, Moduo recon) and recorded above.
- [x] **Data model is named and Supabase-first**: five tables, two entity types, one actor type, one link origin (GH-1).
- [x] **Spine wiring:** links (auto + manual, declines), @/"/" (the "/" entry), references (chips/cards), activity (GitHub (app) lines), notifications (none new, by design), tags (none). MCP tools listed (GH-7). Dashboard widget: none in v1 (GitHub lives on tasks; In flight covers "what's in review").
- [x] **Execution blocks** are decomposed, sequenced, and each is context-sized and self-contained.
- [x] **Design constraints acknowledged:** tokens only (state colours from existing label/semantic tokens), primitives wrap shadcn, GH-D frames approved before UI blocks, DESIGN_RULES R1–R10.
- [x] **Manual-test surfaces:** Settings → Integrations; a task's details, rows and Board; In flight; a note; the "/" menu; the trail; a real PR on the Moduo repo (after Maciej registers the app).

**Ready to execute.**

## Open questions

- [ ] (none)
