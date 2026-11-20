// The web runtime's calendar-account calls (CALR-20, AC35, AC37): an account
// reads its access (read_only), its booking-link default (busy_default) and its
// last error; connect sends the new arguments only when set, so the app keeps
// working against a database without them; Remove's Undo and Counts as busy
// each go through their own op.

import { beforeEach, describe, expect, it, rs } from "@rstest/core";

import { webCalendar } from "./runtime.web.calendar";

type Reply = { data: unknown; error: { message: string } | null };

const h = rs.hoisted(() => ({
  rpc: { data: null, error: null } as Reply,
  rpcs: [] as { fn: string; args: Record<string, unknown> }[],
}));

rs.mock("./runtime.web.client", () => ({
  supabaseClient: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      h.rpcs.push({ fn, args });
      return Promise.resolve(h.rpc);
    },
  },
}));

const ROW = {
  id: "00000000-0000-4000-8000-000000000001",
  workspace_id: "00000000-0000-4000-8000-0000000000aa",
  owner_id: "00000000-0000-4000-8000-0000000000bb",
  provider: "google",
  external_id: "google:robin.hale@gmail.com:holidays",
  display_label: "Holidays",
  is_default_target: false,
  color: null,
  last_sync_at: null,
  status: "reauth",
  sync_token: null,
  deleted_at: null,
  read_only: true,
  busy_default: false,
  last_error: "invalid_grant",
};

beforeEach(() => {
  h.rpc = { data: ROW, error: null };
  h.rpcs.length = 0;
});

describe("calendar accounts on the web runtime", () => {
  it("reads access, the busy default and the last error, and reauth as a status", async () => {
    const account = await webCalendar.restoreAccount({
      workspaceId: ROW.workspace_id,
      accountId: ROW.id,
    });
    expect(h.rpcs).toEqual([
      {
        fn: "calendar_op_account_restore",
        args: { p_workspace_id: ROW.workspace_id, p_account_id: ROW.id },
      },
    ]);
    expect(account.status).toBe("reauth");
    expect(account.readOnly).toBe(true);
    expect(account.busyDefault).toBe(false);
    expect(account.lastError).toBe("invalid_grant");
  });

  it("an account row from before the columns reads as writable and busy", async () => {
    const { read_only: _r, busy_default: _b, last_error: _e, ...old } = ROW;
    h.rpc = { data: [{ ...old, status: "ok" }], error: null };
    const account = await webCalendar.restoreAccount({
      workspaceId: ROW.workspace_id,
      accountId: ROW.id,
    });
    expect(account.readOnly).toBe(false);
    expect(account.busyDefault).toBe(true);
    expect(account.lastError).toBeNull();
  });

  it("connect leaves out read_only and busy_default unless they are set", async () => {
    await webCalendar.upsertAccount({
      workspaceId: ROW.workspace_id,
      provider: "google",
      externalId: ROW.external_id,
      displayLabel: "Holidays",
      color: null,
      status: "ok",
      lastSyncAt: null,
    });
    expect(Object.keys(h.rpcs[0].args)).not.toContain("p_read_only");
    expect(Object.keys(h.rpcs[0].args)).not.toContain("p_busy_default");

    await webCalendar.upsertAccount({
      workspaceId: ROW.workspace_id,
      provider: "google",
      externalId: ROW.external_id,
      displayLabel: "Holidays",
      readOnly: true,
      busyDefault: false,
    });
    expect(h.rpcs[1].fn).toBe("calendar_op_account_upsert");
    expect(h.rpcs[1].args.p_read_only).toBe(true);
    expect(h.rpcs[1].args.p_busy_default).toBe(false);
  });

  it("Counts as busy saves through calendar_op_account_set", async () => {
    const account = await webCalendar.setAccountBusy({
      workspaceId: ROW.workspace_id,
      accountId: ROW.id,
      busy: true,
    });
    expect(h.rpcs).toEqual([
      {
        fn: "calendar_op_account_set",
        args: { p_workspace_id: ROW.workspace_id, p_account_id: ROW.id, p_busy_default: true },
      },
    ]);
    expect(account.id).toBe(ROW.id);
  });

  it("a refused restore says why", async () => {
    h.rpc = { data: null, error: { message: "Calendar account not found in this workspace." } };
    await expect(
      webCalendar.restoreAccount({ workspaceId: ROW.workspace_id, accountId: ROW.id }),
    ).rejects.toThrow();
  });
});
