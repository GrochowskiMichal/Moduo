import { describe, expect, it } from "@rstest/core";
import { strToU8, zipSync } from "fflate";

import {
  assignImportIds,
  buildImportRows,
  describeSkips,
  type ImportFileEntry,
  importPositions,
  notionPageId,
  planMdZipImport,
} from "./import";
import { readImportFiles } from "./import-zip";

/** Loose files (no zip), already in `{ path, content }` shape. */
const planEntries = (files: Record<string, string>): ImportFileEntry[] =>
  readImportFiles(Object.entries(files).map(([name, text]) => ({ name, text })));

describe("planMdZipImport (AC11/AC14)", () => {
  it("maps folders to parents (Notion-style nesting)", () => {
    const plan = planMdZipImport([
      { path: "Clients.md", content: "# Clients\nlist" },
      { path: "Clients/Acme.md", content: "# Acme\ndetails" },
      { path: "Clients/Acme/Contact.md", content: "# Contact\njane" },
    ]);
    const byTitle = Object.fromEntries(plan.nodes.map((n) => [n.title, n]));
    expect(plan.nodes).toHaveLength(3);
    expect(byTitle["Clients"].parentTempId).toBeNull();
    expect(byTitle["Acme"].parentTempId).toBe(byTitle["Clients"].tempId);
    expect(byTitle["Contact"].parentTempId).toBe(byTitle["Acme"].tempId);
  });

  it("isolates + counts malformed / non-markdown files", () => {
    const plan = planMdZipImport([
      { path: "ok.md", content: "content" },
      { path: "image.png", content: "binary" },
      { path: "empty.md", content: "   " },
    ]);
    expect(plan.nodes.map((n) => n.title)).toEqual(["ok"]);
    expect(plan.skipped).toHaveLength(2);
    expect(plan.skipped.map((s) => s.reason).sort()).toEqual(["empty file", "not a markdown file"]);
  });

  it("strips Notion hash suffixes from titles and still resolves parents", () => {
    const plan = planMdZipImport([
      { path: "Projects 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d.md", content: "x" },
      {
        path: "Projects 1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d/Task abcdef0123456789abcdef0123456789.md",
        content: "y",
      },
    ]);
    const byTitle = Object.fromEntries(plan.nodes.map((n) => [n.title, n]));
    expect(byTitle["Projects"]).toBeTruthy();
    expect(byTitle["Task"].parentTempId).toBe(byTitle["Projects"].tempId);
  });

  it("emits parents before children even when the zip lists them reversed (M1)", () => {
    // Child file first, parent second — the FK-safe import order must reverse it.
    const plan = planMdZipImport([
      { path: "Clients/Acme.md", content: "# Acme" },
      { path: "Clients.md", content: "# Clients" },
    ]);
    const idx = Object.fromEntries(plan.nodes.map((n, i) => [n.title, i]));
    expect(idx["Clients"]).toBeLessThan(idx["Acme"]);
    // Every node's parent (if any) appears before it.
    const seen = new Set<string>();
    for (const n of plan.nodes) {
      if (n.parentTempId) expect(seen.has(n.parentTempId)).toBe(true);
      seen.add(n.tempId);
    }
  });

  it("a file whose parent folder has no page attaches to root", () => {
    const plan = planMdZipImport([{ path: "Orphans/Lonely.md", content: "z" }]);
    expect(plan.nodes).toHaveLength(1);
    expect(plan.nodes[0].parentTempId).toBeNull();
  });

  it("derives a title from the first heading when the filename is bare", () => {
    const plan = planMdZipImport([{ path: ".md", content: "# Real Title\nbody" }]);
    expect(plan.nodes[0].title).toBe("Real Title");
  });
});

describe("Notion export hardening (IM-1, AC1–AC5)", () => {
  /** Build a zip the way fflate would read one back. */
  const zip = (files: Record<string, string | Uint8Array>) =>
    zipSync(
      Object.fromEntries(
        Object.entries(files).map(([path, body]) => [
          path,
          typeof body === "string" ? strToU8(body) : body,
        ]),
      ),
    );

  it("unwraps a nested Notion Part-N zip", () => {
    // The real shape: the download is a zip whose ONLY entry is another zip.
    const inner = zip({
      "Export-1b2c3d4e-5f60-7182-93a4-b5c6d7e8f901/Private & Shared/Clients.md": "# Clients",
      "Export-1b2c3d4e-5f60-7182-93a4-b5c6d7e8f901/Private & Shared/Clients/Acme.md": "# Acme",
    });
    const outer = zip({ "Export-x-Part-1.zip": inner });

    const entries = readImportFiles([{ name: "Export-abc.zip", bytes: outer }]);
    const plan = planMdZipImport(entries);

    // Before IM-1 this yielded ZERO notes — the reader only decoded markdown at
    // the top level, and the top level held one .zip.
    expect(plan.nodes).toHaveLength(2);
    const byTitle = Object.fromEntries(plan.nodes.map((n) => [n.title, n]));
    expect(byTitle["Acme"]!.parentTempId).toBe(byTitle["Clients"]!.tempId);
    // The nested zip's own name is not hierarchy — no phantom "Part 1" parent.
    expect(plan.nodes.some((n) => /Part-1/.test(n.title))).toBe(false);
  });

  it("accepts multi-part exports", () => {
    const part1 = zip({ "Export-1b2c3d4e-5f60-7182-93a4-b5c6d7e8f901/Alpha.md": "# Alpha" });
    const part2 = zip({ "Export-1b2c3d4e-5f60-7182-93a4-b5c6d7e8f901/Alpha/Beta.md": "# Beta" });

    // Dropped together, the parts must merge into ONE tree — not two.
    const together = planMdZipImport(
      readImportFiles([
        { name: "Export-abc-Part-1.zip", bytes: part1 },
        { name: "Export-abc-Part-2.zip", bytes: part2 },
      ]),
    );
    expect(together.nodes).toHaveLength(2);
    const byTitle = Object.fromEntries(together.nodes.map((n) => [n.title, n]));
    expect(byTitle["Beta"]!.parentTempId).toBe(byTitle["Alpha"]!.tempId);

    // Dropped one at a time, each part still imports on its own. Beta has no
    // parent to attach to yet (Alpha lives in Part-1), so it lands at root — but
    // it keeps the SAME id, so importing Part-1 afterwards adds Alpha without
    // duplicating Beta. That id stability is what makes one-at-a-time safe.
    const alone = planMdZipImport(readImportFiles([{ name: "p2.zip", bytes: part2 }]));
    expect(alone.nodes.map((n) => n.title)).toEqual(["Beta"]);
    expect(alone.nodes[0]!.parentTempId).toBeNull();
    expect([...assignImportIds("ws-1", alone.nodes).values()]).toEqual([
      assignImportIds("ws-1", together.nodes).get(byTitle["Beta"]!.tempId),
    ]);
  });

  it("strips the export wrapper folder", () => {
    const entries = readImportFiles([
      {
        name: "e.zip",
        bytes: zip({
          "Export-1b2c3d4e-5f60-7182-93a4-b5c6d7e8f901/Private & Shared/Page.md": "# Page",
          "Export-1b2c3d4e-5f60-7182-93a4-b5c6d7e8f901/Private & Shared/Page/Child.md": "# Child",
        }),
      },
    ]);
    // Both wrapper segments match Notion's export shape, so both go.
    expect(entries.map((e) => e.path).sort()).toEqual(["Page.md", "Page/Child.md"]);

    const plan = planMdZipImport(entries);
    const byTitle = Object.fromEntries(plan.nodes.map((n) => [n.title, n]));
    // Page is a ROOT note — not a child of two phantom notes.
    expect(byTitle["Page"]!.parentTempId).toBeNull();
    expect(byTitle["Child"]!.parentTempId).toBe(byTitle["Page"]!.tempId);
    expect(plan.nodes.some((n) => /Export-abc|Private/.test(n.title))).toBe(false);

    // A folder the user actually authored is never stripped: it isn't common to
    // every entry, because a sibling lives at the level above it.
    const authored = readImportFiles([
      { name: "Top.md", text: "# Top" },
      { name: "Top/Inner.md", text: "# Inner" },
    ]);
    expect(authored.map((e) => e.path)).toEqual(["Top.md", "Top/Inner.md"]);
  });

  it("preserves hierarchy to 9 levels", () => {
    // L1.md, L1/L2.md, L1/L2/L3.md … 9 deep, as the sample export reaches.
    const files: Record<string, string> = {};
    for (let depth = 1; depth <= 9; depth++) {
      const segs = Array.from({ length: depth }, (_, i) => `L${i + 1}`);
      files[`${segs.join("/")}.md`] = `# L${depth}`;
    }
    const plan = planMdZipImport(planEntries(files));

    expect(plan.nodes).toHaveLength(9);
    const byTitle = Object.fromEntries(plan.nodes.map((n) => [n.title, n]));
    expect(byTitle["L1"]!.parentTempId).toBeNull();
    for (let depth = 2; depth <= 9; depth++) {
      expect(byTitle[`L${depth}`]!.parentTempId).toBe(byTitle[`L${depth - 1}`]!.tempId);
    }
    // Every parent is emitted before its child, or the FK insert drops it.
    const order = plan.nodes.map((n) => n.tempId);
    for (const node of plan.nodes) {
      if (node.parentTempId) {
        expect(order.indexOf(node.parentTempId)).toBeLessThan(order.indexOf(node.tempId));
      }
    }
  });

  it("assigns deterministic sibling positions", () => {
    const plan = planMdZipImport(
      planEntries({
        "Root.md": "# Root",
        "Root/Alpha.md": "a",
        "Root/Beta.md": "b",
        "Root/Gamma.md": "c",
      }),
    );
    const positions = importPositions(plan.nodes);
    const byTitle = new Map(plan.nodes.map((n) => [n.title, n.tempId]));
    const [a, b, c] = ["Alpha", "Beta", "Gamma"].map((t) => positions.get(byTitle.get(t)!)!);

    // Ordered lexorank keys in the export's own entry order — not all "".
    expect(a).toBeTruthy();
    expect(a < b!).toBe(true);
    expect(b! < c!).toBe(true);
    // And stable: planning the same export twice gives the same keys.
    const again = importPositions(
      planMdZipImport(
        planEntries({
          "Root.md": "# Root",
          "Root/Alpha.md": "a",
          "Root/Beta.md": "b",
          "Root/Gamma.md": "c",
        }),
      ).nodes,
    );
    expect([...again.values()].sort()).toEqual([...positions.values()].sort());
  });

  it("classifies skipped entries by kind", () => {
    const plan = planMdZipImport(
      readImportFiles([
        {
          name: "e.zip",
          bytes: zip({
            "Page.md": "# Page",
            "db.csv": "a,b\n1,2",
            "shot.png": new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
            "logo.svg": "<svg/>",
            "notes.pages": "opaque",
            "blank.md": "   ",
          }),
        },
      ]),
    );

    expect(plan.nodes.map((n) => n.title)).toEqual(["Page"]);
    expect(plan.skippedByKind).toEqual({
      csv: 1,
      image: 2,
      empty: 1,
      "nested-archive": 0,
      unknown: 1,
    });
    // Counted per kind, and never emitted as empty notes.
    expect(plan.skipped).toHaveLength(5);
    expect(describeSkips(plan.skippedByKind)).toBe(
      "1 CSV · 2 images · 1 empty file · 1 other file",
    );
  });

  it("is idempotent across two runs", () => {
    const files = {
      "Root.md": "# Root",
      "Root/Child.md": "# Child",
    };
    const rowsFor = (f: Record<string, string>) => {
      const plan = planMdZipImport(planEntries(f));
      const ids = assignImportIds("ws-1", plan.nodes);
      return buildImportRows(
        plan.nodes,
        (t) => ids.get(t)!,
        () => null,
      );
    };

    const first = rowsFor(files);
    const second = rowsFor(files);

    // Same export → the same row ids in the same order, so `notes_op_import`
    // skips every row on the second run instead of inserting a second copy.
    expect(second.map((r) => r.id)).toEqual(first.map((r) => r.id));
    // Parent edges are rebuilt from the same ids, so a partially-failed import
    // resumes against the rows that already landed.
    expect(second.map((r) => r.parentId)).toEqual(first.map((r) => r.parentId));
    expect(first.find((r) => r.title === "Child")!.parentId).toBe(
      first.find((r) => r.title === "Root")!.id,
    );
    for (const id of first.map((r) => r.id)) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
    // Scoped per workspace: the same file in another workspace is a different note.
    expect(rowsFor(files).map((r) => r.id)).not.toEqual(
      (() => {
        const plan = planMdZipImport(planEntries(files));
        const ids = assignImportIds("ws-2", plan.nodes);
        return buildImportRows(
          plan.nodes,
          (t) => ids.get(t)!,
          () => null,
        ).map((r) => r.id);
      })(),
    );
  });

  it("gives same-titled sibling pages distinct ids", () => {
    // Notion appends its 32-hex page id to every file PRECISELY because sibling
    // titles are not unique. Keying on the cleaned path alone collapses these two
    // into one id — and `notes_op_import` resolves a duplicate id by silently
    // skipping the second row, so a page vanishes and its children reparent under
    // its twin. This is the shape a real export guarantees.
    const hexA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const hexB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const plan = planMdZipImport(
      planEntries({
        [`Clients/Meeting notes ${hexA}.md`]: "# Acme call",
        [`Clients/Meeting notes ${hexB}.md`]: "# Globex call",
        // Two pages whose names clean to EMPTY — the sample export has four.
        [`Clients/ ${hexA.replace(/a/g, "c")}.md`]: "# untitled one",
        [`Clients/ ${hexA.replace(/a/g, "d")}.md`]: "# untitled two",
      }),
    );
    const ids = assignImportIds("ws-1", plan.nodes);

    expect(plan.nodes).toHaveLength(4);
    expect(new Set(ids.values()).size).toBe(4);
    // And still stable: the ids come from Notion's page id, so they survive a
    // re-export in which the page moved or the title changed.
    const again = assignImportIds("ws-1", plan.nodes);
    expect([...again.values()]).toEqual([...ids.values()]);
  });

  it("keys ids on Notion's page id, not the path, so a moved page is not re-imported", () => {
    const hex = "0123456789abcdef0123456789abcdef";
    expect(notionPageId(`Some/Deep/Page ${hex}.md`)).toBe(hex);
    expect(notionPageId("Plain.md")).toBeNull();

    const before = planMdZipImport(planEntries({ [`Old parent/Page ${hex}.md`]: "# P" }));
    const after = planMdZipImport(planEntries({ [`New parent/Page ${hex}.md`]: "# P" }));
    // Same Notion page, moved between exports → SAME id, so re-importing updates
    // nothing rather than duplicating the page.
    expect([...assignImportIds("ws-1", after.nodes).values()]).toEqual([
      ...assignImportIds("ws-1", before.nodes).values(),
    ]);
  });

  it("keeps ids stable when the export gains an unrelated top-level folder", () => {
    const hex = "0123456789abcdef0123456789abcdef";
    const idsOf = (f: Record<string, string>) => {
      const plan = planMdZipImport(planEntries(f));
      const map = assignImportIds("ws-1", plan.nodes);
      return plan.nodes.filter((n) => n.title === "Home").map((n) => map.get(n.tempId));
    };
    // A set-derived "longest common prefix" would re-key EVERY note the moment a
    // shallower entry appears, so a month-later re-export duplicates the workspace.
    const narrow = idsOf({
      [`Export-abc123def456abc123def456abc12345/Private & Shared/Home ${hex}.md`]: "x",
    });
    const wider = idsOf({
      [`Export-abc123def456abc123def456abc12345/Private & Shared/Home ${hex}.md`]: "x",
      "Teamspaces/Eng/Roadmap.md": "y",
    });
    expect(wider).toEqual(narrow);
  });

  it("stops unwrapping past the bounded nesting depth and reports it", () => {
    // 3 archives deep: dropped → Part-1 → Inner. We open the first two.
    const inner = zip({ "Deep.md": "# Deep" });
    const middle = zip({ "Inner.zip": inner, "Shallow.md": "# Shallow" });
    const outer = zip({ "Export-x-Part-1.zip": middle });

    const plan = planMdZipImport(readImportFiles([{ name: "e.zip", bytes: outer }]));
    expect(plan.nodes.map((n) => n.title)).toEqual(["Shallow"]);
    // The archive we refused to open is REPORTED, not silently dropped — an empty
    // import with no explanation is the failure mode this guards.
    expect(plan.skippedByKind["nested-archive"]).toBe(1);
    expect(plan.skipped[0]!.reason).toMatch(/nested deeper/);
  });

  it("survives an unreadable zip without losing the rest of the drop", () => {
    const good = zip({ "Page.md": "# Page" });
    const plan = planMdZipImport(
      readImportFiles([
        { name: "broken.zip", bytes: new Uint8Array([1, 2, 3, 4, 5]) },
        { name: "good.zip", bytes: good },
      ]),
    );
    expect(plan.nodes.map((n) => n.title)).toEqual(["Page"]);
    expect(plan.skippedByKind["nested-archive"]).toBe(1);
  });
});
