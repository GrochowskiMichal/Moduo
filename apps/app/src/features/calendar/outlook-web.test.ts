// Outlook on the web (view only): back from Microsoft, the login just connected
// becomes one calendar account (`outlook:<email>`) unless it has a live one,
// exactly once; a login with no web token (connected only in a desktop app's
// keychain, or a server without the Microsoft client) is skipped by the sync,
// never marked broken; any other failed read throws, never an empty list.

import { beforeEach, describe, expect, it, rs } from "@rstest/core";

import type { ModuoRuntime } from "../../lib/runtime.types";

const h = rs.hoisted(() => ({
  invoke: rs.fn(),
  getSession: rs.fn(),
}));

rs.mock("../../lib/runtime.web.client", () => ({
  supabaseClient: { functions: { invoke: h.invoke }, auth: { getSession: h.getSession } },
}));

const consentUrl = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize?state=st.sig";

/** Fresh modules (the connect outcome is kept per page load), on a page at `search`. */
async function landOn(search: string) {
  window.history.replaceState(null, "", `/calendar${search}`);
  rs.resetModules();
  return {
    connect: await import("./connect-return"),
    outlook: await import("./outlook-web"),
  };
}

function fakeRuntime() {
  const upsertAccount = rs.fn(async () => ({}));
  return { runtime: { calendar: { upsertAccount } } as unknown as ModuoRuntime, upsertAccount };
}

beforeEach(() => {
  sessionStorage.clear();
  h.invoke.mockReset();
  h.getSession.mockReset();
  h.getSession.mockResolvedValue({ data: { session: { user: { email: "me@x.co" } } } });
});

describe("ensureOutlookCalendarAccounts", () => {
  async function connectedBack() {
    const start = await landOn("");
    start.connect.rememberConnectStart(consentUrl);
    h.invoke.mockResolvedValue({ data: { ok: true, email: "ana@outlook.com" }, error: null });
    return await landOn("?connect=microsoft&connect_code=c1&connect_state=st.sig");
  }

  it("adds the login just connected, once", async () => {
    const mod = await connectedBack();
    const { runtime, upsertAccount } = fakeRuntime();
    const opts = { runtime, workspaceId: "w1", accounts: [] };
    expect(await mod.outlook.ensureOutlookCalendarAccounts(opts)).toBe(true);
    expect(h.invoke).toHaveBeenCalledWith("calendar-microsoft-web", {
      body: { action: "finish", code: "c1", state: "st.sig" },
    });
    expect(upsertAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "w1",
        provider: "microsoft",
        externalId: "outlook:ana@outlook.com",
        displayLabel: "ana@outlook.com",
        status: "ok",
      }),
    );
    expect(await mod.outlook.ensureOutlookCalendarAccounts(opts)).toBe(false);
    expect(upsertAccount).toHaveBeenCalledTimes(1);
  });

  it("keeps the mark when adding the account fails, so the next load adds it", async () => {
    const mod = await connectedBack();
    const { runtime, upsertAccount } = fakeRuntime();
    upsertAccount.mockRejectedValueOnce(new Error("offline"));
    const opts = { runtime, workspaceId: "w1", accounts: [] };
    await expect(mod.outlook.ensureOutlookCalendarAccounts(opts)).rejects.toThrow("offline");
    expect(await mod.outlook.ensureOutlookCalendarAccounts(opts)).toBe(true);
    expect(upsertAccount).toHaveBeenCalledTimes(2);
  });

  it("leaves a login that already has a live account, whatever its casing", async () => {
    const mod = await connectedBack();
    const { runtime, upsertAccount } = fakeRuntime();
    const accounts = [
      { provider: "microsoft", externalId: "outlook:Ana@Outlook.com", deletedAt: null },
    ];
    expect(
      await mod.outlook.ensureOutlookCalendarAccounts({ runtime, workspaceId: "w1", accounts }),
    ).toBe(false);
    expect(upsertAccount).not.toHaveBeenCalled();
  });

  it("brings a removed account back, since it was just connected again", async () => {
    const mod = await connectedBack();
    const { runtime, upsertAccount } = fakeRuntime();
    const accounts = [
      {
        provider: "microsoft",
        externalId: "outlook:ana@outlook.com",
        deletedAt: "2026-11-01T00:00:00Z",
      },
    ];
    expect(
      await mod.outlook.ensureOutlookCalendarAccounts({ runtime, workspaceId: "w1", accounts }),
    ).toBe(true);
    expect(upsertAccount).toHaveBeenCalledTimes(1);
  });

  it("adds nothing on a visit that didn't connect, or a connect that failed", async () => {
    const { runtime, upsertAccount } = fakeRuntime();
    const plain = await landOn("");
    expect(
      await plain.outlook.ensureOutlookCalendarAccounts({
        runtime,
        workspaceId: "w1",
        accounts: [],
      }),
    ).toBe(false);
    const start = await landOn("");
    start.connect.rememberConnectStart(consentUrl);
    h.invoke.mockResolvedValue({
      data: null,
      error: {
        context: new Response(JSON.stringify({ error: "microsoft_exchange_failed" }), {
          status: 502,
        }),
      },
    });
    const failed = await landOn("?connect=microsoft&connect_code=c1&connect_state=st.sig");
    expect(
      await failed.outlook.ensureOutlookCalendarAccounts({
        runtime,
        workspaceId: "w1",
        accounts: [],
      }),
    ).toBe(false);
    expect(upsertAccount).not.toHaveBeenCalled();
  });

  it("adds a connect the person confirmed, after they confirm", async () => {
    h.invoke.mockResolvedValue({ data: { ok: true, email: "ana@outlook.com" }, error: null });
    const mod = await landOn("?connect=microsoft&connect_code=c1&connect_state=other.sig");
    const { runtime, upsertAccount } = fakeRuntime();
    const opts = { runtime, workspaceId: "w1", accounts: [] };
    expect(await mod.outlook.ensureOutlookCalendarAccounts(opts)).toBe(false);
    const outcome = await mod.connect.finishConnectReturn();
    if (outcome?.status !== "confirm") throw new Error("expected a confirm");
    expect(outcome.title).toBe("Connect Outlook to me@x.co?");
    await outcome.confirm();
    expect(await mod.outlook.ensureOutlookCalendarAccounts(opts)).toBe(true);
    expect(upsertAccount).toHaveBeenCalledTimes(1);
  });
});

describe("outlookEvents (the runtime's Outlook read)", () => {
  const input = { externalAccountId: "outlook:ana@outlook.com", timeMin: "a", timeMax: "b" };

  function refusal(code: string, status: number) {
    return {
      data: null,
      error: { context: new Response(JSON.stringify({ error: code }), { status }) },
    };
  }

  async function read() {
    rs.resetModules();
    return (await import("../../lib/runtime.web.calendar.outlook")).webCalendarOutlook;
  }

  it("returns the function's events", async () => {
    const outlook = await read();
    h.invoke.mockResolvedValue({ data: { events: [{ id: "e1" }] }, error: null });
    expect(await outlook.outlookEvents?.(input)).toEqual([{ id: "e1" }]);
    expect(h.invoke).toHaveBeenCalledWith("calendar-microsoft-web", {
      body: { action: "events", ...input },
    });
  });

  it("skips a login with no web token, a server without the Microsoft client, or no function yet", async () => {
    const outlook = await read();
    h.invoke.mockResolvedValueOnce(refusal("outlook_not_connected", 409));
    await expect(outlook.outlookEvents?.(input)).rejects.toThrow("web_provider_sync_skipped");
    h.invoke.mockResolvedValueOnce(refusal("outlook_not_configured", 503));
    await expect(outlook.outlookEvents?.(input)).rejects.toThrow("web_provider_sync_skipped");
    // An app shipped before the function: the gateway's own 404 has no `error`.
    h.invoke.mockResolvedValueOnce({
      data: null,
      error: { context: new Response(JSON.stringify({ code: "NOT_FOUND" }), { status: 404 }) },
    });
    await expect(outlook.outlookEvents?.(input)).rejects.toThrow("web_provider_sync_skipped");
  });

  it("fails on a revoked login and on an answer without events (never an empty list)", async () => {
    const outlook = await read();
    h.invoke.mockResolvedValueOnce(refusal("outlook_reauth", 409));
    await expect(outlook.outlookEvents?.(input)).rejects.toThrow("outlook_reauth");
    h.invoke.mockResolvedValueOnce({ data: {}, error: null });
    await expect(outlook.outlookEvents?.(input)).rejects.toThrow("outlook_no_events");
  });
});

describe("outlookErrorText", () => {
  it("says a refusal in words, never the code", async () => {
    const { outlook } = await landOn("");
    expect(outlook.outlookErrorText(new Error("outlook_reauth"))).toBe(
      "Outlook stopped accepting Moduo's access. Connect it again.",
    );
    expect(outlook.outlookErrorText(new Error("microsoft_exchange_failed"))).toBe(
      "Couldn't reach Outlook. Try again.",
    );
  });
});
