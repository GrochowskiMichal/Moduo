// Proves AC12 (manifest half) — the spine registers a `links` manifest with a
// read + write surface whose RPC names match the real ops, conforming to
// ModuleManifest, without dropping the Tasks manifest.

import { describe, expect, it } from "vitest";

import { moduleManifests } from "./module-registry";
import type { ModuleManifest } from "./module-manifest";

function manifest(module: string): ModuleManifest {
  const found = moduleManifests.find((m) => m.module === module);
  if (!found) throw new Error(`manifest "${module}" not registered`);
  return found;
}

describe("module registry", () => {
  it("registers both the tasks and the links manifests (no regression)", () => {
    expect(moduleManifests.map((m) => m.module)).toEqual(expect.arrayContaining(["tasks", "links"]));
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
});

describe("links manifest", () => {
  const links = manifest("links");

  it("rides the Tasks permission lane at alpha", () => {
    expect(links.permissionKey).toBe("tasks");
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
