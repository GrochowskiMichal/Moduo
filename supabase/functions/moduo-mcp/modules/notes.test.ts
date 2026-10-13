/**
 * NR-6 AC11, the connector half ("crdt write"): notes_append / notes_update /
 * notes_create produce real Yjs updates, through the prebuilt notes-doc
 * bundle the Edge Function ships, that a client doc materializes into the
 * same markdown, and every write is stored and broadcast as an agent's.
 *
 * The database is an in-memory stand-in; the doc work is real.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, rs } from "@rstest/core";
import * as Y from "yjs";

import { deriveNoteBody, NOTES_DOC_ROOT } from "../../../../src/features/notes/editor/doc-markdown";
import { buildDocStateFromMarkdown } from "../../../../src/features/notes/editor/materialize";
import { notesDocSourceHash } from "../../_shared/notes-doc/source-hash.ts";

rs.mock("../share.ts", () => ({
  assertReach: async () => {},
  visibleIds: async () => new Set<string>(),
}));

import type { ToolContext } from "../registry.ts";
import { notesConnectorModule } from "./notes.ts";

type Row = Record<string, any>;

const WS = "11111111-1111-4111-8111-111111111111";
const NOTE = "44444444-4444-4444-8444-444444444444";

const b64ToBytes = (b64: string) => Uint8Array.from(Buffer.from(b64, "base64"));

/** notes + note_updates + the three RPCs the write path calls + a channel. */
function fakeDb(note: Row) {
  const tables: Record<string, Row[]> = { notes: [note], note_updates: [] };
  const rpcCalls: Array<{ fn: string; args: Row }> = [];
  const broadcasts: Array<{ topic: string; event: string; payload: Row }> = [];
  let nextId = 1;
  function from(table: string) {
    const filters: Array<(r: Row) => boolean> = [];
    let max = Number.POSITIVE_INFINITY;
    const query: any = {
      select: () => query,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), query),
      is: (c: string, v: unknown) => (filters.push((r) => (r[c] ?? null) === v), query),
      gt: (c: string, v: number) => (filters.push((r) => Number(r[c]) > v), query),
      order: () => query,
      limit: (n: number) => ((max = n), query),
      then<T>(resolve: (res: { data: Row[]; error: null }) => T) {
        const data = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
        return Promise.resolve({ data: data.slice(0, max), error: null }).then(resolve);
      },
    };
    return query;
  }
  async function rpc(fn: string, args: Row) {
    rpcCalls.push({ fn, args });
    if (fn === "notes_op_apply_updates") {
      for (const u of args.p_updates ?? []) {
        tables.note_updates!.push({
          id: nextId++,
          workspace_id: WS,
          note_id: args.p_note_id,
          update_b64: u.updateB64,
          origin: args.p_origin,
        });
      }
      const n = tables.notes!.find((r) => r.id === args.p_note_id)!;
      n.body_md = args.p_body_md ?? n.body_md;
      n.body_text = args.p_body_text ?? n.body_text;
      return { data: { inserted: (args.p_updates ?? []).length }, error: null };
    }
    if (fn === "notes_op_import") {
      for (const r of args.p_rows) {
        tables.notes!.push({
          id: r.id,
          workspace_id: WS,
          deleted_at: null,
          doc_state: r.docStateB64,
          body_md: r.bodyMd,
          body_text: r.bodyText,
        });
      }
      return { data: { imported: args.p_rows.length }, error: null };
    }
    if (fn === "notes_op_rename") return { data: null, error: null };
    return { data: null, error: { message: `unexpected rpc ${fn}` } };
  }
  const channel = (topic: string) => ({
    httpSend: async (event: string, payload: Row) => {
      broadcasts.push({ topic, event, payload });
    },
  });
  const db = { from, rpc, channel, removeChannel: async () => {} };
  const ctx: ToolContext = {
    key: { id: "key-1", workspaceId: WS, name: "Research bot", createdBy: null, scopes: {} } as any,
    db: db as any,
  };
  return { ctx, tables, rpcCalls, broadcasts };
}

function tool(name: string) {
  const t = notesConnectorModule.tools.find((x) => x.name === name);
  if (!t) throw new Error(name);
  return t;
}

/** What a client that opened the note sees: snapshot + every logged update. */
function clientMarkdown(tables: Record<string, Row[]>, noteId: string): string {
  const doc = new Y.Doc();
  doc.get(NOTES_DOC_ROOT, Y.XmlElement);
  const note = tables.notes!.find((r) => r.id === noteId)!;
  if (note.doc_state) Y.applyUpdate(doc, b64ToBytes(note.doc_state));
  for (const u of tables.note_updates!.filter((r) => r.note_id === noteId)) {
    Y.applyUpdate(doc, b64ToBytes(u.update_b64));
  }
  return deriveNoteBody(doc).md;
}

function materializedNote(markdown: string): Row {
  return {
    id: NOTE,
    workspace_id: WS,
    deleted_at: null,
    title: "Plan",
    body_md: markdown,
    doc_state: buildDocStateFromMarkdown(NOTE, markdown)!.docStateB64,
  };
}

describe("crdt write", () => {
  it("notes_append writes an agent update the client materializes, and broadcasts it", async () => {
    const { ctx, tables, rpcCalls, broadcasts } = fakeDb(materializedNote("# Plan\n\nHello"));
    await tool("notes_append").handler({ note_id: NOTE, markdown: "- [ ] call **Acme**" }, ctx);

    const call = rpcCalls.find((c) => c.fn === "notes_op_apply_updates")!;
    expect(call.args.p_origin).toBe("agent");
    expect(call.args.p_client_id).toMatch(/^agent:/);
    expect(call.args.p_updates).toHaveLength(1);
    const expected = "# Plan\n\nHello\n\n- [ ] call **Acme**";
    expect(call.args.p_body_md).toBe(expected);
    expect(clientMarkdown(tables, NOTE)).toBe(expected);

    expect(broadcasts).toHaveLength(1);
    expect(broadcasts[0]).toMatchObject({
      topic: `notes:${NOTE}`,
      event: "u",
      payload: { origin: "agent", keyId: "key-1", label: "Research bot" },
    });
    expect(broadcasts[0]!.payload.b64).toBe(call.args.p_updates[0].updateB64);
  });

  it("appends on top of earlier logged updates, not just the snapshot", async () => {
    const { ctx, tables } = fakeDb(materializedNote("# Plan\n\nHello"));
    await tool("notes_append").handler({ note_id: NOTE, markdown: "First" }, ctx);
    await tool("notes_append").handler({ note_id: NOTE, markdown: "Second" }, ctx);
    expect(clientMarkdown(tables, NOTE)).toBe("# Plan\n\nHello\n\nFirst\n\nSecond");
  });

  it("notes_update replaces the body and keeps the title as the first line", async () => {
    const { ctx, tables, rpcCalls } = fakeDb(materializedNote("# Plan\n\nOld body"));
    await tool("notes_update").handler({ note_id: NOTE, markdown: "New *body*" }, ctx);
    const call = rpcCalls.find((c) => c.fn === "notes_op_apply_updates")!;
    expect(call.args.p_body_md).toBe("Plan\n\nNew *body*");
    expect(clientMarkdown(tables, NOTE)).toBe("Plan\n\nNew *body*");
  });

  it("an append to a body-only note keeps its imported body", async () => {
    const { ctx, tables } = fakeDb({ ...materializedNote("x"), doc_state: null, body_md: "Imported" });
    await tool("notes_append").handler({ note_id: NOTE, markdown: "More" }, ctx);
    expect(clientMarkdown(tables, NOTE)).toBe("Imported\n\nMore");
  });

  it("notes_create stores a built doc, so the note opens complete", async () => {
    const { ctx, tables, rpcCalls } = fakeDb(materializedNote("x"));
    const res = (await tool("notes_create").handler(
      { title: "Brief", markdown: "Some **bold** text" },
      ctx,
    )) as Row;
    const row = rpcCalls.find((c) => c.fn === "notes_op_import")!.args.p_rows[0];
    expect(row.docStateB64).toBeTruthy();
    expect(row.bodyMd).toBe("Brief\n\nSome **bold** text");
    expect(clientMarkdown(tables, res.id)).toBe("Brief\n\nSome **bold** text");
  });
});

describe("notes-doc bundle is current", () => {
  it("was rebuilt after the last change to the notes editor sources", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const root = resolve(here, "../../../..");
    const bundle = readFileSync(
      resolve(root, "supabase/functions/_shared/notes-doc/notes-doc.bundle.js"),
      "utf8",
    );
    const hash = /^\/\/ source-hash: (\w+)$/m.exec(bundle)?.[1];
    const inputs = JSON.parse(/^\/\/ inputs: (.*)$/m.exec(bundle)?.[1] ?? "[]") as string[];
    expect(inputs.length).toBeGreaterThan(0);
    // Stale? Run `bun run build:notes-doc` and commit the bundle.
    expect(notesDocSourceHash(root, inputs)).toBe(hash);
  });
});
