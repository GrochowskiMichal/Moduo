/**
 * NOTE-FIX-1 — the three things the fix has to prove:
 *   1. an imported note renders after a fresh load with NO in-memory seed;
 *   2. a second device/session neither duplicates nor forks the content;
 *   3. a legacy note that is already blank gets repaired.
 *
 * (1) and (3) run through the real materializer + a fake runtime; the CRDT
 * anti-fork proof itself lives in `editor/materialize.test.ts`.
 */

import { describe, expect, it, rs } from "@rstest/core";
import * as Y from "yjs";
import { buildDocStateFromMarkdown, NOTES_DOC_ROOT } from "./editor/materialize";
import { buildImportRows, planMdZipImport } from "./import";
import { emptyRepairSummary, repairNote, repairUnmaterializedNotes, tallyRepair } from "./repair";
import { deriveBody } from "./sync/doc-text";
import { decodeBase64ToUint8 } from "./utils/base64";

const WS = "11111111-2222-3333-4444-555555555555";
const NOTE = "3f7c1b2e-6a4d-4b9e-8c11-0d2e5a7b9c44";

/** What the editor sees when it opens a note: the stored snapshot, applied to
 * a fresh Y.Doc exactly as `engine-v2.pull` does — no session, no seed map. */
function renderStored(docStateB64: string | null): string {
  const doc = new Y.Doc();
  doc.get(NOTES_DOC_ROOT, Y.XmlElement);
  if (docStateB64) Y.applyUpdate(doc, decodeBase64ToUint8(docStateB64), "remote");
  return deriveBody(doc).md;
}

/** A fake `notes_op_seed_doc`: once-only PER NOTE, exactly like the SQL guard
 * (which decides under that note's row lock). */
function fakeServer(initial: { docState?: string | null; hasUpdates?: boolean } = {}) {
  const state = {
    docState: initial.docState ?? null,
    hasUpdates: initial.hasUpdates ?? false,
    writes: 0,
  };
  const perNote = new Map<string, string>();
  const bodies: Array<{ bodyMd: unknown; bodyText: unknown }> = [];
  const seedDoc = rs.fn(
    async ({
      noteId,
      docStateB64,
      bodyMd,
      bodyText,
    }: {
      noteId: string;
      docStateB64: string;
      bodyMd?: unknown;
      bodyText?: unknown;
    }) => {
      bodies.push({ bodyMd, bodyText });
      const stored = perNote.get(noteId) ?? (noteId === NOTE ? state.docState : null);
      if (stored) return { seeded: false, reason: "already_materialized" };
      if (state.hasUpdates) return { seeded: false, reason: "has_updates" };
      perNote.set(noteId, docStateB64);
      if (noteId === NOTE) state.docState = docStateB64;
      state.writes++;
      return { seeded: true, reason: null };
    },
  );
  return { state, seedDoc, bodies };
}

describe("imported notes render without an in-memory seed (AC1)", () => {
  it("stores a doc_state at import time that renders on a cold open", () => {
    const plan = planMdZipImport([
      { path: "Plan.md", content: "# Plan\n\n- [x] one\n- [ ] two\n" },
      { path: "Plan/Detail.md", content: "## Detail\n\nBody text.\n" },
    ]);
    const ids = new Map(plan.nodes.map((n, i) => [n.tempId, `note-${i}`]));
    const rows = buildImportRows(plan.nodes, (t) => ids.get(t)!, buildDocStateFromMarkdown);

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      // The whole bug was this being null.
      expect(row.docStateB64).not.toBeNull();
      expect(renderStored(row.docStateB64).trim()).not.toBe("");
    }

    const planRow = rows.find((r) => r.title === "Plan")!;
    const rendered = renderStored(planRow.docStateB64);
    expect(rendered).toContain("# Plan");
    expect(rendered).toContain("- [x] one");
    expect(rendered).toContain("- [ ] two");
  });

  it("gives siblings ordered positions instead of all-empty ones", () => {
    const plan = planMdZipImport([
      { path: "A.md", content: "# A" },
      { path: "B.md", content: "# B" },
      { path: "C.md", content: "# C" },
    ]);
    const rows = buildImportRows(
      plan.nodes,
      (t) => t,
      () => null,
    );
    const positions = rows.map((r) => r.position);

    expect(positions.every((p) => p !== "")).toBe(true);
    expect([...positions].sort()).toEqual(positions); // authored order == sort order
    expect(new Set(positions).size).toBe(positions.length);
  });

  it("still imports a note whose markdown cannot be built", () => {
    const plan = planMdZipImport([{ path: "A.md", content: "# A\n\nbody" }]);
    const rows = buildImportRows(
      plan.nodes,
      (t) => t,
      () => {
        throw new Error("lexical said no");
      },
    );
    expect(rows[0]!.docStateB64).toBeNull();
    expect(rows[0]!.bodyMd).toContain("# A"); // content preserved, never dropped
  });

  it("stores the RAW file markdown, never the lossy doc-derived body", () => {
    // `deriveBody` drops link URLs, inline emphasis markers and intra-block
    // line breaks. body_md feeds search, .md export, the published page and
    // the MCP connector, so storing a derivation would quietly degrade the
    // only faithful copy — and the sweep would do it to existing notes.
    const md = "Owner: **Anna**\nDue: 2026-09-30\n\nSee [pricing](https://x.test/p).\n";
    const plan = planMdZipImport([{ path: "A.md", content: md }]);
    const rows = buildImportRows(plan.nodes, (t) => `id-${t}`, buildDocStateFromMarkdown);

    expect(rows[0]!.docStateB64).not.toBeNull(); // doc still built
    expect(rows[0]!.bodyMd).toBe(md); // …but the body is untouched
    expect(rows[0]!.bodyMd).toContain("https://x.test/p");
    expect(rows[0]!.bodyMd).toContain("**Anna**");

    // Guard the premise: the derivation really does lose these.
    const derived = buildDocStateFromMarkdown("id-n0", md)!.bodyMd;
    expect(derived).not.toContain("https://x.test/p");
  });
});

describe("repairNote (AC3 — a legacy blank note is repaired)", () => {
  it("builds and seeds a note that has a body but no doc", async () => {
    const server = fakeServer();
    const runtime = { notesV2: { seedDoc: server.seedDoc } } as any;

    const outcome = await repairNote(runtime, WS, NOTE, "# Recovered\n\nStill here.");

    expect(outcome).toBe("seeded");
    expect(server.state.writes).toBe(1);
    const rendered = renderStored(server.state.docState);
    expect(rendered).toContain("# Recovered");
    expect(rendered).toContain("Still here.");
    // The repair writes the DOC only — never a derived body over the
    // faithful stored markdown (the migration coalesces NULL to the existing
    // value). Sending a derivation here would degrade every swept note.
    expect(server.bodies).toEqual([{ bodyMd: null, bodyText: null }]);
  });

  it("skips a note with nothing to materialize", async () => {
    const server = fakeServer();
    const runtime = { notesV2: { seedDoc: server.seedDoc } } as any;
    expect(await repairNote(runtime, WS, NOTE, "   ")).toBe("skipped");
    expect(server.seedDoc).not.toHaveBeenCalled();
  });

  it("never throws when the write fails — the note stays repairable", async () => {
    const runtime = {
      notesV2: { seedDoc: rs.fn().mockRejectedValue(new Error("offline")) },
    } as any;
    expect(await repairNote(runtime, WS, NOTE, "# A")).toBe("failed");
  });

  // ── AC2: a second device must not duplicate or fork ──────────────────────

  it("defers to whoever materialized first instead of seeding again", async () => {
    const server = fakeServer();
    const runtime = { notesV2: { seedDoc: server.seedDoc } } as any;

    const first = await repairNote(runtime, WS, NOTE, "# Recovered\n\nStill here.");
    const afterFirst = server.state.docState;
    // Second device, same note, same markdown — a moment later.
    const second = await repairNote(runtime, WS, NOTE, "# Recovered\n\nStill here.");

    expect(first).toBe("seeded");
    expect(second).toBe("already");
    expect(server.state.writes).toBe(1);
    expect(server.state.docState).toBe(afterFirst); // byte-identical, untouched

    const rendered = renderStored(server.state.docState);
    expect(rendered.match(/# Recovered/g)).toHaveLength(1);
  });

  it("refuses to seed over a note whose content lives in the update log", async () => {
    // doc_state is NULL until compaction, so "no snapshot" does NOT mean
    // "empty" — seeding such a note would duplicate every block.
    const server = fakeServer({ hasUpdates: true });
    const runtime = { notesV2: { seedDoc: server.seedDoc } } as any;

    expect(await repairNote(runtime, WS, NOTE, "# A")).toBe("has-updates");
    expect(server.state.writes).toBe(0);
  });
});

describe("repairUnmaterializedNotes (the backfill sweep)", () => {
  it("repairs every listed note and reports which ones changed", async () => {
    const server = fakeServer();
    const seen: string[] = [];
    const runtime = {
      notesV2: {
        listUnmaterialized: rs.fn().mockResolvedValue([
          { id: "note-a", bodyMd: "# A" },
          { id: "note-b", bodyMd: "# B" },
          { id: "note-c", bodyMd: "  " },
        ]),
        seedDoc: server.seedDoc,
      },
    } as any;

    const summary = await repairUnmaterializedNotes(runtime, WS, {
      onRepaired: (id) => seen.push(id),
    });

    expect(summary.seeded).toBe(2);
    expect(summary.skipped).toBe(1);
    expect(seen).toEqual(["note-a", "note-b"]);
  });

  it("drains this device's queued updates BEFORE reading the work list", () => {
    // A device that materialized a note under the OLD in-editor seeder but
    // never pushed it still looks empty server-side. Seeding it then, and
    // letting the queued local seed flush later, duplicates the content.
    const order: string[] = [];
    const runtime = {
      notesV2: {
        listUnmaterialized: rs.fn(async () => {
          order.push("list");
          return [];
        }),
        seedDoc: rs.fn(),
      },
    } as any;

    return repairUnmaterializedNotes(runtime, WS, {
      drainLocalFirst: async () => {
        order.push("drain");
      },
    }).then(() => {
      expect(order).toEqual(["drain", "list"]);
    });
  });

  it("skips the sweep entirely when the drain fails", async () => {
    const runtime = {
      notesV2: { listUnmaterialized: rs.fn(), seedDoc: rs.fn() },
    } as any;

    const summary = await repairUnmaterializedNotes(runtime, WS, {
      drainLocalFirst: async () => {
        throw new Error("offline");
      },
    });

    // Can't rule out an unpushed local doc → seeding could duplicate.
    expect(summary).toEqual(emptyRepairSummary());
    expect(runtime.notesV2.listUnmaterialized).not.toHaveBeenCalled();
  });

  it("stops between notes when the caller unmounts", async () => {
    let stop = false;
    const server = fakeServer();
    const runtime = {
      notesV2: {
        listUnmaterialized: rs.fn().mockResolvedValue([
          { id: "note-a", bodyMd: "# A" },
          { id: "note-b", bodyMd: "# B" },
        ]),
        seedDoc: rs.fn(async (args: any) => {
          stop = true;
          return server.seedDoc(args);
        }),
      },
    } as any;

    const summary = await repairUnmaterializedNotes(runtime, WS, {
      shouldStop: () => stop,
    });
    expect(summary.seeded).toBe(1);
    expect(runtime.notesV2.seedDoc).toHaveBeenCalledTimes(1);
  });

  it("degrades to a no-op when the RPC is not deployed yet", async () => {
    const runtime = {
      notesV2: {
        listUnmaterialized: rs.fn().mockRejectedValue(new Error("404")),
        seedDoc: rs.fn(),
      },
    } as any;

    const summary = await repairUnmaterializedNotes(runtime, WS);
    expect(summary).toEqual(emptyRepairSummary());
    expect(runtime.notesV2.seedDoc).not.toHaveBeenCalled();
  });

  it("tallies outcomes", () => {
    let s = emptyRepairSummary();
    s = tallyRepair(s, "seeded");
    s = tallyRepair(s, "seeded");
    s = tallyRepair(s, "already");
    s = tallyRepair(s, "has-updates");
    expect(s).toEqual({ seeded: 2, already: 1, "has-updates": 1, skipped: 0, failed: 0 });
  });
});
