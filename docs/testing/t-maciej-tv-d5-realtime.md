# Manual test checklist — TV-D5 Live updates (Realtime)

> Generated 2026-10-09 · branch `t/maciej/tv-d5-realtime` · **Live-verified: partly.** The production database side was checked: the publication lists the 6 tables, and the `updated_at` trigger is on tasks, buckets and tags (a rolled-back write showed the server's time). The app side is proven by tests against a faked socket (`live.test.ts`, `realtime.test.ts`, `use-tasks-module.live.test.ts`, `tags/store.live.test.ts`). Nobody has opened two real sessions yet: the agent can't sign in to the hosted project.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

Setup: two sessions on the same workspace. The best setup is two members. One person in two browsers (or the web app plus desktop) also works for everything except claims. Open Tasks in both, side by side. Call them **A** and **B**.

## Teammates' changes show up without reloading (D5-1)
- [ ] **Do:** In B, create a task in Inbox → **Expect:** it appears in A's list within ~2 s, with no reload. _(both)_
- [ ] **Do:** In B, rename that task, then change its priority and its due date → **Expect:** each change shows in A within ~2 s; A's detail panel, if open on it, updates too. _(both)_
- [ ] **Do:** In B, mark it done → **Expect:** A shows it done (or hides it if A hides completed). _(both)_
- [ ] **Do:** In B, delete it → **Expect:** it leaves A's list within ~2 s. Undo in B → it comes back in A. _(both)_
- [ ] **Do:** In B, create a bucket, rename it, give it a group → **Expect:** A's sidebar follows each change. _(both)_
- [ ] **Do:** In B, add a tag to a task, recolour the tag, then remove it → **Expect:** A's row pills follow each change. The tag also updates on a note or contact that carries it. _(both)_
- [ ] **Do:** (two members) B queues a task A can see → **Expect:** A's row shows B's ringed avatar ("In B's queue") within ~2 s; when B removes it, the avatar goes. _(both)_

## Your own edits never flicker back (D5-2)
- [ ] **Do:** In A, type a title quickly, Enter, then rename again straight away; repeat a few times → **Expect:** the title never jumps back to an earlier version. _(both)_
- [ ] **Do:** In A, toggle a task done/undone fast five times → **Expect:** it ends in the state you left it; no bounce after a second. _(both)_
- [ ] **Do:** In A, toggle a tag on and off on a task several times → **Expect:** the pill ends where you left it and doesn't reappear a second later. _(both)_
- [ ] **Do:** In A, run Focus on a task for a few minutes (time flushes) → **Expect:** "time spent" only ever grows; it never dips back. _(both)_
- [ ] **Do:** Set A's computer clock 2 minutes fast, then B marks a task done that A recently edited → **Expect:** A still shows B's change; the server time stamps every save now. _(desktop)_

## Coming back and reconnecting (D5-3)
- [ ] **Do:** Turn A's network off, make changes in B, turn A's network back on → **Expect:** A catches up within a few seconds, with no reload and no loading flash. _(both)_
- [ ] **Do:** Hide A's tab (or minimise the desktop app), change things in B, come back to A → **Expect:** A shows the changes right away; the list doesn't blank or flash a spinner. _(both)_
- [ ] **Do:** Switch to A and away repeatedly → **Expect:** no visible flicker. (In the network tab, at most one reload of the task list per 5 s.) _(web)_
- [ ] **Do:** In A, complete a task that's in your Queue, switch away and back → **Expect:** it still shows done in place in the Queue until a full reload (TV-D4 behaviour kept). _(both)_
- [ ] **Do:** Then, in B, reopen that task → **Expect:** it leaves A's Queue (it's no longer queued) instead of showing there as open. _(both)_

## Edge cases
- [ ] **Do:** Switch A to another workspace while B keeps editing the first → **Expect:** nothing from the first workspace appears in A's second workspace. _(both)_
- [ ] **Do:** In A, delete a tag and wait for the Undo toast; meanwhile B renames that tag; then Undo in A → **Expect:** the tag comes back in A, showing B's new name within a few seconds. _(both)_
- [ ] **Do:** In B, move a task into a bucket A can't see (sharing) → **Expect:** A keeps showing it until A's next refetch (come back to the window), then it disappears. That delay is a known limit. _(web)_

## Migrations / data
- [ ] **Do:** In the Supabase dashboard → Database → Publications → `supabase_realtime` → **Expect:** buckets, comments, tag_links, tags, task_queue, tasks (plus the 3 chat tables). _(—)_
- [ ] **Do:** Edit a task title in the Table editor, setting `updated_at` to a time in the future → **Expect:** the saved `updated_at` is "now" (the `zz_stamp_updated_at` trigger). _(—)_

## Known gaps / not-yet-testable
- **No two-session live run yet:** the agent can't sign in to the hosted project, so the D5-1 and D5-3 checks above are the first end-to-end run over a real socket.
- **Comment counts (D5-1) aren't live:** `comments` is published, but nothing shows a comment count yet; TV-U3 adds the listener.
- **Attachments aren't published yet:** their table arrived with AT-1, after the publication migration; AT-2 adds it.
- **A row that stops being visible to you** (unshared, or moved where you can't see it) sends no live change, so it stays until the next refetch.

---
*Convention defined in [AGENTS.md](../../AGENTS.md) → "Working posture" (Wrap). One file per sprint/branch so history is preserved.*
