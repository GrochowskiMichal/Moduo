# Chat v2 — what it asks of other modules

The cross-module proposals from the Chat re-plan ([REPLAN.md](./REPLAN.md) §9 step 4), one section per owner. Each line names the Chat call Maciej decided, what it asks of the other module, and who decides that module's side. Written 2026-10-13, after group L.

**The boundary (fixed by Maciej before the re-plan):** a discussion about an item lives on the item, as comments with reactions; Chat owns conversations; both link through RF-1 references; "Create task from message" goes through TV-U14's capture. Everything below stays inside that boundary.

## To Tasks v3 (delivered)

Written into the 🟠 box of `specs/BUILD_ORDER.md` on the integration branch as **"From the Chat re-plan"** (commits `5b31a723`, `c99968c4`; Maciej's permission, CH72), with pointers on the TV-H1 and TV-U16 rows. Requirements only:

- **TV-H1:** one "Team" widget with Chat's "now" line above Tasks' load (CH70).
- **TV-U16:** the project overview and the client's hub show the linked conversation (CH11) and its decisions (CH13, CH52), only to people who can read that conversation.
- **TV-D16:** Chat's MCP tools use its key and "via <key>" surface; keep that surface module-neutral.
- **App-wide:** past dates "Today · Yesterday · Mon · Oct 9 · Oct 9, 2025" (CH29c, rule 41); a saved status in the assign picker (CH28d); moved messages keep "Moved from Acme · Oct 12" in a task's comments (CH30d).
- **Built blocks Chat extends in its own blocks:** comment reactions widen beyond six (CH16a, CH49); the notification generator gets Chat's rows and push at once (TV-D12); quiet hours join Time & region (CH41); a "focusing now" read for teammates (CH42, CH47).

## To the Notes re-plan (`t/maciej/notes-replan`)

1. **Comment reactions are not six fixed words any more** (CH16a, CH49, decided). Comments on notes, tasks and messages use one reaction component: your own quick row (configurable, CH16a), any emoji, and the workspace's custom emoji (CH16b). Notes' §1 currently adopts "six fixed reactions that never notify" from TV-U13; whether they notify stays Notes' call (in Chat, reactions never notify).
2. **"Mentioned in" on a note** (CH11, decided as a proposal): a message that mentions a note leaves one quiet line in the note's Linked, "Mentioned in Acme · Oct 12" (one line per conversation, not per message), seen only by people who can read that conversation. Notes decides whether and where it shows.
3. **"Make a note" from messages** (CH30d tidy-up, decided for Chat's side): select messages → "Make a note" creates a note with the messages quoted, their authors and times, and a reference back to the conversation; the note is filed like any capture (TV-U14). Notes decides the note's template and where it lands.
4. **Decisions** (CH13, CH52): a message marked as a decision that mentions a note shows on that note ("Decided with Mike · Oct 12: …") to people who can read the conversation. Notes decides whether notes carry a decisions line.
5. **A note shared in a conversation** shows as a reference card (RF-1); "Discuss in chat" stays out of both modules (Notes §1 already says so; Chat agrees, CH11).
6. **Past dates** (CH29c, app-wide): "Today · Yesterday · Mon · Oct 9 · Oct 9, 2025" for "Edited …" and comment times, never "2 hours ago".
7. **Quiet hours** (CH41) live in Time & region and hold every module's notices, so a note `@mention` waits in Catch up during quiet hours like a chat one.
- **48a:** anyone using notes with a team: their mentions, decisions and quick reactions read the same everywhere.

## To the Calendar re-plan (`t/maciej/calendar-replan`)

1. **`/event` in a message** (CH14) creates an event linked to the conversation (an RF-1 reference both ways); Calendar's side is the ordinary reference card and preview, nothing new.
2. **Quiet hours** (CH41) join the Time & region store and hold every module's notices, event reminders included unless Calendar decides a reminder you set yourself breaks through. Calendar's call.
3. **Past dates** (CH29c) as above, for any "last edited" or history line in Calendar.

## To the hackathon readiness plan (`t/maciej/hackathon-plan`)

1. **No event workspace** (CH22): each team gets its own workspace on a Team plan handed out by the organizers.
2. **The grant** (CH67, decided): a dated Team plan on each team's workspace (seats for the whole team, chat, Team's file limits). At its end everything stays readable, chat pauses (CH4a) and no one new can be invited. It should use the same grant mechanism as founder grants (TX-9b, not built).
3. **If the date comes early** (CH68): notices only from an open desktop app or browser tab, and files as task attachments or links, until server push and Chat's files land.
4. **Event news** (CH69): outside Moduo for the first event (organizers' email, venue screens); Chat builds nothing for it.
5. **Capacity** (CH31): Chat's spike 3, a 100-client realtime load test on the local stack, runs before the event; move to Supabase Pro if the expected peak is above ~150 simultaneous connections (Free allows 200).
6. **Languages** (CH20): about 100 people, Polish and English speakers; the app stays in English.
- **48a:** the grant mechanism is the same one any comped or founder workspace uses.

## Answers received

- **Notes (2026-10-13, Notes call N19, `.design/notes-v2/REPLAN.md` §1.6 on `t/maciej/notes-replan`, recommended to Maciej in its round 1):** items 1, 6 and 7 adopted. "Mentioned in" (2) and decisions (4) recommended as quiet lines in a note's Details → Linked, visible only to readers of the conversation. "Make a note" (3) lands in the person's Notes Inbox (private until filed), quoting the messages with authors and times, titled with the conversation's name and date.
- **A boundary Notes asked Chat to record:** dated announcements to everyone ("deadline moved to 2 PM") are Chat's, as a post in an announcement conversation; Notes only marks an edited note "Changed since you last read" and sends no notice for edits. **Chat's side:** inside one workspace that is an announcement channel (CH23a: only managers post, each post pings everyone once). Across the hackathon's team workspaces there is no shared conversation (CH22), and organizer news stays outside Moduo for the first event (CH69), so neither module carries it there.
