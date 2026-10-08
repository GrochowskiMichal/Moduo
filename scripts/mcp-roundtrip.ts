/**
 * Keyed MCP round-trip (MCP-1): what a real API key can see and do through the
 * deployed connector, module by module.
 *
 *   MODUO_MCP_KEY=moduo_sk_… bun scripts/mcp-roundtrip.ts            # reads only
 *   MODUO_MCP_KEY=moduo_sk_… bun scripts/mcp-roundtrip.ts --write    # + reversible writes
 *
 * Create the key in Moduo → Settings → API keys (a test workspace is best) and
 * run it once with a View-everywhere key and once with an Edit-everywhere key.
 * Optional: MODUO_MCP_URL (defaults to the hosted connector).
 *
 * --write only does what it can undo, and undoes it: commit → uncommit a task,
 * create → trash a note, create → delete a contact and an event, link → unlink,
 * follow-up → clear on an email thread. It never posts to chat and never
 * comments (neither can be removed over MCP).
 */

const URL_ =
  process.env.MODUO_MCP_URL ?? "https://wtoonrvuqumihpkbvwvs.supabase.co/functions/v1/moduo-mcp";
const KEY = process.env.MODUO_MCP_KEY ?? "";
const WRITE = process.argv.includes("--write");
if (!/^moduo_sk_[a-f0-9]{48}$/i.test(KEY)) {
  console.error("Set MODUO_MCP_KEY to a key from Settings → API keys (moduo_sk_…).");
  process.exit(2);
}

type Json = Record<string, any>;
let nextId = 1;
async function rpc(method: string, params: Json = {}): Promise<Json> {
  const res = await fetch(URL_, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status} ${await res.text()}`);
  const body = (await res.json()) as Json;
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

/** Call a tool; returns the parsed result, or throws with the tool's error text. */
async function call(name: string, args: Json = {}): Promise<any> {
  const result = await rpc("tools/call", { name, arguments: args });
  const text = result?.content?.[0]?.text ?? "";
  if (result?.isError) throw new Error(text);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const results: Array<{ module: string; check: string; ok: boolean; detail: string }> = [];
async function check(module: string, name: string, fn: () => Promise<string | undefined>) {
  try {
    const detail = (await fn()) ?? "";
    results.push({ module, check: name, ok: true, detail });
  } catch (err) {
    results.push({
      module,
      check: name,
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

const init = await rpc("initialize", {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "mcp-roundtrip", version: "1" },
});
const access = /\(access: ([^)]*)\)/.exec(init.instructions ?? "")?.[1] ?? "?";
const tools: string[] = ((await rpc("tools/list")).tools ?? []).map((t: Json) => t.name);
const has = (t: string) => tools.includes(t);
console.log(`Key access: ${access}`);
console.log(`${tools.length} tools: ${tools.join(", ")}\n`);

// ── reads, one per module the key can see ──
if (has("tasks_list"))
  await check(
    "tasks",
    "tasks_list",
    async () => `${(await call("tasks_list", { limit: 5 })).length} open tasks`,
  );
if (has("notes_list"))
  await check(
    "notes",
    "notes_list",
    async () => `${(await call("notes_list", { limit: 5 })).length} notes`,
  );
if (has("calendar_day"))
  await check("calendar", "calendar_day", async () => {
    const day = await call("calendar_day");
    return `${day.events.length} events, ${day.blocks.length} blocks${day.note ? ` (${day.note})` : ""}`;
  });
if (has("email_list"))
  await check(
    "email",
    "email_list",
    async () => `${(await call("email_list", { limit: 5 })).length} threads`,
  );
if (has("contacts_list"))
  await check(
    "contacts",
    "contacts_list",
    async () => `${(await call("contacts_list", { limit: 5 })).contacts.length} people`,
  );
if (has("chat_list_channels"))
  await check(
    "chat",
    "chat_list_channels",
    async () => `${(await call("chat_list_channels")).length} public channels`,
  );
if (has("links_search_entities"))
  await check("links", "links_search_entities", async () => {
    const found = await call("links_search_entities", { limit: 20 });
    return `${found.length} items; types: ${[...new Set(found.map((e: Json) => e.type))].join(", ") || "none"}`;
  });

// ── reversible writes (--write) ──
if (WRITE) {
  const stamp = `MCP round-trip ${new Date().toISOString()}`;
  if (has("tasks_commit"))
    await check("tasks", "commit → uncommit", async () => {
      const [task] = await call("tasks_list", { limit: 1 });
      if (!task) return "no open task to use";
      await call("tasks_commit", { task_id: task.id });
      await call("tasks_uncommit", { task_id: task.id });
      return task.title;
    });
  let noteId: string | null = null;
  if (has("notes_create"))
    await check("notes", "create (visible to you) → trash", async () => {
      const note = await call("notes_create", {
        title: stamp,
        markdown: "Made by scripts/mcp-roundtrip.ts",
      });
      noteId = note.id;
      const back = await call("notes_get", { note_id: note.id });
      if (!back)
        throw new Error("created note isn't readable by its own key (owner not recorded?)");
      return note.id;
    });
  let contactId: string | null = null;
  if (has("contacts_create"))
    await check("contacts", "create (visible to you)", async () => {
      const c = await call("contacts_create", { name: stamp });
      contactId = c.id;
      const back = await call("contacts_get", { entity_id: c.id });
      if (!back)
        throw new Error("created contact isn't readable by its own key (owner not recorded?)");
      return c.id;
    });
  if (has("links_create") && noteId && contactId)
    await check("links", "link note ↔ contact → unlink", async () => {
      const link = await call("links_create", {
        source_type: "note",
        source_id: noteId,
        target_type: "contact",
        target_id: contactId,
      });
      await call("links_delete", { link_id: link.id });
      return link.id;
    });
  if (contactId)
    await check(
      "contacts",
      "delete",
      async () => void (await call("contacts_delete", { contact_id: contactId })),
    );
  if (noteId)
    await check(
      "notes",
      "trash",
      async () => void (await call("notes_trash", { note_id: noteId })),
    );
  if (has("calendar_create_event"))
    await check("calendar", "create → delete event", async () => {
      const start = new Date(Date.now() + 7 * 86_400_000);
      const event = await call("calendar_create_event", {
        title: stamp,
        starts_at: start.toISOString(),
        ends_at: new Date(start.getTime() + 30 * 60_000).toISOString(),
      });
      await call("calendar_delete_event", { event_id: event.id });
      return event.id;
    });
  if (has("email_follow_up"))
    await check("email", "follow-up → clear", async () => {
      const [thread] = await call("email_list", { limit: 1 });
      if (!thread) return "no thread to use";
      await call("email_follow_up", {
        ref_id: thread.id,
        at: new Date(Date.now() + 86_400_000).toISOString(),
      });
      await call("email_clear_follow_up", { ref_id: thread.id });
      return thread.subject;
    });
}

// A key must be refused what it can't do: pick a write tool it doesn't list.
const refusal = ["notes_create", "tasks_commit", "contacts_create", "links_create"].find(
  (t) => !has(t),
);
if (refusal)
  await check("scope", `refuses ${refusal}`, async () => {
    try {
      await call(refusal, {});
    } catch (err) {
      const text = err instanceof Error ? err.message : String(err);
      if (/can't use/.test(text)) return text;
      throw new Error(`unexpected error: ${text}`);
    }
    throw new Error("the call went through");
  });

for (const r of results)
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.module.padEnd(8)} ${r.check.padEnd(34)} ${r.detail}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

export {};
