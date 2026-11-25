// Regression test for the redb-import variant of
// benchmarks/escapes/644-1-error-read-as-empty (found by the HV-15 variant
// hunt). The one-time desktop redb import caught a failed `getDocState` read
// as "no content": it imported the note with an empty body and marked the
// workspace done, so the note's text never reached the cloud (the server skips
// an existing id) and the import never retried. A failed read now defers that
// note and its sub-pages (the rest imports, the import stays open); a note
// whose read fails on 3 page loads (counted once per page life, however often
// Notes mounts) imports title-only so one corrupt row can't block the import
// for good. A root whose sub-pages all wait is still filed as a page. A note with no stored state imports meta-only.
// Run: bun run --cwd apps/app test src/features/notes/sync/redb-import.644-1.test.ts

import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { buildDocStateFromMarkdown } from "../editor/materialize";
import type { NotesImportRow } from "../model";
import { redbImportDone, runRedbImportOnce } from "./redb-import";

const WS = "ws-644-1";

type Legacy = { id: string; parentId: string | null; title: string; position: string };

function runtimeWith(notes: Legacy[], getDocState: (noteId: string) => Promise<unknown>) {
  const imported: NotesImportRow[] = [];
  const runtime = {
    notes: {
      list: async () => notes,
      getDocState: async (_ws: string, noteId: string) => getDocState(noteId),
    },
    notesV2: {
      importNotes: async ({ rows }: { rows: NotesImportRow[] }) => {
        imported.push(...rows);
        return { imported: rows.length, skipped: 0 };
      },
    },
  } as unknown as ModuoRuntime;
  return { runtime, imported };
}

/** The import as a new page load finds it (its once-per-page-life memory reset). */
async function freshPageLife() {
  rs.resetModules();
  return (await import("./redb-import")).runRedbImportOnce;
}

/** A legacy snapshot with some content in it. */
function snapshot(): string {
  return buildDocStateFromMarkdown("note-1", "Pack the tent")!.docStateB64;
}

describe("644-1 (redb import): a failed doc read never imports a note empty", () => {
  beforeEach(() => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    window.localStorage.clear();
  });
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    window.localStorage.clear();
  });

  it("never imports a note without its body because its doc read failed", async () => {
    const { runtime, imported } = runtimeWith(
      [{ id: "note-1", parentId: null, title: "Trip plan", position: "a" }],
      async () => {
        throw new Error("IPC: notes_get_doc_state failed");
      },
    );

    await runRedbImportOnce(runtime, WS);

    // The note's content was never read: it must not be written as empty
    // (the server then skips that id forever) ...
    expect(imported.filter((r) => r.id === "note-1" && !r.docStateB64)).toEqual([]);
    // ... and the import must stay open so the next load reads it again.
    expect(redbImportDone(WS)).toBe(false);
  });

  it("defers the unreadable note and its sub-pages, and imports the rest", async () => {
    const { runtime, imported } = runtimeWith(
      [
        { id: "parent", parentId: null, title: "Trip plan", position: "a" },
        { id: "child", parentId: "parent", title: "Packing", position: "a" },
        { id: "grandchild", parentId: "child", title: "Tent", position: "a" },
        { id: "other", parentId: null, title: "Budget", position: "b" },
      ],
      async (noteId) => {
        if (noteId === "parent") throw new Error("IPC: notes_get_doc_state failed");
        return { snapshotB64: snapshot(), updates: [] };
      },
    );

    await runRedbImportOnce(runtime, WS);

    expect(imported.map((r) => r.id)).toEqual(["other"]);
    expect(imported[0]?.docStateB64).toBeTruthy();
    expect(redbImportDone(WS)).toBe(false);
  });

  it("a root whose sub-pages all wait is still filed as a page, not into the Inbox", async () => {
    const { runtime, imported } = runtimeWith(
      [
        { id: "root", parentId: null, title: "Trip plan", position: "a" },
        { id: "kid", parentId: "root", title: "Packing", position: "a" },
        { id: "loose", parentId: null, title: "Idea", position: "b" },
      ],
      async (noteId) => {
        if (noteId === "kid") throw new Error("IPC: notes_get_doc_state failed");
        return { snapshotB64: snapshot(), updates: [] };
      },
    );

    await runRedbImportOnce(runtime, WS);

    const byId = new Map(imported.map((r) => [r.id, r]));
    expect([...byId.keys()].sort()).toEqual(["loose", "root"]);
    expect(byId.get("root")?.inInbox).toBe(false);
    expect(byId.get("loose")?.inInbox).toBeUndefined();
  });

  it("a note whose read fails on 3 loads imports title-only, and the import is done", async () => {
    const warn = rs.spyOn(console, "warn").mockImplementation(() => {});
    const { runtime, imported } = runtimeWith(
      [
        { id: "corrupt", parentId: null, title: "Trip plan", position: "a" },
        { id: "child", parentId: "corrupt", title: "Packing", position: "a" },
      ],
      async (noteId) => {
        if (noteId === "corrupt") throw new Error("redb: invalid JSON");
        return { snapshotB64: snapshot(), updates: [] };
      },
    );
    try {
      // Notes mounts three times in one page load (redb busy at startup): one failed load.
      let run = await freshPageLife();
      await run(runtime, WS);
      await run(runtime, WS);
      await run(runtime, WS);
      run = await freshPageLife();
      await run(runtime, WS);
      // Two loads: still never written empty, still open.
      expect(imported).toEqual([]);
      expect(redbImportDone(WS)).toBe(false);

      run = await freshPageLife();
      await run(runtime, WS);
      const byId = new Map(imported.map((r) => [r.id, r]));
      expect([...byId.keys()].sort()).toEqual(["child", "corrupt"]);
      expect(byId.get("corrupt")).toMatchObject({
        title: "Trip plan",
        docStateB64: null,
        bodyText: "",
      });
      expect(byId.get("child")?.docStateB64).toBeTruthy();
      expect(redbImportDone(WS)).toBe(true);
      expect(warn.mock.calls.some((c) => c.some((a) => String(a).includes("corrupt")))).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it("the next load, once the read works, imports the note with its content and is done", async () => {
    let fail = true;
    const { runtime, imported } = runtimeWith(
      [{ id: "note-1", parentId: null, title: "Trip plan", position: "a" }],
      async () => {
        if (fail) throw new Error("IPC: notes_get_doc_state failed");
        return { snapshotB64: snapshot(), updates: [] };
      },
    );

    await runRedbImportOnce(runtime, WS);
    fail = false;
    await runRedbImportOnce(runtime, WS);

    expect(imported.map((r) => [r.id, r.bodyText?.trim()])).toEqual([["note-1", "Pack the tent"]]);
    expect(imported[0]?.docStateB64).toBeTruthy();
    expect(redbImportDone(WS)).toBe(true);
  });

  it("a note with no stored content (an empty read) still imports, and the import is done", async () => {
    const { runtime, imported } = runtimeWith(
      [{ id: "note-1", parentId: null, title: "Trip plan", position: "a" }],
      async () => ({ snapshotB64: null, updates: [] }),
    );

    await runRedbImportOnce(runtime, WS);

    expect(imported.map((r) => [r.id, r.docStateB64])).toEqual([["note-1", null]]);
    expect(redbImportDone(WS)).toBe(true);
  });
});
