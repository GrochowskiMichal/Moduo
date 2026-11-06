// The web runtime's mail settings items (MR-7): one RPC per write with the
// exact op argument names, and rows of an unknown kind skipped on read.

import { beforeEach, describe, expect, it, rs } from "@rstest/core";

import { emailSettingsRowToItem, webEmailSettings } from "./runtime.web.email-settings";

const h = rs.hoisted(() => ({
  rpcs: [] as { fn: string; args: Record<string, unknown> }[],
  reply: { data: null as unknown, error: null },
}));

rs.mock("./runtime.web.client", () => ({
  supabaseClient: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      h.rpcs.push({ fn, args });
      return Promise.resolve(h.reply);
    },
  },
}));

beforeEach(() => {
  h.rpcs.length = 0;
  h.reply = { data: null, error: null };
});

const ROW = {
  id: "i1",
  kind: "rule",
  position: 3,
  value: { a: 1 },
  updated_at: "t1",
  deleted_at: null,
};

describe("webEmailSettings", () => {
  it("upserts through email_op_settings_upsert", async () => {
    h.reply = { data: ROW, error: null };
    const item = await webEmailSettings.upsertSetting({ id: "i1", kind: "rule", value: { a: 1 } });
    expect(h.rpcs).toEqual([
      {
        fn: "email_op_settings_upsert",
        args: { p_id: "i1", p_kind: "rule", p_value: { a: 1 }, p_position: null },
      },
    ]);
    expect(item).toEqual({
      id: "i1",
      kind: "rule",
      position: 3,
      value: { a: 1 },
      updatedAt: "t1",
      deletedAt: null,
    });
  });

  it("deletes through email_op_settings_delete", async () => {
    h.reply = { data: true, error: null };
    expect(await webEmailSettings.deleteSetting({ id: "i1" })).toBe(true);
    expect(h.rpcs[0]).toEqual({ fn: "email_op_settings_delete", args: { p_id: "i1" } });
  });

  it("skips a row of an unknown kind and coerces a non-object value", () => {
    expect(emailSettingsRowToItem({ ...ROW, kind: "future_kind" })).toBeNull();
    expect(emailSettingsRowToItem({ ...ROW, value: [1] })?.value).toEqual({});
  });
});
