# Capture, References and team routing — round 2b research

**Lane:** capture (⌘⇧K, + New, inline add), the References spine spec (call 55) and team routing (call 54). It starts from today's app ([current-state](./current-state.md) §1.10, [visual-audit](./visual-audit.md) A9, A12) and the decided calls 20, 20a, 33, 33a, 54, 55, 56, 72a and 80, plus defaults a, e and g.

**Evidence:**
- [V] the vendor's own docs, fetched or quoted in search results;
- [U] a secondary source or search snippet.

Height shut down in September 2025 ([AlternativeTo](https://alternativeto.net/news/2025/3/height-project-management-tool-to-shut-down-by-september-2025/)), so it isn't used as a leader.

---

## 1 · The capture surface

**Leaders**
- **Todoist Quick Add:** a title line, with buttons below for what the line didn't say [V] ([docs](https://www.todoist.com/help/articles/use-task-quick-add-in-todoist-va4Lhpzz)).
- **Things Quick Entry:** a title and notes; ⌘↵ saves and Esc discards [V] ([docs](https://culturedcode.com/things/support/articles/2249437/)).
- **Linear's modal:** a team breadcrumb, title, description and compact property buttons;
  - optional templates [V] ([docs](https://linear.app/docs/creating-issues)) and sub-issues in the modal [V] ([changelog](https://linear.app/changelog/2022-10-13-faster-sub-issue-creation));
  - "Create more" keeps the fields you set [U] ([changelog](https://linear.app/changelog/2021-03-10-new-issue-creation-ui)).
- **Superlist:** ⇧⌥Space or ⌘K captures a bare title; details come after creating [V] ([docs](https://help.superlist.com/en/articles/23853-create-tasks-and-subtasks)).
- **Raycast:** ↵ runs the primary action, ⌘↵ the secondary one, and ⌘K lists the rest [U] ([manual](https://manual.raycast.com/action-panel.md)).

**Pattern:** destination on top, then the title and the body, then a short row of properties with the rare ones behind "more".

**Moduo recommendation.** One dialog for ⌘⇧K, ⌘N, + New and `c`:

1. **The destination row:** "Inbox ▾" or "Acme rebrand › Design ▾", plus a source chip when there is one (§3). It replaces the Project pill, and it's where 20a's empty project slot shows.
2. **The title** (live tokens, §2), then **the description**, growing to about 6 lines (56).
3. **"+ Add subtasks".** ↵ adds a line, and each line takes the grammar ("@Sam Fri"). A list pasted here becomes subtasks, with Undo.
4. **Attachments.** Paste or drop anywhere, and a strip appears under the description. The task is created even if an upload fails (AT-3).
5. **Pills: Assign · Due · Tags · Priority · ⋯ More**, instead of eight.
   - Assign takes people and teams (§10).
   - More holds Scheduled · Reminder · Repeat · Estimate · Energy · Waiting on · Status.
   - Anything set joins the row filled. Overflow goes behind "+n" (42), and the row never wraps.
6. **The footer:** the **Add to Focus** switch on the left (U7-3, renamed per call 61); **Create more** and **Create ⌘↵** on the right. Create more keeps the pills and the destination, and clears everything else.
7. **Templates:** `/template`, or "From template…" in the ⋯.
   - Picking one fills the form.
   - Call 9's one question ("Starts …") becomes a highlighted pill that must be set before Create.
8. **Drafts.** Esc on a capture with text keeps one draft on the device; the next ⌘⇧K restores it ("Draft restored · Clear"). Things discards it, and nobody, ADHD or not, wants to lose typing.

**Inline add** (the "+ Add task" in a group or column) is a title line with the same grammar that files into that group. Tab expands it into the dialog, text intact.

## 2 · The grammar in practice

**Leaders**
- **Todoist:**
  - `#` project, `%` label (`@` is being retired), `+` assignee, `!` reminder;
  - recognised words are highlighted, and a click turns one back into text [V].
- **TickTick:** `^` list, `#` tag, `@` assignee [U] ([blog](https://curtismchale.ca/2020/08/10/ticktick-quick-add-syntax)).
- **Linear:** `@` mentions people, issues, projects and dates [V] ([docs](https://linear.app/docs/editor)). **Notion:** `@` mentions a page [V] ([docs](https://www.notion.com/help/create-links-and-backlinks)).

**Pattern:** one symbol per kind of object, recognised text marked as you type, and one click to undo it.

**Moduo recommendation**

**What leaves the title** (anchored in 33a's dates and U7-1's tags):
- Tokens that **set a property** (person, team, project or section, tag, date, `/` command) leave the title for their pill or the destination row.
- Tokens that **link a thing** (contact, note, email, event, task) stay as chips, so "Call @Anna about @Acme rebrand" still reads as a sentence.

**The menus:**
- **`@`:** People · Teams · Projects (sections nested) · Things.
  - Teams come right after People, because both are what you assign to.
  - At most 8 rows; empty groups hide; ↵ or Tab picks, Esc keeps the text.
  - You show as "Alex Rivera (you)" (43).
- **`#`:** tags, then "Create #name", plus 33's "CS 201 is a project — file it there".
- **`/`:** the date commands first (`/today`, `/tomorrow`, `/next week`, `/date`), then due, schedule, remind, priority, estimate, repeat, template.

**What a recognised token looks like:**
- It becomes the Chip primitive at text size, with the selection fill (45), and its pill fills **at the same moment**, so the row teaches the grammar.
- Date words get a dotted underline while you type, then become a token.
- Every token shows its effect before Enter: `@Design` → Assign reads "Design · unclaimed".

**Undo:**
- ⌘Z or Esc right after a recognition turns it back into text.
- Clicking a token offers "Keep as text · Change…".
- Backspace selects a whole token; a second Backspace removes it.

**Conflicts:**
- In single-value fields the last token wins, and the earlier one visibly falls back to text. An explicit `/due` beats a date word, and a pill set by hand follows the same rule.
- Tags and links add up.
- A person plus a team is allowed.

**`@person` without `@project`:**
- The destination reads "No project ▾ · Goes to Mike's Inbox".
- Enter still creates, so "Keep unfiled" (20a) costs nothing.

**Literal text:** `C#`, `#123`, `and/or` and email addresses stay literal (33).

## 3 · Where capture files

**Leaders**
- **Things:** Quick Entry is global, and its Autofill adds a link to the Mail message or Safari page you're on [V].
- **Linear:** the create modal can be pre-filled with team, project and assignee [V].

**Pattern:** the global key goes to the inbox, creating in place inherits the place, and the source rides along.

**Moduo recommendation:** ⌘⇧K always files to **your Inbox**, assigned to you. ⌘N, + New, `c` and inline add file **where you are**. The destination row shows which, and one click changes it.

| Where you are | ⌘N / + New / inline add files to… |
| --- | --- |
| A project | That project, no section |
| A section group or column | That section |
| Board column by status, assignee or priority | That value |
| Upcoming › a day | Due that day |
| My tasks | Assigned to you, unfiled |
| "For Design · 2 unclaimed" | Design, in its default project (§10) |
| A filtered or saved view | Its tags, assignee and priority (U7-4) |
| Focus | The end of Up next; the current task never changes |

**The spine.**
- With an email, note, event, contact or message open in the centre, ⌘⇧K shows it as a removable chip, "From: Re: Brand assets ×", which becomes a link on create.
- Selected text becomes the title.
- The link always shows before Enter; it's never added silently.

## 4 · Pasting a list

**Leader:** Todoist asks "Add X tasks?" and offers Cancel · Add 1 task · Add X tasks [V] ([docs](https://www.todoist.com/help/articles/add-or-manage-multiple-tasks-in-todoist-PcPoskdUp)).
- Properties set beforehand apply to all of them.
- Pasting under a parent makes sub-tasks.

**Pattern:** ask once, with "keep it as one" as a real choice.

**Moduo recommendation**
- Two or more lines in the title show an inline panel, never a second modal: **"Create 12 tasks?" · Create 12 · Keep as one** (the lines go to the description).
- **A preview shows each line's recognised tokens,** so "Send March report → due 1 March" (current-state §1.10) is caught before creating.
- **Clean-up:**
  - bullets, numbers and `[ ]` are stripped;
  - `[x]` lines are skipped, with a count;
  - blank lines are ignored.
- **Indentation:** an indented line becomes a subtask of the line above. Deeper levels flatten to one (28).
- **Pills** apply to every line; a line's own tokens override them.
- **One Undo** reverses the batch (a), and anyone assigned gets one notice (80).
- **Over 200 lines:** the panel points to importing through your AI or a CSV instead (74).

## 5 · Errors, offline, keys

**Leaders:** Things keeps everything on the device. Linear syncs local-first, and Todoist queues offline edits [U for both].

**Pattern:** a capture is saved locally first and sent later; the user never loses it.

**Moduo recommendation** (default g, made concrete):
- **Capture never fails in front of you.** The dialog closes at once, and the row shows a tertiary clock mark until it's saved.
  - Offline, the global top bar (48b) reads "Offline · 2 waiting to sync".
- **If the destination was deleted or unshared meanwhile,** the task lands in your Inbox, with one notice: "Saved to your Inbox — Acme rebrand isn't available."
- **Offline:** `@` and `#` suggest from the device copy, and emails say "Search needs a connection".

**The keyboard map.** The grammar is the keyboard path to every pill, so there are no per-pill chords.

| Key | Does |
| --- | --- |
| ⌘⇧K | Capture to your Inbox, from anywhere |
| ⌘N · `c` | New, where you are |
| ⌘↵ · ⌘⇧↵ | Create · create and keep the dialog open once |
| ↵ in the title | Go to the description |
| Esc | Close the menu → undo the recognition → close (keeps the draft) |
| `i` · `q` | Take a team task · Add to Focus (existing keys) |

## 6 · References: the four forms

**Leaders**
- **Notion:** "Paste as preview / mention / link", with live content [V] ([guide](https://www.notion.com/help/guides/notion-api-link-previews-feature)).
- **Coda:** "Display as" link, title, card or embed [U] ([forum](https://connect.superhuman.com/t/launched-enhancements-to-creating-editing-links/7743)).
- **GitHub:**
  - references in lists unfurl to their title and state [V] ([docs](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/autolinked-references-and-urls));
  - hovercards [V] ([changelog](https://github.blog/changelog/2018-10-07-issue-and-pull-request-hovercards)).
- **Linear:** an issue mention shows its status and title, and the mentioned issue becomes related automatically [V/U] ([docs](https://linear.app/docs/editor)).
- **Slack:** unfurls sit under the message, and each person can turn text previews off [U] ([API](https://docs.slack.dev/reference/methods/chat.unfurl/)). That's the model for chat's preview cards.
- **Google Docs:** `@` inserts smart chips; hovering shows details [V].
- **Apple Notes:** `>>` links track renames [U] ([Apple](https://support.apple.com/en-au/guide/notes/apde615d29c2)).
- **Capacities:** inline links stay text, while block links can be cards [U] ([docs](https://docs.capacities.io/faq/editing/default-link-block-view)).

**Pattern:** small and live inline, a card on its own line, the same card on hover, and switchable after inserting.

**Moduo recommendation**
- **Sizes:**
  - **Link:** body text plus a 14 px icon, primary colour (46).
  - **Chip:** at most 280 px; the title truncates first (41, 42).
  - **Card:** 280–560 px, two or three lines.
  - **Hover:** the card at 320 px, plus 3 description lines (56).
- **Reading 55's "—":** email, note and event chips carry no fact; they're the icon plus the title.

| Item | Link | Chip | Card (one action at most) |
| --- | --- | --- | --- |
| Task | Status icon · title | Status icon · title · due (late = muted) | Status circle (completes) · title · MOD-142 / project › section · assignee · due · 2/5 · "Waiting on Anna · 3d" |
| Email | ✉ subject | ✉ subject | Sender · date / subject / 2-line snippet / 3 messages · "Waiting on reply" |
| Contact | Avatar · name | Avatar · name | Avatar · name / role · company / last contact · 3 open tasks |
| Note | Icon · title | Icon · title | Title / 2-line excerpt / "Edited by Sam · Oct 8" |
| Event | Icon · title | Icon · title | Title / Thu · 2:30–3:00 PM / 3 avatars +n |
| Project *(new)* | Colour dot · name | Dot · name | Name · status / target · "4 of 18" · lead |

**Where the facts come from (it exists today):**
- The `entities` registry holds the label and icon; per-module snippet projectors (`snippet-projectors.ts`) hold the live facts.
- **A document stores only {type, id, form}, never a title.** That's what makes references live, and "Private item" possible.
- **Two deltas to close:**
  - Tasks get a registry row only once they're linked (current-state §1.13). §6.1's create op fixes that.
  - `EntityRefChip` strikes through a deleted item's old label, where 55 says "Deleted task".

**Defaults:** a chip in prose, titles and property values; a card alone on a line and in Linked; in chat, a chip plus Slack-style preview cards; plain text in the bell.

**"Show as: Link · Chip · Card"** sits beside a freshly inserted reference and fades on the next keystroke, like Notion's paste menu. Later it lives in the hover's ⋯.
- A pasted Moduo URL becomes a reference, with "Keep URL" as a fourth option.
- External URLs (a Figma link, say) stay plain links in v1, because a preview would mean our server fetching third-party pages.

## 7 · The rules

**Leaders:**
- Notion labels backlinks from pages you can't open "Private" [V].
- A Google Docs mention doesn't grant access [V].
- Apple Notes links follow renames [U].

**Pattern:** the reference never reveals more than the item would.

**Moduo recommendation**
- **Private item:**
  - A lock and "Private item": **no type icon** (a type alone says "an email exists"), no hover and no click.
  - Linked shows "+ 1 private item", so counts stay honest.
  - **The writer is warned when inserting it** ("Only you can see this note"). Nothing is ever shared by itself ([Docs](https://support.google.com/docs/answer/10710316)).
- **Deleted:**
  - "Deleted task", in tertiary text, with no title.
  - Restore stays in its hover for 30 days (U6-3).
  - Done and Won't do keep their category icons and are never struck through, so they never read as deleted.
- **Live:** titles and facts change in place through Realtime, with no flash.
- **Copy and paste:** it stays a reference between modules, in the destination's default form. Outside Moduo it's the title linked to the app URL, resolved with the copier's rights (f).
- **Click:** hover previews; a click opens the item in the right panel as "← item" (72a); ⌘-click opens it full.
- **Backlinks:** "Mentioned in Weekly sync — Oct 12" appears under Linked, only for viewers who can see the mentioning item ([Notion](https://www.notion.com/help/create-links-and-backlinks)).

## 8 · Performance and privacy

**Leaders:**
- GitHub links a private commit only if one of its authors could read it [V].
- Slack warns the writer when group members can't see a channel [U].

**Pattern:** the server decides what each reader sees, at read time.

**Moduo recommendation**
- **First paint:**
  - Labels come from the registry copy on the device (§6.11).
  - Facts come in one batched read per view, for the visible window only.
  - A label that hasn't loaded is a fixed-width blank with its icon, and no shimmer (81).
- **Hover previews** load on hover intent (about 300 ms) and are cached for the session. Realtime clears the cache.
- **The server checks visibility at read time.** `entities_workspace_read` and `perm_can_see_entity` already filter labels per viewer, so MCP agents get the same answer as the app.
- **No title is stored beside a reference:** not in notes, comments, notifications or the trail. Each is rendered per reader, so someone without access reads "Mia linked a private item".
- **Mentioning someone who can't see the item** warns the writer ("Sam can't see Website and won't be notified"), with "Share with Sam" if the writer can share ([Slack precedent](https://teamdynamix.umich.edu/TDClient/30/Portal/KB/ArticleDet?ID=8616)).

## 9 · Settings → Members → Teams

**Leaders**
- **Linear:** a name, a 2–5 letter key, and a picked icon or emoji plus a colour [U] ([guide](https://www.guideflow.com/tutorial/how-to-change-a-team-icon-in-linear)).
- **GitHub Primer:** circles are people; rounded squares are teams, organisations and bots [V] ([Primer](https://primer.style/components/avatar)).
- **Asana:** teams group projects and people, but a task is never assigned to a team [U].
- **Slack:** user groups are a name, an `@handle` and members [U].

**Pattern:** a team is a named list of people; its identity is either picked by hand (Linear) or carried by shape (GitHub).

**Moduo recommendation**
- **The list:** Teams sits under the people list. Each row: mark · name · up to 4 avatars +n, then "+ New team".
- **A team has:**
  - a name, as typed (40);
  - members;
  - an optional "What to send here" line, shown in `@` suggestions;
  - an optional **default project** (§10).
- **Identity without picking:**
  - a **rounded square** (people are circles, 43) with **two letters** and a stable avatar-palette colour, never the accent;
  - **the letters:** for two words, their initials; for one word, the first letter plus the next consonant that's still free, so **Design → DS** and **Development → DV**;
  - the letters can be edited, for the rare clash;
  - "Dana Smith" (DS) still differs by shape.

## 10 · Routing

**Leaders**
- **Zendesk and Front:** a group plus an assignee, and an "Unassigned" view [U] ([Front](https://help.front.com/t/x1bth6)).
- **Linear:** triage responsibility notifies or rotates one person [V] ([docs](https://linear.app/docs/triage)).
- **GitHub:** auto-picks a reviewer by round robin or load [V] ([docs](https://docs.github.com/en/organizations/organizing-members-into-teams/managing-code-review-settings-for-your-team)).
- **Jira:** a Team field beside the assignee [U] ([community](https://community.atlassian.com/forums/Advanced-Planning-in-Jira/Team-vs-assignee/td-p/2026690)).

**Pattern:** a team field next to one owner, an unassigned list, and someone responsible for what sits in it.

**The constraint.** An unfiled task is private (20), but a routed task must be visible to the team. So "@Design new hero image" with no project has nowhere to live.

**Recommendation: routing needs a project.**
- A team may name a **default project**, and `@Design` alone files there. It is an ordinary project, not the shared outside intake ("Requests") that call 20 left for later.
- Without one, the destination reads "Pick a project for Design ▾", and Create waits for it (20a's rule, applied to teams).
- Routing never changes access (54): if some members can't see the project, the dialog says so before Create.

**The routing itself:**
- **My tasks:** one "For Design · 2 unclaimed" group per team you're in, oldest first, open tasks only (no Backlog, 53).
  - "Take it", or `i`, makes you the assignee.
  - **The team stays** as a Team property next to Assign.
- **Rows:** an unclaimed task shows the team mark in the avatar slot. The Detailed preset adds a Team column.
- **Claims:**
  - The first taker wins ("Mia took this a moment ago").
  - "Give back to Design" returns the task.
  - Focusing an unclaimed task reads "Take it and add to Focus".
- **Filter and group:** Team is / is not / none; Group by: Team; Team in the bulk bar (e); team load shows "Design · 2 unclaimed · oldest 4d".
- **`@Design` in a comment:** one notice to each member who can see the task (decided). The writer hears about the rest (§8). In prose `@` never routes (33).
- **Nobody claims it for days:**
  - After the first notice, members get nothing more pushed; the row shows a tertiary "unclaimed 3d".
  - **The creator** gets one check-back after 3 days, or the day before it's due: "Nobody has taken Social cards (Design · 3d) — Assign · Keep waiting · Won't do".
  - No round-robin: automation builders are a non-goal (47).

**Rows for the notification table (80):**

| Event | Who | Where | When | Muted by |
| --- | --- | --- | --- | --- |
| Routed to your team | Members who can see it | Bell | Grouped hourly | Your team's mute |
| A routed task is taken | Nobody (it's in the trail) | — | — | — |
| Still unclaimed | Its creator | Bell | Once | Notifications → Waiting |

## 11 · Edge cases

**Leaders:** Zendesk rejects an assignee who isn't in the ticket's group [U]; Jira keeps Team and Assignee independent [U]. **Pattern:** the team outlives the person.

**Moduo recommendation**

| Case | Behaviour |
| --- | --- |
| **A team is deleted** | Claimed tasks keep their person; unclaimed ones are moved to another team or left without one. The trail keeps "was routed to Design". Undo (a). |
| **A member leaves the workspace** | PRIV-2 and 78 already unassign their tasks, so team tasks they had claimed simply land **back in the team's unclaimed list**: a consequence, not a new rule. |
| **A member leaves a team** | Their claimed tasks stay theirs, after one question: "Give back your 2 Design tasks?" (Keep is the default). |
| **The creator isn't in the team** | Allowed. They follow it through "Created by me" and the check-back. |
| **Assignee and team together** | Allowed, with no membership check (Jira-style). With a team set, the picker lists its members first. Clearing the person returns the task to the team. |
| **A team with no members** | Allowed, shown as "Design · no members"; capture warns. |
| **Subtasks, templates, agents** | A new subtask inherits its parent's team. Templates can route a subtask (9). `tasks_assign` accepts a team. |

---

## Calls to ask the designer

1. **One dialog, two meanings:** ⌘⇧K always files to your Inbox; ⌘N, + New and `c` file where you are. *Recommend: yes* (as in Things).
2. **Four pills:** Assign (people and teams) · Due · Tags · Priority · ⋯ More, with the project moved to the destination row. *Recommend: yes.*
3. **The title rule:** property tokens leave the title; tokens for things stay as chips. *Recommend: yes* (consistent with 33, 33a and U7-1).
4. **The source rides along:** capturing with an item open adds a removable "From:" chip, which becomes a link. *Recommend: yes, on by default.*
5. **Routing needs a project:** a team can name a default project; otherwise capture asks for one. *Recommend: yes*: it's how 20's private Inbox and 54's routing both hold.
6. **Team marks:** a rounded square, two automatic letters (DS, DV) and a stable colour; the letters can be edited, nothing is picked. *Recommend: yes.*
7. **Unclaimed tasks:** members hear once (grouped hourly); the creator gets one check-back after 3 days or the day before due; no round-robin. *Recommend: yes.*
8. **Who manages teams:** any member creates them and edits membership (routing hides nothing); only the creator, an owner or an admin deletes one. *Recommend: yes.*
