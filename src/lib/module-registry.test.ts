// Proves AC12 (manifest half) — the spine registers a `links` manifest with a
// read + write surface whose RPC names match the real ops, conforming to
// ModuleManifest, without dropping the Tasks manifest.

import { MCP_TOOL_NEEDS } from "@contracts/mcp-key-scopes";
import { MCP_KEY_MODULES } from "@contracts/vocabularies";
import { describe, expect, it } from "@rstest/core";
import type { ModuleManifest } from "./module-manifest";
import { moduleManifests } from "./module-registry";

function manifest(module: string): ModuleManifest {
  const found = moduleManifests.find((m) => m.module === module);
  if (!found) throw new Error(`manifest "${module}" not registered`);
  return found;
}

describe("module registry", () => {
  it("registers the tasks, links, contacts, calendar, and notes manifests (no regression)", () => {
    expect(moduleManifests.map((m) => m.module)).toEqual(
      expect.arrayContaining(["tasks", "links", "contacts", "calendar", "notes"]),
    );
  });

  it("every manifest conforms to the ModuleManifest shape", () => {
    for (const m of moduleManifests) {
      expect(typeof m.module).toBe("string");
      expect(typeof m.summary).toBe("string");
      expect(typeof m.permissionKey).toBe("string");
      expect(Array.isArray(m.activityEntityTypes)).toBe(true);
      for (const op of m.ops) {
        expect(op.op).toMatch(/^[a-z_]+\.[a-z_]+$/);
        expect(op.rpc).toMatch(/^[a-z_]+$/);
        expect(typeof op.summary).toBe("string");
        expect(op.args.p_workspace_id).toBeTruthy(); // every op is workspace-scoped
      }
      for (const r of m.resources) {
        expect(typeof r.name).toBe("string");
        expect(typeof r.summary).toBe("string");
      }
    }
  });

  it("each manifest's module is an API-key scope module (the key card has its row)", () => {
    for (const m of moduleManifests) expect(MCP_KEY_MODULES).toContain(m.module);
  });

  it("declares exactly the cross-module key needs the connector enforces (MCP_TOOL_NEEDS)", () => {
    const declared = moduleManifests.flatMap((m) =>
      m.ops.flatMap((op) =>
        (op.alsoNeeds ?? []).map((needs) => `${op.op.replace(".", "_")}>${needs}`),
      ),
    );
    const enforced = MCP_TOOL_NEEDS.map((n) => `${n.tool}>${n.needs}`);
    expect(declared.sort()).toEqual(enforced.sort());
  });
});

describe("links manifest", () => {
  const links = manifest("links");

  it("checks people on the spine lane (PERM-1: Edit on any module)", () => {
    expect(links.permissionKey).toBe("spine");
  });

  it("marks suggestions as an Edit-only aid (their RPC is behind the Links Edit guard)", () => {
    expect(links.resources.find((r) => r.name === "links.suggest")?.access).toBe("edit");
  });

  it("exposes the write surface — the link / comment / notification ops by RPC name", () => {
    const rpcs = links.ops.map((o) => o.rpc);
    expect(rpcs).toEqual(
      expect.arrayContaining([
        "links_op_create",
        "links_op_set_kind",
        "links_op_delete",
        "links_op_decline_suggestion",
        "comments_op_add",
        "notifications_op_mark_read",
        "notifications_op_mark_all_read",
      ]),
    );
  });

  it("exposes the read surface — entities.search, links.list, links.suggest", () => {
    expect(links.resources.map((r) => r.name)).toEqual(
      expect.arrayContaining(["entities.search", "links.list", "links.suggest"]),
    );
  });

  it("documents the closed relation_kind set on links.create (so an agent can't invent kinds)", () => {
    const create = links.ops.find((o) => o.rpc === "links_op_create");
    expect(create?.args.p_relation_kind).toMatch(/references/);
    expect(create?.args.p_relation_kind).toMatch(/works-at/);
  });
});

describe("contacts manifest", () => {
  const contacts = manifest("contacts");

  it("has its own permission lane since PERM-1", () => {
    expect(contacts.permissionKey).toBe("contacts");
  });

  it("exposes the write surface — the 6 contacts ops by RPC name", () => {
    const rpcs = contacts.ops.map((o) => o.rpc);
    expect(rpcs).toEqual(
      expect.arrayContaining([
        "contacts_op_create",
        "contacts_op_update",
        "contacts_op_set_status",
        "contacts_op_link",
        "contacts_op_unlink",
        "contacts_op_import",
        "contacts_op_delete",
      ]),
    );
  });

  it("exposes the read surface — list, get, search", () => {
    expect(contacts.resources.map((r) => r.name)).toEqual(
      expect.arrayContaining(["contacts.list", "contacts.get", "contacts.search"]),
    );
  });
});

describe("calendar manifest", () => {
  const calendar = manifest("calendar");

  it("has its own permission lane since PERM-1, and its loop verbs also need Tasks", () => {
    expect(calendar.permissionKey).toBe("calendar");
    expect(calendar.activityEntityTypes).toContain("event");
    const loop = calendar.ops.filter((o) => o.rpc.startsWith("tasks_op_"));
    expect(loop.length).toBe(4);
    for (const op of loop) expect(op.alsoNeeds).toEqual(["tasks"]);
  });

  it("exposes the write surface — native-event ops + the loop verbs (AC14)", () => {
    const ops = calendar.ops.map((o) => o.op);
    expect(ops).toEqual(
      expect.arrayContaining([
        "calendar.create_event",
        "calendar.update_event",
        "calendar.delete_event",
        "calendar.schedule_task",
        "calendar.move_block",
        "calendar.complete_block",
        "calendar.roll_forward",
      ]),
    );
    // The loop verbs ride the shipped Tasks ops (the lens model).
    const byOp = Object.fromEntries(calendar.ops.map((o) => [o.op, o.rpc]));
    expect(byOp["calendar.create_event"]).toBe("calendar_op_event_create");
    expect(byOp["calendar.complete_block"]).toBe("tasks_op_set_status");
    expect(byOp["calendar.roll_forward"]).toBe("tasks_op_reschedule");
  });

  it("exposes the read surface — list_events + the composed day (AC14)", () => {
    expect(calendar.resources.map((r) => r.name)).toEqual(
      expect.arrayContaining(["calendar.list_events", "calendar.day"]),
    );
  });
});

describe("chat manifest", () => {
  const chat = manifest("chat");

  it("has its own permission lane (never the Tasks lane — conversations are private by default)", () => {
    expect(chat.permissionKey).toBe("chat");
  });

  it("exposes only the key-attributed post — never the auth.uid() in-app ops", () => {
    expect(chat.ops.map((o) => o.rpc)).toEqual(["chat_op_agent_post"]);
  });
});
