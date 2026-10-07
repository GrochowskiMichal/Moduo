# Manual test checklist — permissions sharing

> Generated 2026-10-06 · branch `t/mike/perm-sharing` · **Live-verified:** the sharing SQL is on the hosted Moduo database (2026-10-06). The app itself was not clicked through.
> Run top-to-bottom. Each item is a step → what you should see → where. Reload the app first.

## Notes
- [ ] **Do:** Open a note in a workspace that still has only you. → **Expect:** no Share control. _(web)_
- [ ] **Do:** Invite a second person, accept, then open a note and choose Share → Private. → **Expect:** the other person sees "Private item" anywhere that note's title would have shown (search, mentions, activity). _(web)_
- [ ] **Do:** Create a new note after the second person has joined, without touching Share. → **Expect:** they can open and edit it (Workspace · Can edit). _(web)_
- [ ] **Do:** Drag a shared note onto a private note and confirm "Make it private too?" → **Expect:** OK makes the dragged note private; Cancel still moves it and keeps its sharing. _(web)_

## Tasks
- [ ] **Do:** Open the bucket menu on a normal list (not Inbox) and choose Share. → **Expect:** the same people / workspace levels as a note. _(web)_
- [ ] **Do:** Assign a task to a viewer. → **Expect:** they are disabled ("view only") and cannot be picked. _(web)_
- [ ] **Do:** Assign a task in a private bucket to someone who cannot see that bucket. → **Expect:** a warning, then they get the task itself (not the rest of the bucket). _(web)_
- [ ] **Do:** As two people, each open Tasks. → **Expect:** each has their own Inbox. The other person's Inbox tasks are not listed. _(web)_

## Calendars
- [ ] **Do:** In the calendar rail, add a calendar, check it, name a set, and save. Click the set name. → **Expect:** the grid shows the connected accounts in that set. _(web)_
- [ ] **Do:** Share a calendar as Busy only with a teammate. → **Expect:** they see "Busy" blocks, not titles. _(web)_
- [ ] **Do:** Share as Can view. → **Expect:** they see titles. They still cannot change a Google or Outlook event. _(web)_
- [ ] **Do:** On your own Moduo or custom calendar, copy the Busy link. → **Expect:** the clipboard has an `.ics` address. _(web)_

## Contacts
- [ ] **Do:** Create a contact after the migration. → **Expect:** a teammate does not see it until you share it or put it in a group they can see. _(web)_
- [ ] **Do:** Book a meeting on someone's link. → **Expect:** the contact created for the guest stays with the host, not the whole workspace. _(web)_
- [ ] **Do:** When a shared contact matches one of yours by email, use Merge. → **Expect:** one contact remains and the duplicate is gone. _(web)_

## Chat and access
- [ ] **Do:** Settings → Members and access → Defaults. Change Notes to Can view, then create a note. → **Expect:** a teammate can read the new note and cannot edit it. _(web)_
- [ ] **Do:** Settings → Chat. Turn off posting for Member, then try to send as that person. → **Expect:** the send is refused. A viewer already cannot post. _(web)_
- [ ] **Do:** Create a channel with "Only managers can post" and send as someone who isn't a manager. → **Expect:** the message is refused. _(web)_
- [ ] **Do:** Invite the first teammate and leave "What can they see…" on Nothing yet. → **Expect:** they do not see notes you made while you were alone. Switch the choice to Can edit and expect those notes to open. _(web)_

## Booking
- [ ] **Do:** Edit a booking link. → **Expect:** no "Also book with" co-host picker (hidden until PERM-8b); saving and renaming work and never pause the link. _(web)_

## Migrations / data
- [ ] **Do:** Reload the app, then open Share on a note in a workspace with two people. → **Expect:** Share opens without an error, and notes, lists, and contacts that were already shared are still there. _(web)_

## Known gaps / not-yet-testable
- The database is live and verified with real-account probes (task edit/create/delete, bucket create, live note save, member access). The new screens have not been clicked through signed in.
- Invite "give access to…" can be stored on the invite (`share_payload.resources`) but the invite form only asks about existing content as a whole.
- Sharing a Google or Outlook calendar does not let a teammate edit it in Google. Can edit applies to Moduo and custom calendars.
- Collective (co-host) links and the contact group/merge bar are hidden until PERM-8b / PERM-6b. Moduo Meet is not built.
- Before shipping, production writes were broken for ~40 min by the sharing migration (fixed by `20261006230000`). Check that notes typed between 20:37 and 21:15 UTC on 2026-10-06 were saved.
- Email is unchanged: a teammate still sees "Private item" for a linked message.
- `bun run verify`'s Biome check still reports error-level issues in landing HTML that this session did not touch. Typecheck, Tailwind lint, CSS lint, and the unit tests pass.
