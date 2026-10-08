import { beforeEach, describe, expect, it, rs } from "@rstest/core";

import { connectReturnUrl } from "../../../supabase/functions/_shared/oauth-connect";
import {
  type ConnectOutcome,
  connectConfirmTitle,
  connectFailureMessage,
  parseConnectReturn,
} from "./connect-return";

const h = rs.hoisted(() => ({
  invoke: rs.fn(),
  getSession: rs.fn(),
}));

rs.mock("../../lib/runtime.web", () => ({
  supabaseClient: { functions: { invoke: h.invoke }, auth: { getSession: h.getSession } },
}));

describe("parseConnectReturn", () => {
  it("reads what the connect function sends back", () => {
    const url = new URL(connectReturnUrl("https://app.moduo.app", "zoom", "4/0Ab+c", "p.q"));
    expect(parseConnectReturn(url.search)).toEqual({
      provider: "zoom",
      code: "4/0Ab+c",
      state: "p.q",
      search: "",
    });
  });

  it("keeps the page's other params", () => {
    expect(
      parseConnectReturn("?event=e1&connect=google&connect_code=c&connect_state=s&x=1")?.search,
    ).toBe("?event=e1&x=1");
  });

  it("returns a declined connect with no code", () => {
    expect(parseConnectReturn("?connect=google")).toEqual({
      provider: "google",
      code: "",
      state: "",
      search: "",
    });
  });

  it("ignores pages that aren't a connect return", () => {
    for (const search of [
      "",
      "?zoom=connected",
      "?connect=outlook&connect_code=c",
      "?code=c&state=s",
    ]) {
      expect(parseConnectReturn(search)).toBeNull();
    }
  });
});

describe("copy", () => {
  it("names the account mix-up", () => {
    expect(connectFailureMessage("zoom", "wrong_account")).toContain("different Moduo account");
    expect(connectFailureMessage("google", "google_exchange_failed")).toBe(
      "Google didn't connect. Try again.",
    );
    expect(connectFailureMessage("zoom", null)).toBe("Zoom didn't connect. Try again.");
  });

  it("names who the connect would land on", () => {
    expect(connectConfirmTitle("zoom", "a@b.co")).toBe("Connect Zoom to a@b.co?");
    expect(connectConfirmTitle("google", null)).toBe("Connect Google to this Moduo account?");
  });
});

describe("finishConnectReturn", () => {
  const consentUrl = "https://zoom.us/oauth/authorize?client_id=x&state=st.sig";

  /** A fresh copy of the module (its outcome is kept per page load), on a page that came back. */
  async function landOn(search: string) {
    window.history.replaceState(null, "", `/calendar${search}`);
    rs.resetModules();
    return await import("./connect-return");
  }

  beforeEach(() => {
    sessionStorage.clear();
    h.invoke.mockReset();
    h.invoke.mockResolvedValue({ data: { ok: true }, error: null });
    h.getSession.mockReset();
    h.getSession.mockResolvedValue({ data: { session: { user: { email: "me@x.co" } } } });
  });

  it("finishes once, without asking, when this tab started it", async () => {
    const start = await landOn("");
    start.rememberConnectStart(consentUrl);
    const mod = await landOn("?event=e1&connect=zoom&connect_code=c1&connect_state=st.sig");
    h.invoke.mockImplementation(async () => {
      expect(window.location.search).toBe("?event=e1");
      return { data: { ok: true }, error: null };
    });
    const outcome = await mod.finishConnectReturn();
    expect(outcome).toEqual({ provider: "zoom", status: "connected" });
    expect(await mod.finishConnectReturn()).toBe(outcome);
    expect(h.invoke).toHaveBeenCalledTimes(1);
    expect(h.invoke).toHaveBeenCalledWith("booking-zoom-connect", {
      body: { action: "finish", code: "c1", state: "st.sig" },
    });
    expect(await mod.takeConnectNotice()).toBe(outcome);
    expect(await mod.takeConnectNotice()).toBeNull();
  });

  it("asks first, naming the signed-in account, when this tab didn't start it", async () => {
    const mod = await landOn("?connect=google&connect_code=c1&connect_state=other.sig");
    const outcome = (await mod.finishConnectReturn()) as Extract<
      ConnectOutcome,
      { status: "confirm" }
    >;
    expect(outcome.status).toBe("confirm");
    expect(outcome.title).toBe("Connect Google to me@x.co?");
    expect(h.invoke).not.toHaveBeenCalled();

    const finished = rs.fn();
    window.addEventListener(mod.CONNECT_FINISHED_EVENT, finished);
    expect(await outcome.confirm()).toEqual({ provider: "google", status: "connected" });
    window.removeEventListener(mod.CONNECT_FINISHED_EVENT, finished);
    expect(h.invoke).toHaveBeenCalledWith("booking-google-connect", {
      body: { action: "finish", code: "c1", state: "other.sig" },
    });
    expect(finished).toHaveBeenCalledTimes(1);
  });

  it("asks when a different connect was started in this tab", async () => {
    const start = await landOn("");
    start.rememberConnectStart(consentUrl);
    const mod = await landOn("?connect=zoom&connect_code=c1&connect_state=attacker.sig");
    expect((await mod.finishConnectReturn())?.status).toBe("confirm");
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("reports the function's wrong_account refusal", async () => {
    const start = await landOn("");
    start.rememberConnectStart(consentUrl);
    const mod = await landOn("?connect=zoom&connect_code=c1&connect_state=st.sig");
    h.invoke.mockResolvedValue({
      data: null,
      error: { context: new Response(JSON.stringify({ error: "wrong_account" }), { status: 403 }) },
    });
    expect(await mod.finishConnectReturn()).toEqual({
      provider: "zoom",
      status: "failed",
      message: connectFailureMessage("zoom", "wrong_account"),
    });
  });

  it("reports a declined connect without calling the function", async () => {
    const mod = await landOn("?connect=google");
    expect((await mod.finishConnectReturn())?.status).toBe("failed");
    expect(window.location.search).toBe("");
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("does nothing on an ordinary page", async () => {
    const mod = await landOn("?event=e1");
    expect(await mod.finishConnectReturn()).toBeNull();
    expect(window.location.search).toBe("?event=e1");
  });
});
