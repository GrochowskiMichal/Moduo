// Proves AC17 (manifest half) — the email manifest registers with a metadata
// read + tissue write surface whose RPC names match the real ops, on its OWN
// permission lane (not Tasks), conforming to ModuleManifest.

import { describe, expect, it } from "@rstest/core";
import { moduleManifests } from "../../lib/module-registry";
import { emailModuleManifest } from "./ops-manifest";

describe("email manifest (AC17)", () => {
  it("is registered in the module registry", () => {
    expect(moduleManifests.map((m) => m.module)).toContain("email");
    expect(moduleManifests.find((m) => m.module === "email")).toBe(emailModuleManifest);
  });

  it("has its OWN permission lane + an `email_thread` activity type (not the Tasks lane)", () => {
    // Email carries its own permissions_email / scopes->>'email' branch (the
    // three-module api-key gotcha) — keyed writes must check the email scope.
    expect(emailModuleManifest.permissionKey).toBe("email");
    expect(emailModuleManifest.activityEntityTypes).toContain("email_thread");
  });

  it("exposes the tissue write surface — ref_upsert / snooze / follow-up / link / ref_remove", () => {
    const ops = emailModuleManifest.ops.map((o) => o.op);
    expect(ops).toEqual(
      expect.arrayContaining([
        "email.ref_upsert",
        "email.snooze",
        "email.unsnooze",
        "email.follow_up",
        "email.clear_follow_up",
        "email.link",
        "email.ref_remove",
      ]),
    );
    const byOp = Object.fromEntries(emailModuleManifest.ops.map((o) => [o.op, o.rpc]));
    expect(byOp["email.ref_upsert"]).toBe("email_op_ref_upsert");
    expect(byOp["email.snooze"]).toBe("email_op_snooze");
    expect(byOp["email.follow_up"]).toBe("email_op_follow_up");
    expect(byOp["email.link"]).toBe("email_op_link");
    expect(byOp["email.ref_remove"]).toBe("email_op_ref_remove");
  });

  it("is metadata-only — no body-read or send op", () => {
    const rpcs = emailModuleManifest.ops.map((o) => o.rpc).join(" ");
    expect(rpcs).not.toMatch(/body|send|message_body/);
  });

  it("exposes the read surface — list, get, search", () => {
    expect(emailModuleManifest.resources.map((r) => r.name)).toEqual(
      expect.arrayContaining(["email.list", "email.get", "email.search"]),
    );
  });

  it("every op is workspace-scoped and well-formed", () => {
    for (const op of emailModuleManifest.ops) {
      expect(op.op).toMatch(/^[a-z_]+\.[a-z_]+$/);
      expect(op.rpc).toMatch(/^[a-z_]+$/);
      expect(op.args.p_workspace_id).toBeTruthy();
    }
  });
});
