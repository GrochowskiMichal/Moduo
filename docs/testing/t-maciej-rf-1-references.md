# Manual test checklist — RF-1 References (tasks-v3 block 18)

> Generated 2026-10-10 · branch `t/maciej/rf-1-references` → `t/maciej/tasks-v3-build` (local build mode) · **Live-verified:** yes, on the local stack (web, `rsbuild dev` on :8139, signed in as `dev@moduo.local`): a description's chip, its hover card (MOD-561 · project · due · 1/3 · assignee · Show as), a click opening "← Collect brand assets from client" with "Open in Tasks" and back to Details; `@` inserting a card alone on a line with "Show as"; `/tom` → a "Tomorrow" date chip; `#d` → the `#design` link; a typed `MOD-561` turning into a chip; `/Order frames rf1` → "New task “Order frames rf1”" created in the same project and inserted; a comment with `@brand` + `/tom` storing `moduo://task/…` and `moduo://date/…` (no title) and rendering a chip and a date chip; the stored description holding no titles. E2E `tests/references.spec.ts` 3/3 (click opens "← item" and back; a teammate reads "Private item" with the title nowhere on the page; `?id=MOD-n` opens its task). Not live-checked: Notes inserting through its own `/` menu (its chips render through the same node; see Known gaps).
> No migrations. Reads: `runtime.spine.previews` (module tables under RLS = `can_access`).

## The four forms (task, in a description)
- [ ] **Do:** in a task's description type `Chase @coll` and pick a task → **Expect:** a chip "○ Title · Fri" (status icon, the title, the due day; a long title truncates first, the chip never runs past the panel) _(both)_
- [ ] **Do:** on an empty line type `@` and pick a task → **Expect:** a card (status circle that completes · title · MOD-142 · Project › … · due · n/m · assignee avatar) and a new line under it; "Show as: Link · Chip · Card" appears under it until you type _(both)_
- [ ] **Do:** pick Link, then Chip, then Card in "Show as" → **Expect:** the reference changes form in place; leave and reopen the task: the form stuck _(both)_
- [ ] **Do:** hover a chip or a link for about half a second → **Expect:** the card as a preview (it loads its facts then, not before); with the description editable it has "Show as" at the bottom _(web; desktop has hover too)_
- [ ] **Do:** hover a card in an editable description → **Expect:** a ⋯ at its top right with Show as · Link · Chip · Card _(both)_
- [ ] **Do:** tick the circle on a task card → **Expect:** the task completes (its row in the list too); tick again to reopen _(both)_

## Opening
- [ ] **Do:** click a task chip in the open task's description → **Expect:** the panel's title row reads "← <that task>" with "Open in Tasks" at the right; its details below _(both)_
- [ ] **Do:** click a chip inside that stacked task, then the back arrow twice (or Esc twice) → **Expect:** one item back each time, then "Details" _(both)_
- [ ] **Do:** ⌘-click a chip (Ctrl-click on Windows) → **Expect:** the item opens full: a task selects in the list, a note opens in Notes, an event in Calendar _(both)_
- [ ] **Do:** click a note, contact or event reference → **Expect:** "← <its title>" with its card and "Open in Notes" (Contacts, Calendar) _(both)_
- [ ] **Do:** select another task in the list while an item is stacked → **Expect:** the stack clears; Details shows the new task _(both)_

## Live, deleted, private
- [ ] **Do:** with a chip on screen, rename or complete the referenced task in another window (or as a teammate) → **Expect:** the chip's title and status icon change in place within a second or two, no flash _(both)_
- [ ] **Do:** delete the referenced task → **Expect:** "Deleted task" in tertiary text, no title, not struck through; Undo → the live chip comes back _(both)_
- [ ] **Do:** as the teammate (`teammate@moduo.local`), open a shared task whose description references a task in the dev's private project → **Expect:** "🔒 Private item": no title, no type icon, no hover, no click; View source / devtools: the title isn't anywhere in the page _(both)_
- [ ] **Do:** as the dev, comment on a shared task mentioning (`@`) a private task, with the teammate @mentioned → **Expect:** the teammate's bell reads "… commented: “… Private item …”"; the dev's own view shows the title _(both)_

## The grammar in prose (`@` `#` `/`)
- [ ] **Do:** type `/` in a description → **Expect:** Today · Tomorrow · Next week · Date… first, then projects and other things; `/tom` narrows to Tomorrow _(both)_
- [ ] **Do:** pick Tomorrow → **Expect:** a date chip reading "Tomorrow" (hover: the full date); after midnight it reads "Tomorrow" no more, the plain date instead _(both)_
- [ ] **Do:** pick Date… → **Expect:** a calendar where the menu was; a day inserts its chip; Esc closes it and keeps the caret _(both)_
- [ ] **Do:** type `/Order frames from printer` (no match) → **Expect:** "New task “Order frames from printer”"; Enter creates it in the open task's project and inserts its chip _(both)_
- [ ] **Do:** type `#des` → **Expect:** the workspace's tags; picking one inserts `#design` with its colour dot; the task's own Tags field doesn't change _(both)_
- [ ] **Do:** type `C#`, `and/or`, `7/11`, an email address → **Expect:** no menu; they stay text _(both)_
- [ ] **Do:** type `MOD-142 ` (your workspace key, a task you can see) → **Expect:** it turns into that task's chip; ⌘Z puts the words back; `UTF-8` stays text _(both)_

## Comments
- [ ] **Do:** in a task's comment box type `@` + a few letters of a task → **Expect:** people first, then things; pick a thing → `@Title` in the box _(both)_
- [ ] **Do:** add `/tom`, pick Tomorrow, post with ⌘↵ → **Expect:** the comment shows the task as a chip and a "Tomorrow" date chip _(both)_
- [ ] **Do:** type a handle (`MOD-142`) in a comment and post → **Expect:** it reads as a chip for anyone who can see that task, as plain text for anyone who can't _(both)_

## Deep links
- [ ] **Do:** open `/tasks?id=MOD-142` (your key) → **Expect:** that task opens; the address becomes `?id=<its id>` _(web)_
- [ ] **Do:** open a handle with an old key (after changing the key in Settings → Workspace) → **Expect:** the same task opens _(web)_
- [ ] **Do:** open `?id=` with the handle of a task you can't see → **Expect:** "Private item" in the panel, with a way back _(web)_

## Capture and search (the one tokenizer)
- [ ] **Do:** ⌘⇧K, type `Send report /tomorrow`, ⏎ → **Expect:** "Send report" due tomorrow (the command left the title) _(both)_
- [ ] **Do:** in Tasks' search box type `#design ` → **Expect:** it still becomes a Tag filter chip (TV-U2), `#123 ` stays text _(both)_
- [ ] **Do:** search Tasks for a word that only appears in an old description chip's title → **Expect:** no match (references aren't searchable text) _(both)_

## Other surfaces that share the editor or the node
- [ ] **Do:** a calendar event's notes: `@`, `/tomorrow`, `#tag` → **Expect:** the same references, dates and tags; read-only viewers see them through the reader _(both)_
- [ ] **Do:** compose an email, `/` or `@` a task, send to yourself → **Expect:** the sent mail reads the task's title as plain text (no Moduo ids in the HTML) _(desktop)_
- [ ] **Do:** open a note with an existing entity chip (`/task`, `/note` in Notes) → **Expect:** it renders through the Reference: live title, "Private item" for a teammate who can't see the item, hover preview _(both)_

## Edge cases
- [ ] **Do:** a reference to a deleted contact or event, as its owner → **Expect:** "Private item" (known gap: the server hides deleted contacts/events from everyone; see below) _(both)_
- [ ] **Do:** go offline, open a task with references → **Expect:** "Unavailable" for references whose facts never loaded; cached ones keep showing _(both)_

## Known gaps / not-yet-testable
- **Deleted contacts and events read "Private item", not "Deleted contact/event", even for their owner:** `can_access('contact'|'event')` filters `deleted_at`, so neither the table nor the registry answers for them. Fixing it needs a server change (a reference read that answers "deleted" for rows you could see before they were deleted). Tasks and notes tombstone correctly.
- **No Realtime for notes, events, contacts, emails:** their references refresh when the window comes back and when an answer is five minutes old. Adding them (or `entities`) to `supabase_realtime` is a migration (data lane).
- **`@person` in a description doesn't notify yet:** a description has no server op to notify; the §13 table's "`@you` in a comment or description" lands with TV-D12's notification generator. Comments notify as before.
- **Contact cards show role · company and email:** "last contact" and "open tasks" need per-contact rollups (an N fan-out); left for the Contacts rebuild.
- **Email cards:** no message count yet (one ref per message today).
- **Project cards:** progress only; status, target and lead arrive with TV-D10's project fields; no project colours until TV-U6.
- **Tag links don't navigate:** there is no tag page yet ("Mentioned in" lives there, 2026-10-08).
- **Older stored chips keep their title in the stored HTML** until the description is next edited (the DOM, search and MCP's own reads of references never show it).
- **Verify before release:** an older desktop build reading a description with new references shows the type's word ("task") in a chip; the Notes `/` menu inserting a chip (Notes is a host, not rebuilt).

---
*Convention defined in [AGENTS.md](../../AGENTS.md) → "Working posture" (Wrap). One file per sprint/branch so history is preserved.*
