// HV-15 variant of benchmarks/escapes/644-1-error-read-as-empty: the one-time
// desktop redb import catches a failed `getDocState` read as "no content",
// imports the note with an empty body and marks the workspace done, so the
// note's text never reaches the cloud and the import never retries. Fails until the fix lands.
// Run: MODUO_HUNT=1 bun run --cwd apps/app test src/features/notes/sync/redb-import.644-1.variant.test.ts

import { afterEach, beforeEach, describe, expect, it } from "@rstest/core";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import type { NotesImportRow } from "../model";
import { redbImportDone, runRedbImportOnce } from "./redb-import";

const hunt = process.env.MODUO_HUNT ? describe : describe.skip;

const WS = "ws-644-1";

hunt("HV-15 variant 644-1: a failed doc read imports the note empty and stops retrying", () => {
  beforeEach(() => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    window.localStorage.clear();
  });
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    window.localStorage.clear();
  });

  it("never imports a note without its body because its doc read failed", async () => {
    const imported: NotesImportRow[] = [];
    const runtime = {
      notes: {
        list: async () => [{ id: "note-1", parentId: null, title: "Trip plan", position: "a" }],
        getDocState: async () => {
          throw new Error("IPC: notes_get_doc_state failed");
        },
      },
      notesV2: {
        importNotes: async ({ rows }: { rows: NotesImportRow[] }) => {
          imported.push(...rows);
          return { imported: rows.length, skipped: 0 };
        },
      },
    } as unknown as ModuoRuntime;

    await runRedbImportOnce(runtime, WS);

    // The note's content was never read: it must not be written as empty
    // (the server then skips that id forever) ...
    expect(imported.filter((r) => r.id === "note-1" && !r.docStateB64)).toEqual([]);
    // ... and the import must stay open so the next load reads it again.
    expect(redbImportDone(WS)).toBe(false);
  });
});
