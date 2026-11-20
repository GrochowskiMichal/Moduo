/**
 * NS-10 · Compact what nobody opens (specs/notes-schema-hardening.md AC11,
 * Assumption 10). Only an app client that opens a note folds its Yjs log, so a
 * note only agents write grew forever. The nightly purge now folds notes with
 * more than 200 log rows that nobody has open: `compactFromLog` (the notes-doc
 * bundle) merges snapshot + log, `notes__compact` swaps it in under the same
 * version CAS as the client's fold. The SQL side (candidates, CAS, bodies
 * untouched) is proven by supabase/tests/notes_compact.test.sql.
 */

import { describe, expect, it } from "@rstest/core";

import { type PurgeDb, purgeDeleted } from "./purge-deleted.ts";

// deno-lint-ignore no-explicit-any
type NotesDoc = any;
const notesDoc = (): Promise<NotesDoc> => import("./notes-doc/notes-doc.bundle.js");

/** A note written only by an agent: one created doc, then `edits` appends,
 * each one log row, with a whole-body replace in the middle so the log holds
 * deletions too. */
async function agentOnlyNote(edits: number) {
  const doc = await notesDoc();
  const created = doc.agentCreateDoc("note-compact", "# Board plan\n\nKickoff");
  const log: string[] = [];
  for (let i = 0; i < edits; i++) {
    const edit =
      i === Math.floor(edits / 2)
        ? { kind: "replace", markdown: "# Board plan\n\nRewritten halfway" }
        : { kind: "append", markdown: `Line ${i}` };
    const r = doc.agentWriteFromLog({ snapshotB64: created.docStateB64, updatesB64: log, edit });
    if (r.updateB64) log.push(r.updateB64);
  }
  return { snapshotB64: created.docStateB64 as string, log };
}

describe("compactFromLog", () => {
  it(
    "merging a snapshot plus 300 log rows gives a document whose text equals the unmerged one",
    async () => {
      const doc = await notesDoc();
      const { snapshotB64, log } = await agentOnlyNote(300);
      expect(log).toHaveLength(300);

      const merged: string = doc.compactFromLog({ snapshotB64, updatesB64: log });

      const before = doc.bodyFromLog({ snapshotB64, updatesB64: log });
      const after = doc.bodyFromLog({ snapshotB64: merged, updatesB64: [] });
      expect(after.bodyText).toBe(before.bodyText);
      expect(after.bodyMd).toBe(before.bodyMd);
      expect(before.bodyText).toContain("Rewritten halfway");
      expect(before.bodyText).toContain("Line 299");
      // A row written after the fold still applies on top of it.
      const next = doc.agentWriteFromLog({
        snapshotB64: merged,
        updatesB64: [],
        edit: { kind: "append", markdown: "After the fold" },
      });
      expect(
        doc.bodyFromLog({ snapshotB64: merged, updatesB64: [next.updateB64] }).bodyText,
      ).toContain("After the fold");
    },
    60_000,
  );

  it("refuses a log with a row Yjs can't decode (the fold would delete it), and works without a snapshot", async () => {
    const doc = await notesDoc();
    const { snapshotB64, log } = await agentOnlyNote(3);
    const withPoison = [log[0], "bm90IGEgeWpzIHVwZGF0ZQ==", ...log.slice(1)];

    expect(() => doc.compactFromLog({ snapshotB64, updatesB64: withPoison })).toThrow();

    const fromLogOnly: string = doc.compactFromLog({
      snapshotB64: null,
      updatesB64: [snapshotB64, ...log],
    });
    expect(doc.bodyFromLog({ snapshotB64: fromLogOnly, updatesB64: [] }).bodyText).toBe(
      doc.bodyFromLog({ snapshotB64, updatesB64: log }).bodyText,
    );
  });
});

type Note = {
  id: string;
  snapshot: string | null;
  version: number;
  log: { id: number; b64: string }[];
  bodyMd: string;
  /** Someone has it open (a row in note_live_viewers). */
  viewed?: boolean;
  /** Someone opens it after the pick, before the fold. */
  openedAfterPick?: boolean;
  /** A client folds it after the pick, before the fold (the version moves). */
  foldedAfterPick?: boolean;
  /** Loading its source fails. */
  sourceFails?: boolean;
};

/** The compaction RPCs over in-memory notes, with the SQL's rules: candidates
 * are notes over 200 rows nobody has open, and notes__compact refuses a moved
 * version or a note someone opened meanwhile. */
class CompactDb implements PurgeDb {
  log: string[] = [];
  notes = new Map<string, Note>();
  limits: number[] = [];

  add(note: Note) {
    this.notes.set(note.id, note);
  }

  rpc(fn: string, args: Record<string, unknown> = {}) {
    this.log.push(`rpc ${fn}${args.p_note ? ` ${args.p_note}` : ""}`);
    const ok = (data: unknown) => Promise.resolve({ data, error: null });
    switch (fn) {
      case "notes__compact_candidates": {
        const limit = Number(args.p_limit);
        this.limits.push(limit);
        return ok(
          [...this.notes.values()]
            .filter((n) => n.log.length > 200 && !n.viewed)
            .slice(0, limit)
            .map((n) => n.id),
        );
      }
      case "notes__compact_source": {
        const n = this.notes.get(String(args.p_note))!;
        if (n.sourceFails) return Promise.resolve({ data: null, error: { message: "timeout" } });
        if (n.openedAfterPick) n.viewed = true;
        if (n.foldedAfterPick) n.version += 1;
        return ok({
          doc_state: n.snapshot,
          doc_version: n.version - (n.foldedAfterPick ? 1 : 0),
          updates: n.log.map((r) => ({ id: r.id, update_b64: r.b64 })),
        });
      }
      case "notes__compact": {
        const n = this.notes.get(String(args.p_note))!;
        if (n.viewed || n.version !== Number(args.p_expected_version)) {
          return ok({ refused: true, folded: 0, doc_version: n.version });
        }
        const upto = Number(args.p_upto_id);
        const folded = n.log.filter((r) => r.id <= upto).length;
        n.log = n.log.filter((r) => r.id > upto);
        n.snapshot = String(args.p_snapshot_b64);
        n.version += 1;
        return ok({ refused: false, folded, doc_version: n.version });
      }
      case "attachments__purge_candidates":
      case "attachments__orphan_objects":
        return ok([]);
      case "tasks__purge_expired":
        return ok({ tasks: 0, buckets: 0 });
      case "notes__purge_expired":
        return ok({ notes: 0, viewers: 0, failed: 0, picked: 0 });
      case "storage_usage__reconcile":
        return ok(0);
      default:
        return Promise.resolve({ data: null, error: { message: `unknown ${fn}` } });
    }
  }

  storage = { from: () => ({ remove: () => Promise.resolve({ error: null }) }) };
}

function rows(log: string[], from = 1) {
  return log.map((b64, i) => ({ id: from + i, b64 }));
}

describe("the nightly compaction step", () => {
  it(
    "folds an agent-only note nobody has open and leaves a viewed one alone",
    async () => {
      const doc = await notesDoc();
      const { snapshotB64, log } = await agentOnlyNote(300);
      const db = new CompactDb();
      db.add({ id: "agent", snapshot: snapshotB64, version: 4, log: rows(log), bodyMd: "kept" });
      db.add({ id: "viewed", snapshot: snapshotB64, version: 2, log: rows(log, 1000), bodyMd: "kept", viewed: true });
      db.add({ id: "small", snapshot: snapshotB64, version: 1, log: rows(log.slice(0, 200)), bodyMd: "kept" });

      const result = await purgeDeleted(db);

      expect(result.dryRun).toBe(false);
      if (!result.dryRun) {
        expect(result.notesCompacted).toBe(1);
        expect(result.notesCompactSkipped).toBe(0);
        expect(result.notesCompactFailed).toBe(0);
      }
      const agent = db.notes.get("agent")!;
      expect(agent.log).toEqual([]);
      expect(agent.version).toBe(5);
      expect(doc.bodyFromLog({ snapshotB64: agent.snapshot, updatesB64: [] }).bodyText).toBe(
        doc.bodyFromLog({ snapshotB64, updatesB64: log }).bodyText,
      );
      // The viewed note is skipped: never loaded, never folded.
      expect(db.notes.get("viewed")!.log).toHaveLength(300);
      expect(db.log).not.toContain("rpc notes__compact_source viewed");
      expect(db.log).not.toContain("rpc notes__compact viewed");
      expect(db.notes.get("small")!.log).toHaveLength(200);
      // At most 50 notes a night, picked after the trash step, before the recount.
      expect(db.limits).toEqual([50]);
      expect(db.log.indexOf("rpc notes__compact_candidates")).toBeGreaterThan(
        db.log.indexOf("rpc notes__purge_expired"),
      );
      expect(db.log.at(-1)).toBe("rpc storage_usage__reconcile");
    },
    60_000,
  );

  it("a refusal skips that note and one note's failure never fails the run", async () => {
    const big = Array.from({ length: 201 }, () => "AAA=");
    const db = new CompactDb();
    db.add({ id: "opened", snapshot: null, version: 0, log: rows(big), bodyMd: "kept", openedAfterPick: true });
    db.add({ id: "folded", snapshot: null, version: 3, log: rows(big), bodyMd: "kept", foldedAfterPick: true });
    db.add({ id: "broken", snapshot: null, version: 0, log: rows(big), bodyMd: "kept", sourceFails: true });
    db.add({ id: "throws", snapshot: null, version: 0, log: rows(big), bodyMd: "kept" });
    db.add({ id: "fine", snapshot: null, version: 0, log: rows(big), bodyMd: "kept" });

    const result = await purgeDeleted(db, {
      compact: ({ updatesB64 }) => {
        if (db.log.at(-1) === "rpc notes__compact_source throws") throw new Error("bad doc");
        return `merged:${updatesB64.length}`;
      },
    });

    expect(result.dryRun).toBe(false);
    if (!result.dryRun) {
      expect(result.notesCompacted).toBe(1);
      expect(result.notesCompactSkipped).toBe(2);
      expect(result.notesCompactFailed).toBe(2);
    }
    expect(db.notes.get("fine")!.snapshot).toBe("merged:201");
    expect(db.notes.get("fine")!.log).toEqual([]);
    for (const id of ["opened", "folded", "broken", "throws"]) {
      expect(db.notes.get(id)!.log).toHaveLength(201);
      expect(db.notes.get(id)!.snapshot).toBeNull();
    }
    expect(db.log.at(-1)).toBe("rpc storage_usage__reconcile");
  });

  it("a note with a row Yjs can't decode keeps its log and counts as failed", async () => {
    const { snapshotB64, log } = await agentOnlyNote(3);
    const big = [...log, "bm90IGEgeWpzIHVwZGF0ZQ==", ...Array.from({ length: 200 }, () => log[2]!)];
    const db = new CompactDb();
    db.add({ id: "poison", snapshot: snapshotB64, version: 0, log: rows(big), bodyMd: "kept" });

    const result = await purgeDeleted(db);

    expect(result.dryRun).toBe(false);
    if (!result.dryRun) {
      expect(result.notesCompacted).toBe(0);
      expect(result.notesCompactFailed).toBe(1);
    }
    expect(db.notes.get("poison")!.log).toHaveLength(204);
    expect(db.notes.get("poison")!.snapshot).toBe(snapshotB64);
    expect(db.log).not.toContain("rpc notes__compact poison");
  });

  it("a failed pick is counted, not thrown, and the recount still runs", async () => {
    const db = new CompactDb();
    db.rpc = ((orig) => (fn: string, args?: Record<string, unknown>) =>
      fn === "notes__compact_candidates"
        ? Promise.resolve({ data: null, error: { message: "boom" } })
        : orig(fn, args))(db.rpc.bind(db));

    const result = await purgeDeleted(db);

    expect(result.dryRun).toBe(false);
    if (!result.dryRun) expect(result.notesCompactFailed).toBe(1);
  });
});
