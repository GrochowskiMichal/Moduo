# Manual test checklist — DF-1 (deep-link selection: Tasks)

> Generated 2026-07-10 · branch `t/maciej/df-1-task-deep-link` · **Live-verified:** yes (hosted test account, web) — every check below was driven end-to-end via the browser except where "Known gaps" says otherwise.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

## Dashboard → Tasks click-through (the headline fix)
- [ ] **Do:** On Home, in the **Tasks** widget click a row that is NOT the first task (e.g. the 2nd/3rd) → **Expect:** land on `/tasks` with **that exact task selected** and its detail panel open — not a different task, not the last selection. URL shows `?id=<that task>`. _(both)_
- [ ] **Do:** Click a task row in the **Recently-linked** or **Activity-feed** widget → **Expect:** same — the named task lands selected. _(both)_
- [ ] **Do:** After landing, **refresh** the page → **Expect:** the same task is still selected (URL `?id=` survives); your mode (Plan/Focus) and any tag filter are unchanged. _(both)_

## In-app deep links
- [ ] **Do:** In a note, click a `/task` chip (a linked task line) → **Expect:** `/tasks` opens with that task selected + scrolled into view. _(both)_
- [ ] **Do:** From a contact hub, click a task in the "Open work" rollup → **Expect:** that task lands selected. _(both)_
- [ ] **Do:** Open the **notifications** bell, click a card whose target is a task → **Expect:** `/tasks` opens with **that task selected** (previously landed unselected — this was a second id-drop site fixed in DF-1). _(both)_

## Selection ⇄ URL sync
- [ ] **Do:** On `/tasks`, click different task rows → **Expect:** the URL `?id=` updates to the clicked task (settles ~¼s after you stop). _(both)_
- [ ] **Do:** Hold **j** / **k** to scroll the list cursor fast → **Expect:** the cursor moves smoothly; the URL updates only when you pause (no per-keystroke churn, no errors). _(both — the throttle it guards against only bites the desktop webview)_
- [ ] **Do:** Deep-link to a task, then press **back** → **Expect:** you leave `/tasks` (the cursor history isn't walked step-by-step). _(both)_

## Scope / grouping reveal
- [ ] **Do:** Deep-link to a task that lives in a **different bucket** than the one currently shown → **Expect:** the rail scope snaps to that task's bucket and the task is selected. _(both)_
- [ ] **Do:** Deep-link to a **subtask** (nested under a parent) → **Expect:** the parent auto-expands and the subtask is selected + scrolled to. _(both)_
- [ ] **Do:** Deep-link to a task whose **tag** is filtered out by an active tag filter → **Expect:** the filter clears so the task is visible + selected. _(both)_
- [ ] **Do:** In **All** view grouped by bucket, collapse the group holding the current selection, then deep-link to a task inside a collapsed group → **Expect:** only that group re-expands, and the target is selected. _(both)_
- [ ] **Do:** Switch your Tasks view to **Timeline**, then follow a task deep link → **Expect:** mode snaps to Plan, the task's bar is selected AND scrolled into view (horizontally too). _(both)_

## Edge cases (graceful degrade — no crash)
- [ ] **Do:** Manually visit `/tasks?id=deadbeef-not-a-real-id` (or follow a link to a since-deleted task) → **Expect:** the page loads normally, the bogus id is stripped from the URL, and a real task (the default) is selected — no error screen. _(both)_
- [ ] **Do:** Deep-link to a task that has since been **archived** → **Expect:** same graceful degrade (archived tasks are invisible in every scope, so it clears quietly rather than selecting a random replacement). _(both)_
- [ ] **Do:** Deep-link to a **project/bucket** (a `project`-typed rollup row) → **Expect:** the rail scopes to that bucket (no phantom task selection carried over from the previous scope). _(both)_

## Regression guards (things DF-1 must NOT have broken)
- [ ] **Do:** Switch to **Focus/Execute** mode, then **refresh** `/tasks` → **Expect:** you stay in Focus/Execute mode (the URL's mirrored `?id` must not force you back to Plan). _(both — regression caught in review)_
- [ ] **Do:** In List view grouped by Status with the **Done** group collapsed, complete (press `x`) the selected task so it moves into Done → **Expect:** the Done group **stays collapsed** (completing a task must not pop open a group you closed). _(both — regression caught in review)_
- [ ] **Do:** Enter **All** view with a task selected in a non-first bucket → **Expect:** exactly **one** bucket group is open by default (the one-open rule holds; the selection doesn't force a second group open). _(both)_

## Known gaps / not-yet-testable
- **Desktop webview `replaceState` throttle** — the debounce that prevents WebKit's `SecurityError` can only be observed on the Tauri desktop build (web/Chrome doesn't throttle). Verified in web that j/k stays smooth and the URL settles at rest; the desktop safety is by construction (250ms debounce), not separately reproduced.
- **Notification deep-link** — verified the code path routes through the entity-open event with the id; the specific "notification card → task" click was exercised via the same event the card now dispatches. Firing a real task-targeted notification requires a second user mention (CC-4: task notifications don't yet target users), so the card itself was not clicked end-to-end.
- **Contact-hub rollup / note `/task` chip** — the dispatch path is the identical `openEntity("task", id)` used by the dashboard widget (live-verified), so these are covered by the same fix; not each clicked individually.

---
*Convention defined in [CLAUDE.md](../../CLAUDE.md) → "Session wrap-up". One file per sprint/branch so history is preserved.*
