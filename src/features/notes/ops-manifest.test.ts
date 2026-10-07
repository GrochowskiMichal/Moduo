// Proves AC13 (manifest half) — the notes manifest registers with a read +
// write surface whose RPC names match the real ops, on its OWN permission lane
// (not Tasks), conforming to ModuleManifest.

import { describe, expect, it } from "@rstest/core";
import { moduleManifests } from "../../lib/module-registry";
import { notesModuleManifest } from "./ops-manifest";

describe("notes manifest (AC13)", () => {
  it("is registered in the module registry", () => {
    expect(moduleManifests.map((m) => m.module)).toContain("notes");
    expect(moduleManifests.find((m) => m.module === "notes")).toBe(notesModuleManifest);
  });

  it("has its OWN permission lane + a `note` activity type (not the Tasks lane)", () => {
    // Notes carries its own permissions_notes / scopes->>'notes' branch (the
    // three-module api-key gotcha) — it must NOT ride 'tasks' like contacts.
    expect(notesModuleManifest.permissionKey).toBe("notes");
    expect(notesModuleManifest.activityEntityTypes).toContain("note");
  });

  it("exposes the write surface — create (markdown) / append / update / move / trash / link", () => {
    const ops = notesModuleManifest.ops.map((o) => o.op);
    expect(ops).toEqual(
      expect.arrayContaining([
        "notes.create",
        "notes.append",
        "notes.update",
        "notes.move",
        "notes.archive",
        "notes.trash",
        "notes.link",
      ]),
    );
    const byOp = Object.fromEntries(notesModuleManifest.ops.map((o) => [o.op, o.rpc]));
    // Create rides notes_op_import (writes body_md + registers the entity);
    // append/update ride notes_op_apply_updates (body-only write, no CRDT);
    // link rides the spine's links_op_create.
    expect(byOp["notes.create"]).toBe("notes_op_import");
    expect(byOp["notes.append"]).toBe("notes_op_apply_updates");
    expect(byOp["notes.update"]).toBe("notes_op_apply_updates");
    expect(byOp["notes.move"]).toBe("notes_op_move");
    expect(byOp["notes.link"]).toBe("links_op_create");
  });

  it("exposes the read surface — list, get (markdown), search", () => {
    expect(notesModuleManifest.resources.map((r) => r.name)).toEqual(
      expect.arrayContaining(["notes.list", "notes.get", "notes.search"]),
    );
  });

  it("every op is workspace-scoped and well-formed", () => {
    for (const op of notesModuleManifest.ops) {
      expect(op.op).toMatch(/^[a-z_]+\.[a-z_]+$/);
      expect(op.rpc).toMatch(/^[a-z_]+$/);
      expect(op.args.p_workspace_id).toBeTruthy();
    }
  });
});
