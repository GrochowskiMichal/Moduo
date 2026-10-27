// Matches that existed when each rule of the ast-grep pack was added (HV-12,
// 2026-10-23), for tools/ast-grep/lint.ts. Never add an entry for new code: fix
// the code instead. Delete an entry when its match goes; a full run fails on a
// stale entry, so this list only shrinks. `snippet` is the matched code on one
// line (lint.ts `snippetOf`); `why` says what each one is:
//   Candidate bug  a failure here can lose or misfile data. Fix and delete the entry.
//   Risk           a failure is swallowed with a visible, non-destructive effect.
//   Deliberate     a fallback that is fine as it is.

export type BaselineEntry = { rule: string; file: string; snippet: string; why: string };

export const BASELINE: readonly BaselineEntry[] = [
  {
    rule: "dnd-context-without-sensors",
    file: "apps/app/src/features/notes/shell/notes-sidebar.test.tsx",
    snippet: "<DndContext>",
    why: "Risk: Test harness; synthetic clicks still work, but it doesn't run the shell's real sensors.",
  },
  {
    rule: "dnd-context-without-sensors",
    file: "apps/app/src/features/tasks/ui/bucket-rail.test.tsx",
    snippet: "<DndContext>",
    why: "Risk: Test harness; synthetic clicks still work, but it doesn't run the shell's real sensors.",
  },
  {
    rule: "dnd-context-without-sensors",
    file: "apps/app/src/features/tasks/ui/task-timeline-view.stories.tsx",
    snippet: "<DndContext>",
    why: "Risk: Story harness: real clicks on draggable rows are swallowed in Storybook.",
  },
  {
    rule: "rust-decode-to-default",
    file: "apps/desktop/src-tauri/src/commands/email/model.rs",
    snippet: "serde_json::from_value(raw).unwrap_or_default()",
    why: "Deliberate: Deliberate serde field fallback: an unknown history depth from a newer build reads as the default, never fails the account list.",
  },
  {
    rule: "supabase-error-swallowed",
    file: "apps/app/src/lib/notices/chat-counts.ts",
    snippet: "if (error || !Array.isArray(data)) return null;",
    why: "Deliberate: A failed count returns null and the caller keeps the last number instead of showing zero.",
  },
  {
    rule: "supabase-error-swallowed",
    file: "apps/app/src/lib/notices/clients.ts",
    snippet: 'if (error || !data || typeof data !== "object") return null;',
    why: 'Deliberate: Deliberate (doc comment): null means "don\'t ring", so a failed stamp leaves the notice to browser push.',
  },
  {
    rule: "supabase-error-swallowed",
    file: "apps/app/src/lib/notices/clients.ts",
    snippet: 'await supabaseClient.rpc("notice_op_ack", { p_ids: ids.slice(0, 1000) });',
    why: "Deliberate: Best-effort ack; the worst case is browser push ringing once more.",
  },
  {
    rule: "supabase-error-swallowed",
    file: "apps/app/src/lib/runtime.chat.supabase.ts",
    snippet:
      'await db().rpc("chat_op_typing", { p_channel_id: channelId, p_parent_id: parentId, p_stop: stop, });',
    why: "Deliberate: Typing indicator is best effort; losing one changes nothing.",
  },
  {
    rule: "supabase-error-swallowed",
    file: "apps/app/src/lib/runtime.web.notes.ts",
    snippet: "if (error || !data) return null;",
    why: "Deliberate: Legacy web read nothing reaches; the redb import goes through the Tauri runtime.",
  },
  {
    rule: "supabase-error-swallowed",
    file: "apps/app/src/lib/runtime.web.notes.ts",
    snippet:
      'if (error) { const undeployed = error.code === "42883" || error.code === "PGRST202"; if (!undeployed) { console.warn("[n',
    why: "Deliberate: Opportunistic repair sweep: logs a warning and becomes a no-op.",
  },
  {
    rule: "supabase-error-swallowed",
    file: "apps/app/src/lib/runtime.web.preferences.ts",
    snippet: "if (error) return null;",
    why: "Risk: A failed min_build read hides the update-required banner, so an outdated client keeps running.",
  },
  {
    rule: "supabase-error-swallowed",
    file: "apps/app/src/lib/runtime.web.previews.ts",
    snippet:
      '{ data: ws } = await client .from("workspaces") .select("task_key, task_key_aliases") .eq("id", workspaceId) .maybeSingl',
    why: "Risk: A failed workspace read skips old-key aliases, so a handle typed with an earlier key resolves to nothing.",
  },
  {
    rule: "supabase-error-swallowed",
    file: "apps/app/src/lib/runtime.web.spine.ts",
    snippet:
      '{ data: ws } = await supabaseClient .from("workspaces") .select("task_key, task_key_aliases") .eq("id", workspaceId) .ma',
    why: "Risk: A failed workspace read drops old-key aliases, so search misses tasks typed with an earlier key.",
  },
  {
    rule: "supabase-error-swallowed",
    file: "apps/app/src/lib/runtime.web.tasks.ts",
    snippet:
      '{ data: prev } = await supabaseClient .from("buckets") .select("id") .eq("id", id) .maybeSingle()',
    why: "Risk: Wrong insert-vs-update on a failed read; the duplicate-id insert fails with a misleading error.",
  },
  {
    rule: "supabase-error-swallowed",
    file: "apps/app/src/lib/runtime.web.tasks.ts",
    snippet:
      '{ data: prev } = await supabaseClient .from("tags") .select("id") .eq("id", id) .maybeSingle()',
    why: "Risk: Wrong insert-vs-update on a failed read; the duplicate-id insert then fails loudly.",
  },
  {
    rule: "supabase-error-swallowed",
    file: "apps/app/src/lib/runtime.web.tasks.ts",
    snippet: 'await supabaseClient.from("tag_links").delete().eq("tag_id", tagId);',
    why: "Deliberate: Leftover cleanup the server already does, kept only for older servers.",
  },
  {
    rule: "supabase-error-swallowed",
    file: "apps/app/src/lib/runtime.web.tasks.ts",
    snippet:
      '{ data: existing } = await supabaseClient .from("tag_links") .select("*") .eq("workspace_id", workspaceId) .eq("tag_id",',
    why: "Risk: A failed read leads to an insert that hits the unique constraint: re-attaching a tag shows an error.",
  },
  {
    rule: "supabase-error-swallowed",
    file: "apps/app/src/lib/runtime.web.tasks.ts",
    snippet:
      '{ data: existing } = await supabaseClient .from("task_relations") .select("*") .eq("workspace_id", workspaceId) .eq("blo',
    why: "Risk: A failed read leads to an insert that hits the unique constraint: re-adding a relation shows an error.",
  },
  {
    rule: "supabase-error-swallowed",
    file: "apps/app/src/lib/runtime.web.workspace.ts",
    snippet:
      '{ data } = await supabaseClient .from("workspace_notifications") .select("*") .eq("user_id", user.id) .order("created_at',
    why: "Risk: A failed notifications read shows an empty list instead of an error.",
  },
  {
    rule: "supabase-error-swallowed",
    file: "apps/app/src/lib/runtime.web.workspace.ts",
    snippet:
      'await supabaseClient .from("workspace_notifications") .update({ read_at: new Date().toISOString() }) .eq("id", notificat',
    why: "Risk: A failed mark-read is silent; the notification comes back unread.",
  },
  {
    rule: "supabase-error-swallowed",
    file: "apps/app/src/lib/runtime.web.workspace.ts",
    snippet:
      'await supabaseClient .from("workspace_notifications") .update({ read_at: new Date().toISOString() }) .eq("user_id", user',
    why: "Risk: A failed mark-all-read is silent; the notifications come back unread.",
  },
  {
    rule: "sync-catch-returns-empty",
    file: "apps/app/src/features/notes/sync/engine-v2.ts",
    snippet: "readDocOutbox(this.owner, noteId).catch(() => [])",
    why: "Risk: A failed outbox read leaves a refused draft's updates queued; sync stays pending.",
  },
  {
    rule: "sync-catch-returns-empty",
    file: "apps/app/src/features/notes/sync/people.ts",
    snippet: "catch { return []; }",
    why: "Risk: If databases can't be listed, a departed account's note doc caches stay on the device.",
  },
  {
    rule: "sync-catch-returns-empty",
    file: "apps/app/src/features/notes/sync/redb-import.ts",
    snippet:
      'catch (e) { console.warn("[notes] redb import deferred (will retry next load)", e); return null; }',
    why: "Deliberate: The done flag stays unset, so the import retries next load.",
  },
  {
    rule: "sync-catch-returns-empty",
    file: "apps/app/src/lib/sync/cache.ts",
    snippet: "catch { return null; }",
    why: "Risk: Falls back to a server read, but offline captures in the copy wait for the next persist merge.",
  },
  {
    rule: "sync-catch-returns-empty",
    file: "apps/app/src/lib/sync/cache.ts",
    snippet: "catch { return []; }",
    why: "Risk: A failed key listing skips sign-out cleanup, leaving the previous person's rows on the device.",
  },
  {
    rule: "sync-catch-returns-empty",
    file: "apps/app/src/lib/sync/kernel/idb.ts",
    snippet: "held?.catch(() => null)",
    why: "Deliberate: Closing a database whose open failed: nothing to close.",
  },
  {
    rule: "sync-catch-returns-empty",
    file: "apps/app/src/lib/sync/store.ts",
    snippet: "catch { return null; }",
    why: "Deliberate: Documented fallback: when server search fails, views search the local copy.",
  },
  {
    rule: "sync-catch-returns-empty",
    file: "apps/app/src/lib/sync/store.ts",
    snippet:
      "this.queueOp(null, () => tasks.opQueueAdd({ workspaceId: this.workspaceId, taskId: saved.id }), ).catch((e) => { if (isN",
    why: "Risk: A refused queue-add is swallowed: the task is created but silently left out of the queue.",
  },
  {
    rule: "sync-catch-returns-empty",
    file: "apps/app/src/lib/sync/tanstack/supabase-collection.ts",
    snippet: "seed().catch(() => null)",
    why: "Deliberate: An unreadable device copy falls back to a real server read.",
  },
  {
    rule: "lexical-update-in-command",
    file: "apps/app/src/features/chat/composer/handle-chip.tsx",
    snippet:
      "editor.update(() => { const node = $getNodeByKey(made.nodeKey); if (!node || !node.isAttached()) return; const text = $c",
    why: "Candidate bug: `undone` is read right after the queued update, so a keyboard Esc returns false (lets other Esc handlers run) while the chip is still undone.",
  },
  {
    rule: "lexical-update-in-command",
    file: "apps/app/src/features/chat/composer/plugins.tsx",
    snippet:
      "editor.update(() => { const selection = $getSelection(); if (!$isRangeSelection(selection)) return; if ($caretIn($isCode",
    why: "Risk: Paste handler; nothing reads the queued update's result, it only runs a beat later.",
  },
  {
    rule: "lexical-update-in-command",
    file: "apps/app/src/features/notes/editor/plugins/markdown-clipboard-plugin.tsx",
    snippet: "editor.update(() => { $convertFromMarkdownString(text, NOTES_TRANSFORMERS); })",
    why: "Risk: Paste handler; returns true whatever the queued update does.",
  },
  {
    rule: "lexical-update-in-command",
    file: "apps/app/src/features/notes/editor/plugins/markdown-clipboard-plugin.tsx",
    snippet:
      "editor.update(() => { const selection = $getSelection(); if (!$isRangeSelection(selection)) return; $insertGeneratedNode",
    why: "Risk: Paste handler; returns true whatever the queued update does.",
  },
  {
    rule: "lexical-update-in-command",
    file: "apps/app/src/features/tasks/capture/title-editor.tsx",
    snippet:
      "editor.update(() => { const selection = $getSelection(); if ($isRangeSelection(selection)) { selection.insertText(text.r",
    why: "Risk: Paste handler; returns true whatever the queued update does.",
  },
  {
    rule: "webview-origin-ts",
    file: "apps/app/src/features/billing/checkout.ts",
    snippet: "window.location.origin",
    why: "Deliberate: Sent only when the page is on http(s); desktop lets the server's origin win.",
  },
  {
    rule: "webview-origin-ts",
    file: "apps/app/src/features/billing/checkout.ts",
    snippet: "window.location.origin",
    why: "Deliberate: Sent only when the page is on http(s); desktop lets the server's origin win.",
  },
  {
    rule: "webview-origin",
    file: "apps/app/src/features/settings/sections/billing-section.tsx",
    snippet: "window.location.origin",
    why: "Deliberate: Behind `isDesktopShell()`; desktop omits the return URL.",
  },
  {
    rule: "webview-origin",
    file: "apps/app/src/features/calendar/ui/booking-links.tsx",
    snippet: "window.location.origin",
    why: "Deliberate: Behind `isTauriRuntime()`; desktop uses the hosted origin.",
  },
  {
    rule: "webview-origin-ts",
    file: "apps/app/src/features/calendar/google-web.ts",
    snippet: "window.location.origin",
    why: "Deliberate: The web-only Google connect (the desktop build has its own flow).",
  },
  {
    rule: "webview-origin",
    file: "apps/app/src/features/chat/composer/chat-composer.tsx",
    snippet: "window.location.origin",
    why: "Deliberate: Which pasted links count as this app's own; compared, never sent.",
  },
  {
    rule: "webview-origin",
    file: "apps/app/src/features/chat/shell/chat-screen.tsx",
    snippet: "window.location.origin",
    why: "Risk: A local copy of `webOrigin()` (configured origin first); import lib/web-origin.ts instead.",
  },
  {
    rule: "webview-origin-ts",
    file: "apps/app/src/lib/runtime.web.workspace.ts",
    snippet: "window.location.origin",
    why: "Deliberate: The fallback after the configured web origin, as in `webOrigin()`.",
  },
  {
    rule: "webview-origin-ts",
    file: "apps/app/src/lib/runtime.web.notes.ts",
    snippet: "window.location.origin",
    why: "Deliberate: The fallback after the configured web origin, as in `webOrigin()`.",
  },
  {
    rule: "webview-origin",
    file: "apps/app/src/features/tasks/ui/use-saved-views.tsx",
    snippet: "window.location.origin",
    why: "Risk: A saved view's link built from the webview origin; on desktop it reads tauri://localhost.",
  },
  {
    rule: "idb-listing-wipe",
    file: "apps/app/src/features/settings/sections/advanced-section.tsx",
    snippet: "indexedDB.databases",
    why: "Candidate bug: Settings' local-data wipe finds per-note doc databases only through the listing, so on Firefox and older Safari they stay on disk.",
  },
  {
    rule: "toast-literal-duration",
    file: "apps/app/src/components/app/time-region-prompt.tsx",
    snippet: "duration: 30_000",
    why: "Deliberate: A question, not an undo toast; it stays up long enough to answer.",
  },
];
