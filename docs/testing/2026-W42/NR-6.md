# Manual test checklist — NR-6 agent writes land live

> Generated 2026-10-14 · branch `t/mike/nr-6-agent-writes` (#360) · **Live-verified:** partial. Unit, contract, engine, hook and bundle tests pass in `bun run verify`; the migration `20261014120000` is applied to prod and `moduo-mcp` is deployed. **No end-to-end check with a real module API key has been run yet**, so the first section below is the one that confirms the whole path.
> Run top-to-bottom; check off as you go. Each item is a step → what you should see → where.
> You need: a module API key with the **notes** scope (Settings → API keys), an MCP client pointed at `moduo-mcp` (Claude Desktop is fine), and two browser tabs on the same account.

## Agent append, live
- [ ] **Do:** open a note with some text in tab A; from the MCP client call `notes_append` on that note with a short paragraph → **Expect:** the paragraph appears at the end of the note in tab A within a couple of seconds, without a reload and without losing your cursor or what you were typing _(web, desktop)_
- [ ] **Do:** look at the note's meta line right after → **Expect:** "<key name> edited · just now · Undo" ("Claude" if the key has no name) _(web, desktop)_
- [ ] **Do:** while tab A is open, type in the note, then have the agent append again → **Expect:** your typing is intact and the agent's text lands after it; nothing duplicated _(web)_
- [ ] **Do:** have the agent append to a note that is **not** open anywhere, then open it → **Expect:** the appended text is there, in the right place _(web, desktop)_
- [ ] **Do:** have the agent append to a note whose body was written by an older client (an imported or classic note that has never been opened in New Notes) → **Expect:** the original text is unchanged and the append is added once, never doubled _(web)_

## Agent update and create
- [ ] **Do:** `notes_update` an existing note with a new body → **Expect:** the note shows the new body live; the title is renamed only after the body is in _(web)_
- [ ] **Do:** `notes_create` a note with markdown (headings, list, a checklist, a table) → **Expect:** it appears in the sidebar (Inbox for a root) and opens with that markdown rendered as real blocks, and the public/copy-as-markdown output matches what you wrote _(web, desktop)_
- [ ] **Do:** have the agent write to a note you have open in a second tab → **Expect:** both tabs end up with the same content _(web)_

## Undo
- [ ] **Do:** after an agent edit (still on the same open note), click **Undo** in the meta line → **Expect:** the agent's addition disappears; the meta line stops offering Undo; the note's saved text matches what you see after a reload _(web, desktop)_
- [ ] **Do:** after an agent edit, press ⌘Z in the editor → **Expect:** the agent's change reverts as a normal edit, and only your own prior typing remains _(web)_
- [ ] **Do:** have the agent edit twice in a row, then Undo → **Expect:** only the newest agent edit is undone _(web)_
- [ ] **Do:** with the note open in two tabs, undo in tab A → **Expect:** tab B shows the same result; tab B no longer offers Undo for the step tab A took, and clicking nothing restores text twice _(web)_
- [ ] **Do:** type a few words inside a paragraph the agent added, then Undo → **Expect:** your typed words go with that block (documented behavior); the rest of the note is untouched _(web)_

## Attribution and activity
- [ ] **Do:** edit the note yourself after an agent edit → **Expect:** the meta line changes to "Edited … by <you>" and Undo is gone _(web, desktop)_
- [ ] **Do:** open the note as a different workspace member after an agent edit → **Expect:** they see "<key name> edited · …" but **no Undo button** (editors who hold the step only) _(web)_
- [ ] **Do:** open the Activity feed → **Expect:** an entry "<key> edited this note" for each agent write _(web, desktop)_

## Edge cases
- [ ] **Do:** a key **without** the notes scope calls `notes_append` → **Expect:** refused with a scope error; nothing written _(web)_
- [ ] **Do:** a key writes to a note it can't reach (another workspace, or a note it has no access to) → **Expect:** refused; no row appears in the note's history _(web)_
- [ ] **Do:** go offline in tab A, let the agent append, come back online → **Expect:** the note catches up on reconnect; nothing you typed offline is lost _(web)_
- [ ] **Do:** trash the note, then have the agent append → **Expect:** a clear "not found / trashed" error, no resurrection _(web)_
- [ ] **Do:** use another MCP tool (tasks, contacts) right after a deploy → **Expect:** it is no slower than before — the notes editor bundle only loads on a notes write _(web)_
- [ ] **Do:** open a classic-experience note (Settings → New Notes switch off) after an agent edit → **Expect:** the text is the real text; no blank or duplicated body _(web)_

## Migrations / data
- [ ] **Do:** in prod, check `select origin, count(*) from note_updates group by 1` → **Expect:** every row has `origin` set (`user` for all history), and `actor_key_id` is null for them
- [ ] **Do:** after the first agent write, look at its `note_updates` row → **Expect:** `origin = 'api_key'`, `actor_key_id` is the key's id, `user_id` is the key's owner; `notes.edited_by/edited_at` is **unchanged** (it tracks the last human edit only)
- [ ] **Do:** run `select proname, pronargs from pg_proc where proname = 'notes_op_apply_updates'` → **Expect:** one function with 6 arguments (older and newer clients both still work)

## Known gaps / not-yet-testable
- The keyed live check (real API key → `notes_append` → live in a browser) has not been run; every item above under "Agent append, live", "Undo" and "Attribution" is verified by tests only.
- The `realtime` channel for notes is still public until NR-7. The cue is content-free and clients pull, so a forged cue can only trigger a pull; the stored row is the only source of attribution.
- `notes_update` stays a wholesale replace: text someone is typing inside replaced blocks at that moment is lost by design.
- Desktop (Tauri) was not run; the code path is shared with web.

---
*Convention defined in [AGENTS.md](../../../AGENTS.md) → "Working posture" (Wrap). One file per sprint/branch so history is preserved.*
