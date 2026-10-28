import { describe, expect, it } from "@rstest/core";

import { type PurgeDb, PurgeError, purgeDeleted, secretMatches } from "./purge-deleted.ts";

type Row = { id: string; object_path: string; preview_path: string | null; restored?: boolean };

/** The purge's SQL helpers over in-memory state; the SQL itself is proven by
 *  supabase/probes/attachments.probe.sql. */
class FakeDb implements PurgeDb {
  log: string[] = [];
  files = new Set<string>();
  candidates: Row[] = [];
  orphans: string[] = [];
  expiredTasks = 0;
  expiredBuckets = 0;
  expiredNotes = 0;
  staleViewers = 0;
  storageFails = false;
  rpcFails: string | null = null;

  rpc(fn: string, args: Record<string, unknown> = {}) {
    this.log.push(`rpc ${fn}`);
    if (this.rpcFails === fn) return Promise.resolve({ data: null, error: { message: "boom" } });
    const limit = Number(args.p_limit ?? 500);
    switch (fn) {
      case "purge__preview":
        return Promise.resolve({
          data: {
            attachments: this.candidates.length,
            tasks: this.expiredTasks,
            notes: this.expiredNotes,
          },
          error: null,
        });
      case "attachments__purge_candidates":
        return Promise.resolve({ data: this.candidates.slice(0, limit), error: null });
      case "attachments__purge_rows": {
        const ids = new Set(args.p_ids as string[]);
        const going = this.candidates.filter((r) => ids.has(r.id) && !r.restored);
        this.candidates = this.candidates.filter((r) => !going.includes(r));
        return Promise.resolve({ data: going.length, error: null });
      }
      case "attachments__orphan_objects":
        return Promise.resolve({
          data: this.orphans.slice(0, limit).map((name) => ({ name })),
          error: null,
        });
      case "tasks__purge_expired": {
        const tasks = Math.min(this.expiredTasks, limit);
        const buckets = Math.min(this.expiredBuckets, limit);
        this.expiredTasks -= tasks;
        this.expiredBuckets -= buckets;
        return Promise.resolve({ data: { tasks, buckets }, error: null });
      }
      case "notes__purge_expired": {
        const notes = Math.min(this.expiredNotes, limit);
        const viewers = this.staleViewers;
        this.expiredNotes -= notes;
        this.staleViewers = 0;
        return Promise.resolve({ data: { notes, viewers, failed: 0 }, error: null });
      }
      case "notes__compact_candidates":
        // Compaction itself is notes-compact.test.ts's.
        return Promise.resolve({ data: [], error: null });
      case "storage_usage__reconcile":
        return Promise.resolve({ data: 2, error: null });
      default:
        return Promise.resolve({ data: null, error: { message: `unknown ${fn}` } });
    }
  }

  storage = {
    from: (bucket: string) => ({
      remove: (paths: string[]) => {
        this.log.push(`remove ${bucket} ${paths.length}`);
        if (this.storageFails) return Promise.resolve({ error: { message: "storage down" } });
        for (const p of paths) {
          this.files.delete(p);
          this.orphans = this.orphans.filter((o) => o !== p);
        }
        return Promise.resolve({ error: null });
      },
    }),
  };
}

function file(db: FakeDb, id: string, preview = true): Row {
  const row = {
    id,
    object_path: `ws/${id}/original.png`,
    preview_path: preview ? `ws/${id}/preview.webp` : null,
  };
  db.files.add(row.object_path);
  if (row.preview_path) db.files.add(row.preview_path);
  db.candidates.push(row);
  return row;
}

describe("purgeDeleted", () => {
  it("removes the objects through Storage before deleting the rows, then tasks, then recounts", async () => {
    const db = new FakeDb();
    file(db, "a");
    file(db, "b", false);
    db.files.add("ws/orphan/original.png");
    db.orphans.push("ws/orphan/original.png");
    db.files.add("ws/kept/original.png");
    db.expiredTasks = 3;
    db.expiredBuckets = 1;

    const result = await purgeDeleted(db);

    expect(result).toEqual({
      dryRun: false,
      attachments: 2,
      objects: 3,
      orphanObjects: 1,
      tasks: 3,
      buckets: 1,
      notes: 0,
      noteViewers: 0,
      notesFailed: 0,
      notesCompacted: 0,
      notesCompactSkipped: 0,
      notesCompactFailed: 0,
      poolsRecounted: 2,
    });
    expect([...db.files]).toEqual(["ws/kept/original.png"]);
    expect(db.log).toEqual([
      "rpc attachments__purge_candidates",
      "remove attachments 3",
      "rpc attachments__purge_rows",
      "rpc attachments__orphan_objects",
      "remove attachments 1",
      "rpc tasks__purge_expired",
      "rpc notes__purge_expired",
      "rpc notes__compact_candidates",
      "rpc storage_usage__reconcile",
    ]);
  });

  it("keeps the rows when Storage fails, so the next run retries them", async () => {
    const db = new FakeDb();
    file(db, "a");
    db.storageFails = true;

    const err = await purgeDeleted(db).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PurgeError);
    expect((err as PurgeError).step).toBe("attachments");
    expect(db.candidates.map((r) => r.id)).toEqual(["a"]);
    expect(db.log).not.toContain("rpc attachments__purge_rows");
    expect(db.log).not.toContain("rpc tasks__purge_expired");
  });

  it("works through more candidates than one round holds, in chunks Storage accepts", async () => {
    const db = new FakeDb();
    for (let i = 0; i < 260; i++) file(db, `f${i}`, false);

    const result = await purgeDeleted(db, { batch: 120 });

    expect(result.dryRun).toBe(false);
    if (!result.dryRun) expect(result.attachments).toBe(260);
    expect(db.candidates).toEqual([]);
    expect(db.files.size).toBe(0);
    // 120 paths per round go to Storage in requests of at most 100.
    expect(db.log.filter((l) => l.startsWith("remove"))).toEqual([
      "remove attachments 100",
      "remove attachments 20",
      "remove attachments 100",
      "remove attachments 20",
      "remove attachments 20",
    ]);
  });

  it("stops when a round deletes nothing (everything was restored meanwhile)", async () => {
    const db = new FakeDb();
    for (let i = 0; i < 3; i++) Object.assign(file(db, `r${i}`), { restored: true });

    const result = await purgeDeleted(db, { batch: 3, maxRounds: 5 });

    expect(db.log.filter((l) => l === "rpc attachments__purge_candidates")).toHaveLength(1);
    if (!result.dryRun) expect(result.attachments).toBe(0);
  });

  it("stops after the round cap and leaves the rest for tomorrow", async () => {
    const db = new FakeDb();
    db.expiredTasks = 50;

    const result = await purgeDeleted(db, { batch: 10, maxRounds: 2 });

    if (!result.dryRun) expect(result.tasks).toBe(20);
    expect(db.expiredTasks).toBe(30);
  });

  it("a dry run only counts", async () => {
    const db = new FakeDb();
    file(db, "a");
    db.expiredTasks = 4;

    const result = await purgeDeleted(db, { dryRun: true });

    expect(result).toEqual({ dryRun: true, preview: { attachments: 1, tasks: 4, notes: 0 } });
    expect(db.log).toEqual(["rpc purge__preview"]);
    expect(db.files.size).toBe(2);
  });

  it("notes step: sweeps expired notes after tasks, in rounds, and reports the counts", async () => {
    const db = new FakeDb();
    db.expiredTasks = 1;
    db.expiredNotes = 25;
    db.staleViewers = 4;

    const result = await purgeDeleted(db, { batch: 10 });

    expect(result.dryRun).toBe(false);
    if (!result.dryRun) {
      expect(result.notes).toBe(25);
      expect(result.noteViewers).toBe(4);
      expect(result.notesFailed).toBe(0);
    }
    expect(db.expiredNotes).toBe(0);
    // Three rounds of 10, 10 and 5; the short one is the last.
    expect(db.log.filter((l) => l === "rpc notes__purge_expired")).toHaveLength(3);
    expect(db.log.indexOf("rpc notes__purge_expired")).toBeGreaterThan(
      db.log.indexOf("rpc tasks__purge_expired"),
    );
    expect(db.log.at(-1)).toBe("rpc storage_usage__reconcile");
  });

  it("notes step: a failure names the notes step and keeps what tasks did", async () => {
    const db = new FakeDb();
    db.expiredTasks = 2;
    db.rpcFails = "notes__purge_expired";

    const err = (await purgeDeleted(db).catch((e: unknown) => e)) as PurgeError;

    expect(err).toBeInstanceOf(PurgeError);
    expect(err.step).toBe("notes");
    expect(err.partial.tasks).toBe(2);
    expect(db.log).not.toContain("rpc storage_usage__reconcile");
  });

  it("names the step that failed and what was already done", async () => {
    const db = new FakeDb();
    file(db, "a");
    db.rpcFails = "tasks__purge_expired";

    const err = (await purgeDeleted(db).catch((e: unknown) => e)) as PurgeError;

    expect(err.step).toBe("tasks");
    expect(err.partial.attachments).toBe(1);
  });
});

describe("secretMatches", () => {
  it("accepts only the exact secret", () => {
    expect(secretMatches("s3cret-value", "s3cret-value")).toBe(true);
    expect(secretMatches("s3cret-valuX", "s3cret-value")).toBe(false);
    expect(secretMatches("s3cret-value-longer", "s3cret-value")).toBe(false);
    expect(secretMatches("s3cret", "s3cret-value")).toBe(false);
    expect(secretMatches("", "s3cret-value")).toBe(false);
  });

  it("never matches when no secret is configured", () => {
    expect(secretMatches("", "")).toBe(false);
  });
});
