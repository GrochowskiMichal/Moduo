import { describe, expect, it } from "@rstest/core";

import {
  attachmentsManifest,
  buildExportBundle,
  type ExportMeta,
  exportZipName,
  type ModuleReadResult,
} from "./advanced";

const META: ExportMeta = {
  workspaceId: "ws-1",
  workspaceName: "My Space",
  exportedAt: "2026-07-11T09:30:00.000Z",
  appVersion: "1.0.0",
  appBuild: "abc1234",
  platform: "web",
};

describe("buildExportBundle — bundle shape + error manifest (AC11)", () => {
  it("writes one file per successful module and always includes a manifest", () => {
    const results: ModuleReadResult[] = [
      { module: "tasks", ok: true, data: { tasks: [] } },
      { module: "notes", ok: true, data: { notes: [] } },
      { module: "contacts", ok: true, data: { contacts: [] } },
      { module: "calendar", ok: true, data: { events: [] } },
      { module: "habits", ok: true, data: [] },
      { module: "attachments", ok: true, data: attachmentsManifest([], null) },
    ];

    const bundle = buildExportBundle(results, META);

    expect(Object.keys(bundle.entries).sort()).toEqual(
      [
        "_manifest.json",
        "attachments.json",
        "calendar.json",
        "contacts.json",
        "habits.json",
        "notes.json",
        "tasks.json",
      ].sort(),
    );
    // No failures → no _errors.json, empty errors map.
    expect(bundle.errors).toEqual({});
    expect(bundle.entries["_errors.json"]).toBeUndefined();

    const manifest = JSON.parse(bundle.entries["_manifest.json"]);
    expect(manifest.workspaceId).toBe("ws-1");
    expect(manifest.appVersion).toBe("1.0.0");
    expect(manifest.modules).toEqual({
      tasks: "ok",
      notes: "ok",
      contacts: "ok",
      calendar: "ok",
      habits: "ok",
      attachments: "ok",
    });
  });

  it("routes a failed read into _errors.json — never silently dropped", () => {
    const results: ModuleReadResult[] = [
      { module: "tasks", ok: true, data: { tasks: [] } },
      { module: "notes", ok: false, error: "boom: notes RPC failed" },
      { module: "contacts", ok: true, data: { contacts: [] } },
      { module: "calendar", ok: true, data: { events: [] } },
      { module: "habits", ok: true, data: [] },
    ];

    const bundle = buildExportBundle(results, META);

    // The failed module has no data file...
    expect(bundle.entries["notes.json"]).toBeUndefined();
    // ...but is surfaced in the errors map and the _errors.json file.
    expect(bundle.errors.notes).toBe("boom: notes RPC failed");
    expect(bundle.entries["_errors.json"]).toBeDefined();
    expect(JSON.parse(bundle.entries["_errors.json"])).toEqual({
      notes: "boom: notes RPC failed",
    });

    // Every module is still accounted for in the manifest.
    const manifest = JSON.parse(bundle.entries["_manifest.json"]);
    expect(manifest.modules.notes).toBe("error");
    expect(manifest.modules.tasks).toBe("ok");
  });

  it("entries are valid JSON strings", () => {
    const bundle = buildExportBundle(
      [{ module: "tasks", ok: true, data: { tasks: [{ id: "t1" }] } }],
      META,
    );
    expect(() => JSON.parse(bundle.entries["tasks.json"])).not.toThrow();
    expect(JSON.parse(bundle.entries["tasks.json"])).toEqual({ tasks: [{ id: "t1" }] });
  });
});

describe("exportZipName", () => {
  it("builds moduo-<workspace>-<date>.zip with a sanitized name", () => {
    expect(exportZipName(META)).toBe("moduo-My-Space-2026-07-11.zip");
  });

  it("falls back to 'workspace' when the name is empty and strips unsafe chars", () => {
    expect(exportZipName({ ...META, workspaceName: null })).toBe("moduo-workspace-2026-07-11.zip");
    expect(exportZipName({ ...META, workspaceName: "a/b:c*?" })).toBe("moduo-a-b-c-2026-07-11.zip");
  });
});

describe("attachmentsManifest — the export lists files, not their bytes (AT1-8)", () => {
  const record = (
    id: string,
    extra: Partial<Parameters<typeof attachmentsManifest>[0][number]> = {},
  ) => ({
    id,
    entityType: "task",
    entityId: "task-1",
    uploaderId: "user-1",
    fileName: `${id}.png`,
    mime: "image/png",
    sizeBytes: 1000,
    width: 800,
    height: 600,
    status: "ready",
    deletedAt: null,
    createdAt: "2026-10-08T10:00:00Z",
    ...extra,
  });

  it("lists every finished file with its task, size and whether it's in the trash", () => {
    const manifest = attachmentsManifest(
      [
        record("a"),
        record("b", { deletedAt: "2026-10-08T11:00:00Z", sizeBytes: 500, uploaderId: null }),
        record("c", { status: "pending" }),
        record("d", { status: "failed" }),
      ],
      null,
    );

    expect(manifest.count).toBe(2);
    expect(manifest.total_bytes).toBe(1500);
    expect(manifest.truncated).toBeNull();
    expect(manifest.about).toContain("aren't in this export");
    expect(manifest.files).toEqual([
      {
        id: "a",
        attached_to: { type: "task", id: "task-1" },
        name: "a.png",
        type: "image/png",
        size_bytes: 1000,
        width: 800,
        height: 600,
        added_at: "2026-10-08T10:00:00Z",
        uploaded_by: "user-1",
        in_trash: false,
      },
      {
        id: "b",
        attached_to: { type: "task", id: "task-1" },
        name: "b.png",
        type: "image/png",
        size_bytes: 500,
        width: 800,
        height: 600,
        added_at: "2026-10-08T10:00:00Z",
        uploaded_by: null,
        in_trash: true,
      },
    ]);
  });

  it("says when the read was cut, instead of looking complete", () => {
    const manifest = attachmentsManifest([record("a")], { shown: 10000, total: 12000 });

    expect(manifest.truncated).toEqual({ shown: 10000, total: 12000 });
  });
});
