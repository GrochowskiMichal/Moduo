# Manual test checklist — PERM-0 + PERM-1/2 (permissions: privacy, roles, exceptions, Members and access)

Branches: `t/mike/perm-0-privacy`, `t/mike/perm-roles` · Spec: [specs/permissions.md](../../specs/permissions.md) §1a
Needs **two accounts in one workspace** (owner + one invited person). A third is useful for admin-vs-admin checks.

## Members and access page (web + desktop ≥ 1.0.10)
- [ ] Settings → Workspace group shows **Members and access** → opens a two-pane page: Roles, People, Invite people on the left. **(both)**
- [ ] Owner row shows "Owner" and a full grid; it can't be changed. **(both)**
- [ ] Roles list shows Admin, Member, Viewer (Viewer has a lock); counts don't include the owner. **(both)**
- [ ] Open **Member** → change a cell → a "Unsaved changes · Applies to N people" bar appears → **Discard** restores it; **Save changes** persists after reload. **(web)**
- [ ] Untick **View** on a module in a role → Create/Edit/Delete on that row clear; tick **Edit** on a module without View → View turns on too. **(web)**
- [ ] **New role** → name it "Contractor", tick Tasks view/create/edit → Save → it appears in the list; duplicate name ("member") is refused with a message. **(web)**
- [ ] **Read-only role** switch on a custom role → only View cells stay; other cells show a lock. **(web)**
- [ ] Delete a custom role that someone has → dialog asks where to move them → they end up on the picked role with their exceptions kept. **(web)**

## Person editor
- [ ] Click a person → their role in the top-right dropdown + the grid of what they can do. Hovering a cell explains it ("Anna can't delete tasks: blocked for Anna personally, though Member can."). **(web)**
- [ ] Click a ✓ cell → it turns into a red **−** (blocked for them); click again → back to the role. Click an empty power (e.g. Invite people) → green **+**. Save → the rail shows "N exc.". **(web)**
- [ ] **Reset to role** clears all exceptions (then Save). **(web)**
- [ ] Changing their role keeps exceptions; the save bar says "moves to X, keeping their exceptions". **(web)**
- [ ] Switching to another person with unsaved changes asks "Discard unsaved changes?". **(web)**
- [ ] Your own row is read-only ("This is your access…"). **(web)**
- [ ] **Make owner** (owner only) → confirm → they're owner, you're Admin. **(web)**
- [ ] **Remove from workspace** → confirm → they disappear. **(web)**

## Enforcement (as the invited person)
- [ ] Owner blocks your **Notes → View** → reload → Notes tab and Notes search results / link titles / activity about notes are gone. **(both)**
- [ ] Owner blocks your **Tasks → Delete** → deleting a task shows "Your role can't delete tasks in this workspace." **(web)**
- [ ] As **Viewer**: everything is read-only; posting in Chat is refused; publishing a note isn't offered. **(web)**
- [ ] As **Member** without the "API keys" power: Settings → API keys says only owners/admins manage keys; with an exception allowing it, the key controls appear. **(web)**
- [ ] Owner removes **Publish to the web** from Member → the note Publish control is gone for members. **(web)**

## Guardrails (as an Admin, not owner)
- [ ] Admin can't open other admins' or the owner's access (read-only with a reason). **(web)**
- [ ] Admin can't give anyone "Manage members"/"Manage roles" (cells disabled with a tooltip; server refuses too). **(web)**
- [ ] Admin can't edit the Admin role or a role that holds management powers (read-only with a reason). **(web)**
- [ ] Invite role dropdown greys out roles with permissions the admin doesn't have. **(web)**

## Invites
- [ ] Invite people → email + role → **Create invite** → link shown with Copy. Invalid email / duplicate pending invite show inline errors. **(web)**
- [ ] Change a pending invite's role in the list → the person joins with that role. **(web)**
- [ ] Revoke an invite → it leaves the list. **(web)**

## Privacy (PERM-0)
- [ ] Person B sees none of A's calendar events, calendar accounts, or linked email subjects (search, links show "Private item"). **(both)**
- [ ] A's booking link slots ignore B's events. **(web)**

## Known gaps
- Live UI pass was done in Storybook with mocked data (sign-in needs an emailed code); the database rules were verified on a throwaway Postgres and with rolled-back probes on the hosted project.
- A role with Create but not Edit still sees edit/delete buttons in module pages; the server refuses with a clear message. Finer button gating is a follow-up.
- Desktop ≤ 1.0.9 shows the old settings UI; the server enforces the new rules for it.
