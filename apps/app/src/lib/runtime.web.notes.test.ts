// NS-5 (specs/notes-schema-hardening.md AC6, Assumption 5): the ten Notes meta
// ops return public.notes_meta, the row without doc_state and the bodies. The
// app maps that lean row to the same Note as the full row it used to get, and
// notes_meta keeps every column noteRowSchema reads, so an older tab against
// the new database still maps every result.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { noteRowSchema } from "@contracts/rows";
import { afterEach, describe, expect, it, rs } from "@rstest/core";

import { supabaseClient } from "./runtime.web.client";
import { webNotes } from "./runtime.web.notes";

const MIGRATIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../supabase/migrations",
);

const WS = "00000000-0000-4000-8000-0000000000c3";
const NOTE = "00000000-0000-4000-8000-0000000000d4";
const PARENT = "00000000-0000-4000-8000-0000000000e5";

/** A meta row as notes_meta returns it: exactly the type's columns. */
const LEAN = {
  id: NOTE,
  workspace_id: WS,
  created_by: "00000000-0000-4000-8000-0000000000a1",
  parent_id: PARENT,
  title: "Q4 plan",
  icon: "📌",
  is_pinned: false,
  position: "a0",
  is_archived: false,
  published_at: "2026-10-28T09:00:00+00:00",
  publish_token: "publish-token-fixture",
  doc_version: 7,
  share_mode: "inherit",
  workspace_shared: false,
  in_inbox: false,
  full_width: true,
  edited_by: "00000000-0000-4000-8000-0000000000a1",
  edited_at: "2026-10-28T09:01:00+00:00",
  created_at: "2026-10-01T08:00:00+00:00",
  updated_at: "2026-10-28T09:01:00+00:00",
  deleted_at: null,
};

/** The same note as the ops returned it before NS-5: the whole notes row. */
const FULL = {
  ...LEAN,
  doc_state: "AQLx2b8BAAcBBHJvb3QGAQ==",
  body_text: "The whole document",
  body_md: "The whole document",
  search_tsv: "'document':3B 'plan':2A 'q4':1A 'whole':2B",
  kind: "note",
  tags: [],
  share_scope: "private",
  share_permission: "view",
};

/** The columns of the latest `CREATE TYPE public.notes_meta` in the migrations. */
function notesMetaColumns(): string[] {
  const defs = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(resolve(MIGRATIONS_DIR, f), "utf8"))
    .map((sql) => /CREATE TYPE public\.notes_meta AS \(([\s\S]*?)\);/.exec(sql)?.[1])
    .filter((body): body is string => body !== undefined);
  const body = defs.at(-1) ?? "";
  return body
    .split("\n")
    .map((line) => line.replace(/--.*$/, "").trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/)[0] ?? "");
}

const OPS = [
  ["create", "notes_op_create", () => webNotes.notesV2.create({ workspaceId: WS, id: NOTE })],
  [
    "rename",
    "notes_op_rename",
    () => webNotes.notesV2.rename({ workspaceId: WS, noteId: NOTE, title: "Q4 plan" }),
  ],
  [
    "move",
    "notes_op_move",
    () =>
      webNotes.notesV2.move({ workspaceId: WS, noteId: NOTE, parentId: PARENT, position: "a1" }),
  ],
  [
    "setMeta",
    "notes_op_set_meta",
    () => webNotes.notesV2.setMeta({ workspaceId: WS, noteId: NOTE, patch: { fullWidth: true } }),
  ],
  [
    "duplicate",
    "notes_op_duplicate",
    () => webNotes.notesV2.duplicate({ workspaceId: WS, sourceNoteId: NOTE }),
  ],
  [
    "fileNote",
    "notes_op_file",
    () => webNotes.notesV2.fileNote({ workspaceId: WS, noteId: NOTE, inInbox: false }),
  ],
  [
    "archive",
    "notes_op_archive",
    () => webNotes.notesV2.archive({ workspaceId: WS, noteId: NOTE }),
  ],
  [
    "unarchive",
    "notes_op_unarchive",
    () => webNotes.notesV2.unarchive({ workspaceId: WS, noteId: NOTE }),
  ],
  [
    "publish",
    "notes_op_publish",
    () => webNotes.notesV2.publish({ workspaceId: WS, noteId: NOTE }),
  ],
  [
    "unpublish",
    "notes_op_unpublish",
    () => webNotes.notesV2.unpublish({ workspaceId: WS, noteId: NOTE }),
  ],
] as const;

function stubRpc(row: object) {
  return rs
    .spyOn(supabaseClient, "rpc")
    .mockImplementation((() => Promise.resolve({ data: row, error: null })) as never);
}

afterEach(() => {
  rs.restoreAllMocks();
});

describe("meta results still map", () => {
  it("notes_meta holds exactly the columns noteRowSchema reads", () => {
    const appColumns = [...Object.keys(noteRowSchema.shape)].sort();
    expect([...notesMetaColumns()].sort()).toEqual(appColumns);
    expect([...Object.keys(LEAN)].sort()).toEqual(appColumns);
  });

  for (const [method, rpcName, call] of OPS) {
    it(`${method} maps the lean ${rpcName} row to the same note as the full row`, async () => {
      const rpc = stubRpc(FULL);
      const fromFull = await call();
      expect(rpc.mock.calls[0]?.[0]).toBe(rpcName);
      rs.restoreAllMocks();

      stubRpc(LEAN);
      const fromLean = await call();
      expect(fromLean).toEqual(fromFull);
      expect(fromLean.id).toBe(NOTE);
      expect(fromLean.title).toBe("Q4 plan");
      expect(fromLean.docVersion).toBe(7);
      expect(fromLean.fullWidth).toBe(true);
      expect(fromLean.publishToken).toBe(LEAN.publish_token);
    });
  }

  it("a lean row returned as a one-row array maps too", async () => {
    stubRpc([LEAN]);
    const note = await webNotes.notesV2.rename({ workspaceId: WS, noteId: NOTE, title: "Q4 plan" });
    expect(note.id).toBe(NOTE);
    expect(note.shareMode).toBe("inherit");
  });
});
