# Manual test checklist — Tasks v3 polish batch 2

> Generated 2026-10-14 · branch `t/maciej/tv-polish-2` · **Live-verified:** yes: every item below ran in the real app on the local stack (headless Chromium, 1440×900, dark), as `dev@moduo.local` in *Overview check (TV-U16)*; the new person's first open as `newbie@moduo.local` in a fresh workspace. The ⌥←/→ toast on a mixed selection, the Move toast and the teaching-task rules are covered by unit tests. What's still deferred: [tasks-v3-polish-deferred.md](./tasks-v3-polish-deferred.md).
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## The walkthrough's seven
- [ ] **Do:** open Home with a few tasks due in the coming days → **Expect:** the Upcoming widget lists every day that fits its height (Tomorrow, Fri, Later…), and "+n more" only when they don't fit _(web)_
- [ ] **Do:** when it shows, click "+n more" → **Expect:** Tasks opens on **Upcoming**, not where you last were _(web)_
- [ ] **Do:** Tasks → All → Timeline; hover a task's point until "Due …" shows, then drag it → **Expect:** only the drag's own date label beside the point, no old "Due …" label; Esc puts it back _(web)_
- [ ] **Do:** pick Quarter, press Today, then pick Month → **Expect:** Today stays where it was on screen (about a quarter across), not off the left edge _(web)_
- [ ] **Do:** open Hackathon kit and set the panel (title-row ▾) to Project → **Expect:** the Client row is one line: the client chip (its name shortened if long) and the pencil beside it _(web)_
- [ ] **Do:** open *Homepage hero copy* (imported) → **Expect:** its description reads "• short" / "• long", and clicking in and out of it saves nothing _(web)_
- [ ] **Do:** ⌘⇧K, type a long title ending in `#Urg` → **Expect:** the tag suggestions stay inside the capture dialog's right edge _(web)_
- [ ] **Do:** in a private window, sign in as a new person and open Tasks (the teaching tasks appear) → **Expect:** the console shows no failed reads for comments, files or links _(web)_

## From the deferred list
- [ ] **Do:** Settings → Storage, click a file's task name → **Expect:** Settings closes and that task opens in Tasks _(web)_
- [ ] **Do:** on a Board, select three cards (⌘A or ⌘-click) and drag one → **Expect:** the drag preview says "+2" _(web)_
- [ ] **Do:** on the Timeline at Month, scroll right until only the last day or two of a month is left under the name column → **Expect:** that month's name disappears instead of showing "…ber" _(web)_
- [ ] **Do:** select tasks of your own and of a project shared with you view-only, press ⌥→ → **Expect:** only yours move; the toast ends "· n not yours to move" (⇧D the same) _(web, two accounts)_
- [ ] **Do:** archive a project with open tasks and choose Move → **Expect:** the "archived" toast appears once the tasks have moved; if the move is refused, only the error shows _(web)_
- [ ] **Do:** import a Trello board whose cards name members missing from its member list → **Expect:** the preview lists "Trello member 1", "Trello member 2"…, one picker each _(web)_

## Built app
- [ ] **Do:** open the deployed app with the console open → **Expect:** no "Failed to load module script … MIME type text/html" on load _(web, staging)_
