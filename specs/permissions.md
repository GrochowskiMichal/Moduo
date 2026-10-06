# Spec: Workspace permissions & sharing (all modules)

> Status: **Approved for build** (designer calls locked 2026-10-06, see §Open questions) · start with PERM-0 · Owner: mike · Created 2026-10-06
> Related: `specs/settings-overhaul.md` (Members / API-keys sections), `specs/calendar.md` (booking links), `specs/chat.md`, `specs/moduo-meet.md`, `docs/moduo-module-contract.md`

## Scope

One permission system for every module, applied in **collaborative workspaces** (more than one member), configured in Settings and carried by workspace invites. It answers six module questions (Notes, Tasks, Calendar, Email, Contacts, Chat) with **one shared model**, so each module doesn't invent its own sharing rules.

---

## 0. What exists today (code recon, 2026-10-06)

| Area | Today | Problem for collaboration |
| --- | --- | --- |
| **Workspace roles** | `owner > admin > member (app: "editor") > viewer` on `workspace_members.role`. Owner/admin rules are enforced in `workspace_op_*` (`20260711180000_workspace_roles_transfer.sql`). | Fine — keep as the base layer. |
| **Per-member module perms** | `workspace_members.permissions_notes` / `permissions_tasks` (`read｜write｜none`), set from the invite (`workspace_op_accept_invite`). Calendar, contacts and links **ride the Tasks lane** (`calendar_module_permission`, `contacts_module_permission`). | They're per *module*, not per *thing*. You can't share one note or one bucket. |
| **Notes** | `notes_workspace_read` = **every member reads every note**. Publish-to-web exists (`published_at` + `publish_token`). Notes nest (`parent_id`). | No private notes. |
| **Tasks / buckets** | `buckets.owner_id` exists, but read access covers the whole workspace. | No private or restricted buckets. |
| **Calendar** | `calendar_accounts` and `calendar_events` → `tasks_module_can_access_workspace` = **every member reads every synced event**. | 🔴 **Privacy leak:** a teammate can read your Google Calendar event titles and descriptions. |
| **Email** | `email_accounts` are owner-only ✅. But `email_refs` (emails linked into the spine) are **readable by the whole workspace**. | 🟠 Subject and sender of any email you link leak to all members. |
| **Contacts** | `contacts` / `companies` readable by the whole workspace. `owner_id` exists. | Contacts captured from email are visible to everyone. |
| **Chat** | Public/private channels + `chat_members`. Owner/admin check exists. No per-role capabilities. | No "who can create or manage channels" control. |
| **API keys / MCP** | `workspace_api_keys.scopes` per module (`none｜view｜edit`). There is `created_by`, but the key acts **as the workspace**. | 🔴 Once private content exists, any member's key could read everyone's private notes. |
| **Seats** | Free/Pro 1 · **Duo 2** · Team ≥3 · Founder ∞ (`workspace_seat_cap`). | "Collaborative" in practice means Duo and Team. |

**Takeaway:** the three 🔴/🟠 rows are bugs whatever we decide below. They should ship first (block **PERM-0**) before Duo or Team is sold to anyone.

---

## 1a. What shipped as PERM-1/2 (2026-10-06, designer-approved model)

The designer replaced the first draft's "role ceiling + per-thing grants" settings with a **role-based + per-person** model (mockup approved 2026-10-06). It is the layer that decides **what kinds of things** someone can do; §1's per-thing sharing (which notes/buckets/calendars) still comes with PERM-3…6.

- **Roles** — per workspace. Built-in **Admin**, **Member**, **Viewer** (seeded for every workspace, names fixed, can't be deleted) plus **custom roles** (max 20). A role is a set of permission keys: `<module>.<view|create|edit|delete>` for Notes, Tasks and buckets, Calendars, Contacts, Chat, plus workspace powers `ws.invite`, `ws.manage_members`, `ws.manage_roles`, `ws.publish`, `ws.api_keys`. Create/edit/delete need View on the same module.
- **Read-only roles** (Viewer, and custom ones built on it) are a ceiling: only View survives, whatever an exception says.
- **Personal exceptions** — allow or block single keys for one person on top of their role; personal beats role. One click flips a cell, a second click resets it.
- **Owner** — always everything; never managed through this page (transfer ownership instead).
- **Guardrails** — nobody grants (by role, exception or invite) a permission they don't hold; only the owner gives or manages member/role management; nobody changes their own access or the role they hold; built-in roles keep their name and read-only flag; deleting a custom role moves its people and pending invites to a role you pick; concurrent role edits are refused with "Someone else just changed this role".
- **Enforcement** — Postgres: module read rules require View (also for spine titles, activity, comments); one write check per module table covers ops, direct writes and API keys; API keys stay capped by their creator. The UI mirrors the rules only to explain and disable.
- **Defaults** — Admin = everything; Member = full module access + publish (today's behavior); Viewer = view everything. Existing per-module settings (`permissions_notes/tasks`) became personal exceptions.

## 1. The model (one model, every module)

Three layers. Access is checked as **role ceiling ∩ grant on the thing**.

### Layer 1: Workspace role = the ceiling
| Role | Max on anything | Workspace admin powers |
| --- | --- | --- |
| Owner | Full | Everything, incl. billing, transfer, delete workspace |
| Admin | Full | Members, invites, permission settings (toggleable, see §8) |
| Member | Full on what's shared with them; can create | — |
| Viewer | **View only, always**, even if someone grants Edit | — |

### Layer 2: Grants on a *shareable thing*
Shareable things ("containers"): **note**, **bucket**, **calendar**, **contact group**, **chat channel**, (later) **mailbox**.

Each container has one creator (always Full) plus grants. A grant goes to **a person** or to **everyone in the workspace**, and has one level:

| Level | Means |
| --- | --- |
| **Can view** | See it and comment on it. Comments are cheap and expected, and Notion/Google pair view with comment. |
| **Can edit** | Create, change and delete the *items inside* (tasks in a bucket, events in a calendar, the note's content). Deleting an item is a soft delete and can be restored (DF-5 restore ops). |
| **Full access** | Edit + rename/delete the **container itself** + change who has access. |

> This maps your "read / read-write / read-write-delete" to the rule users already know from Notion and Drive. Item-level delete sits in **Edit**, because tasks and events get deleted constantly and restore covers mistakes. Container-level delete sits in **Full**, because losing a whole bucket or calendar is the scary case.
> Calendars add one level below View: **Free/busy only** (see §4).

Items inherit from their container: task → bucket, event → calendar, sub-note → parent note (unless the sub-note is shared further), message → channel. Contacts are the exception (§6).

### Layer 3: Workspace defaults (Settings)
Per module: *"New ___ are: Private · Workspace can view · Workspace can edit · Workspace full access."* This is set by owner/admins in **Settings → Members & permissions → Defaults**. The default only pre-fills the share setting when you create something. You can always change it right there.

### Solo vs collaborative vs Duo
- **Solo workspace (1 member):** no sharing UI anywhere. Everything is effectively private.
- **Duo (2 members):** same model underneath, but the UI collapses to one toggle: **"Shared with Anna"** (off / view / edit). No people picker needed.
- **Team (3+):** full share popover (people picker + "Everyone in workspace" + level).

❓ **Your call #1:** you wrote "those containing >2". **Recommendation: turn this on for ≥2 members**, so Duo is included. Duo is a paid collaborative plan, and a couple or two co-founders need private vs shared just as much.

---

## 2. Notes

**Q1. Should a new note default to public or private? If public, view / edit / edit+delete?**

**Recommendation: default = "Workspace · Can edit"**, with a one-tap **Private** toggle in the new-note header. Changeable per workspace in Settings.
- Why not private-by-default: in a shared workspace, private-by-default leads to "where's the note you mentioned?". People invited someone *in order to* share. Notion puts new pages in a shared teamspace by default too.
- Why Edit and not Full: deleting the whole note (and moving or re-sharing it) stays with the creator and Full holders, so a teammate can't make your note disappear.
- Sub-notes inherit the parent's access by default. Moving a note under a private parent asks: *"Make it private too?"*
- **Publish to web** stays as is (it's the "public link" grant). Who may publish is a workspace toggle (§8).

**Existing notes when you invite your first person.** This matters a lot, because a solo user's notes are often personal. **Recommendation:** the first invite in a workspace shows one step: *"What can Anna see of what you already have?"* → **Nothing yet (default)** / Everything (view) / Everything (edit). The workspace default then applies to new notes from that point on.

---

## 3. Tasks (buckets)

**Q2. A new bucket should let you give all workspace members view / edit / delete.**

**Yes.** A bucket is a container (§1). The create-bucket dialog gets the same share row. **Default: "Workspace · Can edit".** Full = rename, delete or re-share the bucket.

Specifics:
- **System / Inbox bucket** (`is_system`) is **always private** to each person. It's your capture inbox.
- **Assigning a task to someone who can't see its bucket:** assigning auto-grants them **Edit on that one task** (not the bucket). The picker warns: *"Anna can't see 'Finance' — she'll only see this task."* This builds on the assignee work in #208.
- Viewers can't be assignees (they can't complete tasks). They're greyed out in the picker with a tooltip.

---

## 4. Calendar

The model here follows Google Calendar's own sharing levels, because people already know them: **Free/busy only · See all details · Can edit · Full access.**

**a) Is my default calendar only mine, with no way to share it?**
No. It's **private by default, but the workspace sees free/busy** (a "Busy" block with no title). This is what makes scheduling with teammates and the Duo link (e) work. You can raise it per person or for everyone (details / edit / full), or lower it to nothing. Sharing your calendar with edit rights is a real need (an assistant, a partner).

**b) Custom calendars with per-person permissions, and merging events from your other calendars.**
- **Custom calendars: yes.** "New calendar" → name, color, share row. Examples: *Team offsites*, *Family*. The creator has Full.
- **Merging sources:** **recommend not copying events between calendars in v1.** Two-way copies cause duplicates and drift (it's the classic Reclaim/OneCal problem). Instead:
  - **v1: Calendar sets.** A saved group of calendars you view together ("Work = Google work + Team offsites + Anna's busy"). It's a view, not data.
  - **v2: Busy mirroring.** Optionally push your *other* calendars' events into a shared calendar as anonymous "Busy" blocks. One-way and private-safe.

**c) Make any calendar public.**
**Yes**, with the same publish pattern as notes: **Publish → public link + ICS feed**, level **Free/busy** or **Full details**. Unpublishing kills the link (same as `notes_archive_unpublishes`).

**d) Calendars added through integrations (Google, etc.).**
**Private by default + free/busy to the workspace**, same as (a). The owner can raise access up to **Can edit / Full**.
- When a teammate edits an event in your Google calendar, Moduo writes to Google **with your connection, on their behalf**. The activity log shows *"Anna moved 'Dentist'"*. The share dialog says this clearly.
- If you disconnect the integration, everyone loses access to it at once.
- This needs the PERM-0 fix first: today these events are readable by everyone.

**e) Duo / collective booking links: "me and my friend, one link, only slots where we're both free, both get invited and both are hosts".**
**Yes. This is a strong feature and a natural reason to buy Duo/Team.** The industry name is a **collective** booking link (Calendly "Collective", Cal.com "Collective").
- **Create:** in the booking-link editor → **Hosts: you + Anna**. Anna must **accept** being a co-host (a notification + one tap). Until then the link stays *paused*.
- **Slots:** only times when **all hosts** are free. It uses each host's free/busy, so it works even if Anna shares nothing else with you. Each host's own working hours apply.
- **Booked:** one event on the link owner's calendar, with all hosts + the guest as attendees. Everyone gets the invite. It shows on every host's Moduo calendar.
- **Video and host rights:**
  - **Moduo Meet:** every co-host is a full host (admit, record, end). It's native and free of caveats → **make it the default for collective links**. This is a selling point for `specs/moduo-meet.md`.
  - **Zoom:** co-hosts can be added as *alternative hosts* only if they're licensed users in the same Zoom account. Otherwise they join as participants.
  - **Google Meet:** the meeting belongs to the link owner's Google account. Co-hosts are invited, but there's no reliable API to make them Meet co-hosts → they join as participants, and the owner can promote them in the call.
- **Later (v2):** **Round-robin** (either host, rotate). That's for Team sales/support.
- **Plan gate:** Duo / Team / Founder.

---

## 5. Email

**Q4. Should every mailbox be shareable view / edit / delete with other members?**

**Recommendation: skip mailbox sharing for v1. You're right that the value is thin.** Shared inboxes (Front, Missive, Help Scout) are a separate product. Delegated mailbox access is rare among our users and carries heavy trust and legal weight.

What we *do* need instead:
1. **Share an email, not a mailbox.** When you link an email to a task, note or contact (the spine), people who can see that task can see **that one email** (subject, sender, snapshot). It's explicit, one-gesture, and on-brand.
2. **Fix `email_refs` visibility (PERM-0):** an email ref is visible only to its owner + people with access to something it's linked to.
3. **Post-v1, Team only:** a "Shared inbox" (support@) as its own feature, if Team customers ask for it.

---

## 6. Contacts

**Q5. Private by default? Shareable "contact groups" with permissions?**

**Yes to both.**
- **Default: private** for every contact you didn't deliberately share. Auto-captured contacts (from email, meetings) are **always** private until you act on them. Being visible to colleagues by surprise would be creepy. This also needs the PERM-0 fix.
- **Contact groups = the sharing container.** For example *"Investors"* or *"Clients – Acme"*. A group has a share row (view / edit / full). Putting a contact in a shared group makes it visible to that group's members. A contact can sit in several groups.
- **Companies** follow the same rule: visible if you own it or it's in a shared group (directly or through a shared contact).
- **Duplicates:** if you and Anna both have a private "Jan Kowalski" and one gets shared, Moduo offers **"Merge with your Jan?"** (matched by email). Each person's private notes on the contact stay private.
- Workspace setting: *"Manually added contacts default to: Private / Workspace"*. Default **Private**.

---

## 7. Chat

**Q6. Permissions to create/edit channels, a big board like Discord.**

**Recommendation: a Discord-like board, but small.** Discord has around 40 permissions plus custom roles, which is overkill at 2–20 people. v1 = a **role × capability grid** using the 4 existing roles. Each row is a checkbox per role (owner always on):

| Capability | Admin | Member | Viewer |
| --- | --- | --- | --- |
| Create public channels | ✅ | ✅ | — |
| Create private channels | ✅ | ✅ | — |
| Manage any channel (rename, archive, members) | ✅ | — | — |
| Delete others' messages | ✅ | — | — |
| @everyone / @channel mentions | ✅ | ✅ | — |
| Post in channels | ✅ | ✅ | ☐ (off by default) |
| Start calls (Moduo Meet) | ✅ | ✅ | — |

Per channel: **channel manager(s)** (the creator by default) + an optional **"Only managers can post"** for announcement channels. Private channels keep using `chat_members`.
**Custom roles** (Discord-style, e.g. "Contractors") → post-v1, Team only, if asked.

---

## 8. Settings, invites, and who can change permissions

### Settings → **Members & permissions** (owner/admin)
1. **Members:** list, role, last active, remove. This already exists, as `specs/settings-overhaul.md` §Members.
2. **Defaults for new content:** one row per module (Notes, Buckets, Calendars free/busy, Contacts, Channels).
3. **Workspace capabilities (role × capability grid):** invite people · manage members · **change permission settings** · publish to web · create shared calendars · create collective booking links · create API keys · export workspace. Chat rows from §7 live here too.
4. **Access review:** "Shared with everyone" list per module. Lets an admin answer "what can a new hire see?".

### Invites
- An invite carries a **role** (≤ the inviter's role; only the owner invites admins. Same as today).
- Optional **"Give access to…"** step: pick buckets, notes, calendars, contact groups and channels to share with the invitee on join. It writes grants on accept.
- The first invite of a workspace includes the **"existing content" step** from §2.
- Seat caps stay as they are (`workspace_seat_cap`).

### Who can edit permissions
- **Owner:** always.
- **Admins:** yes by default. The owner can turn off "Admins can change permission settings".
- Nobody can grant above their own level, or change a container's access without **Full** on it.
- Admins **cannot see private content** they weren't given (Notion's default). ❓ **Your call #2.**

### Edge cases to settle
- **Member removed:** their grants disappear. ❓ **Your call #3:** what happens to their *private* notes/buckets? Recommendation: they move to the owner as **"From Anna (archived)"**. Workspace content belongs to the workspace, and this matches Notion/Google Workspace. The alternative is delete after 30 days.
- **Role lowered to Viewer:** existing Edit grants stay stored but are capped at View. Raising the role back restores them.
- **Links to things you can't see** (the spine): show as a locked chip **"Private item"** with no title. Never leak titles through links, search, mentions, notifications, activity, or the dashboard.
- **Notifications:** never notify about something the recipient can't open.

---

## Assumptions & technical decisions (decided by research. No action needed from you)

- **One generic grants table** instead of per-module columns: `resource_grants(workspace_id, resource_type, resource_id, subject_type: member｜workspace｜public_link, subject_id, level)`. Calendars add `freebusy` to the level enum. The enum lives in `@contracts/vocabularies.ts` + a CHECK constraint (per the domain-contracts rule).
- **One check function** `can_access(resource_type, resource_id, min_level)`: SECURITY DEFINER, STABLE, applies the role ceiling + inheritance. It's used by RLS *and* by every `*_op_*`. The per-module `*_module_permission` functions shrink to "role ceiling + API-key scope".
- **API keys act as their creator** (`created_by`) ∩ their module scope. They never get more than the person sees. This is PERM-0, because it's a leak as soon as anything is private.
- **Migration:** existing multi-member workspaces get a `workspace` grant at the level that matches today's behavior (nothing disappears for anyone). `permissions_notes` / `permissions_tasks` map onto those workspace grants, then retire. **Exception:** synced calendar events and auto-captured contacts/email refs become private (that's the PERM-0 privacy fix).
- **Realtime / Yjs** note collaboration and chat realtime check `can_access` on join.
- **Search + MCP tools** filter through the same function. No module-local permission logic.
- Indexes: `(resource_type, resource_id)` and `(subject_id)`. Free/busy is computed server-side, so private event rows never reach the client.

## Execution blocks (proposed order)

| Block | What | Why this order |
| --- | --- | --- |
| **PERM-0** ✅ 2026-10-06 | Privacy fixes: calendar events/accounts, `email_refs` (+ their `entities` labels, activity, link suggestions, booking busy time) → owner-only; API keys act as creator. *Contacts moved to PERM-6: there's no email auto-capture yet, but booking-public creates a contact for each booker, visible workspace-wide.* | Leaks exist today. Ship before Duo/Team marketing |
| **PERM-1** ✅ 2026-10-06 | Roles + personal exceptions enforced in Postgres (see §1a) | Foundation for everything else |
| **PERM-2** ✅ 2026-10-06 | Settings → Members and access: roles editor, person editor with exceptions + plain-language explanations, invites by role | The control surface |
| **PERM-2b** | Workspace defaults for new things + first-invite "existing content" step + invite "give access to…" (needs PERM-3…6's per-thing grants) | Deferred: nothing to grant on yet |
| **PERM-3** | Notes share popover + private toggle + inheritance + locked "Private item" chips across the spine | Highest daily value |
| **PERM-4** | Buckets sharing + assignee auto-grant | |
| **PERM-5** | Calendars: custom calendars, sharing levels incl. free/busy, publish/ICS, calendar sets | |
| **PERM-6** | Contact groups + merge-on-share | |
| **PERM-7** | Chat capability grid + channel managers + announcement mode | |
| **PERM-8** | Collective (Duo) booking links + Moduo Meet co-hosts | Needs PERM-5 free/busy |
| *later* | Busy mirroring · round-robin · custom roles · shared inbox | Post-v1 |

## Out of scope (v1)
Mailbox sharing / shared inboxes · custom roles · cross-workspace sharing (guests outside the workspace, except public links) · per-field permissions · two-way calendar merging.

## Open questions — resolved 2026-10-06 (designer)
1. Sharing turns on at **≥2 members (Duo included)**.
2. New notes default **Workspace · Can edit** (+ first-invite "existing content" step defaulting to *Nothing yet*).
3. Admins **cannot** see members' private content.
4. A removed member's private items → **owner archive** ("From <name> (archived)").
5. Viewers **cannot** post in chat by default.
6. Collective booking links: **workspace members only** in v1.
