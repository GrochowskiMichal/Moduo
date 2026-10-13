# Manual test checklist — TV-U17 Onboarding and welcome

> Generated 2026-10-13 · branch `t/maciej/tv-u17-onboarding` (landed on `t/maciej/tasks-v3-build`) · **Live-verified:** on the local stack at 1280 × 720 (dark): a new person in an empty workspace of their own gets "What will you run in Moduo?", Software opens the Inbox on Detailed rows with the three teaching tasks (NA-1…3) behind the dialog, the basics read "Welcome to Tasks" with Explore on my own · Learn more, the three steps show their clips, dots, Back and Next, Done closes; a reload and a second browser don't show it again; the sidebar's ⋯ and Help reopen it at the basics; a PM's answer opens All and says "Project kickoff is in your templates". `tests/onboarding.spec.ts` 2/2 and `tests/tasks-sidebar.spec.ts` 4/4 on the local stack; `bun run db:test templates_starter` 20/20.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.

Set up: `bun run local:up`, `bun run env:local`, `bun run dev:web`. You need a person who has never opened Tasks: the e2e's `newbie@moduo.local` (password `localnewbie`; sign in by code from Mailpit otherwise), or reset yourself: `update user_preferences set preferences = '{}'` for your user in the local database and use a workspace where you've made no tasks. Make a new, empty workspace of theirs (the workspace switcher → New workspace).

## The role question and the basics
- [ ] **Do:** open Tasks for the first time → **Expect:** after a moment (once your preferences and tasks are read, never a flash) a dialog: "Welcome to Moduo · What will you run in Moduo?", six answers in two columns, each with a short line, and Skip; none of them looks picked _(both)_
- [ ] **Do:** pick Software → **Expect:** the dialog moves to "Welcome to Tasks" with three lines (⌘⇧K captures…, Click a task or press ⏎…, Focus lines up…) and Explore on my own · Learn more; behind it the Inbox, on Detailed rows (handles like ABC-1) _(both)_
- [ ] **Do:** look at your Inbox behind it → **Expect:** three tasks: "Press ⌘⇧K anywhere to capture a task", "Type @, # or / in a task's name to assign, tag or date it", "Press Q on this task to line it up in Focus" (on Windows the first reads Ctrl Shift K) _(both)_
- [ ] **Do:** Explore on my own → **Expect:** the dialog closes, quietly; nothing else happens _(both)_

## Learn more
- [ ] **Do:** reopen it (next section), Learn more → **Expect:** "Above the line is yours": a clip of the whole app (sidebar, list, panel, bottom bar) changing every couple of seconds, two sentences, three dots with the first lit, Back and Next; the × sits above the clip _(both)_
- [ ] **Do:** Next → **Expect:** "Line things up in Focus" with the Focus empty state's words ("Focus shows one task at a time…", Q, ⇧F) _(both)_
- [ ] **Do:** Next → **Expect:** "@, # and / work everywhere" with @ assigns, files and links · # tags · / runs commands, like /tomorrow; the button says Done _(both)_
- [ ] **Do:** Back from the first step → **Expect:** the basics again _(both)_
- [ ] **Do:** Esc on any page, or × → **Expect:** it closes _(both)_
- [ ] **Do:** turn on Reduce motion (Settings → Preferences, or the OS) and open a step → **Expect:** the clip holds its first frame _(both)_

## Once per person, and reopening
- [ ] **Do:** reload → **Expect:** no welcome _(both)_
- [ ] **Do:** sign in as the same person in another browser (or the desktop app) → **Expect:** no welcome there either _(both)_
- [ ] **Do:** the sidebar's hairline ⋯ → What's in Tasks → **Expect:** the basics (never the role question) _(both)_
- [ ] **Do:** go to Notes, Help (?) → What's in Tasks → **Expect:** Tasks opens with the basics showing _(both)_
- [ ] **Do:** as someone with no Tasks access in a workspace → **Expect:** Help has no "What's in Tasks" _(both)_
- [ ] **Do:** as the seed account (who has made tasks), with a fresh `preferences = '{}'` → **Expect:** no welcome; it's quietly marked seen _(both)_

## What a role sets
- [ ] **Do:** a fresh person picks School or study → **Expect:** Upcoming opens; rows Standard _(both)_
- [ ] **Do:** a fresh person in a workspace with projects picks Projects for a team → **Expect:** the first project opens as its Board; the basics say "Project kickoff is in your templates: the sidebar's ⋯, then New project from template…"; that template is in New project from template… and isn't shareable _(both)_
- [ ] **Do:** the same with no projects → **Expect:** All, saying "No projects yet" _(both)_
- [ ] **Do:** A company or its operations / Client work / Content → **Expect:** Monthly close / Client onboarding / Episode in your templates; Content's template, applied, opens as Ideas · Planned · Drafting · Editing · Published _(both)_
- [ ] **Do:** Skip, or close the question → **Expect:** no role; Tasks opens on the Inbox; the question isn't asked again _(both)_

## Prepared workspaces (the hackathon case)
- [ ] **Do:** a fresh person joins a workspace someone else filled (an invite) and opens Tasks → **Expect:** the role question and the welcome; no teaching tasks in their Inbox (they don't own the workspace) _(both)_
- [ ] **Do:** a fresh person opens Tasks in a workspace of their own that already has a project → **Expect:** the welcome; no teaching tasks _(both)_

## Verify before release
- [ ] Apply `20261013230000_templates_starter` with the other v3 migrations (it adds one op and two helpers, alters nothing) and run `bun run db:test templates_starter` on a prod copy.
- [ ] The welcome's frames load in the signed desktop build (`/welcome/*.jpg` from the bundle) and the cross-fade plays in its webview.
- [ ] The frames are dark-themed; check they read well in the light theme, or record a light set.
- [ ] Two real devices: answer on one, open Tasks on the other (signed desktop + web): no second welcome; the role's rows on the other device.
- [ ] Re-record the frames (`tests/clips/welcome-clips.spec.ts`) once the module's visuals settle before release.

## Polish later
From the validator's one round (no BLOCKER or MAJOR; fixed now: `bun run e2e` no longer records the clips, the clips project needs `MODUO_CLIPS=1`; the starter line's double full stop).
- [ ] **A later first open on a new device can miss the role's first view.** The page picks its opening place once the tasks load; if that happens before the preferences arrive, it opens the Inbox and remembers it (`tasks-plan-view.tsx`, the default-selection effect). Wait for `usePreferencesReady` there, or re-pick once when the role arrives and nothing was chosen. A new-device e2e with School or study (Upcoming) would show it.
- [ ] **A later first open shows a PM's or creator's first project as a List,** not its Board (the default-selection effect uses only the place; apply the Board the way `openFirstView` does).
- [ ] **The forward-only merge stays on the device.** When the cloud's copy lacks "seen", the device keeps it but doesn't push it back, so a third device or a cleared browser in that window can see the welcome again. Push the merged copy when it differs from the cloud's.
- [ ] **A failed preferences read counts as "read".** On a new device whose read fails, the welcome can open. Mark the domain ready only after a real answer (the older seed-from-local path that runs after a failed read is worth a look at the same time).
- [ ] **The e2e doesn't check the developer's Detailed rows** (assert a handle in a row after Software).
- [ ] **No test for the shared-browser guard:** `applyFromCloud` with another person's sync meta must not carry their onboarding over.
- [ ] Resending a starter with the id of one since deleted answers with the deleted row (the app mints a new id each time, so it never happens).
- [ ] A workspace with only archived projects counts as empty for the teaching tasks; switching workspace in the middle of seeding sends the rest to the new workspace's module with the old Inbox id.
- [ ] `TASKS_ROLES` lives in `features/tasks/onboarding.ts` (preferences JSON only), not `@contracts`; `lib/preferences.ts` imports it from features.
- [ ] **Designer call:** closing the role question counts as Skip for good, and there's no place to change the role yet (the Settings rebuild, per the 🟠 box).
- [ ] Visual baselines for the welcome dialog (role, basics, a step) once the look settles.
