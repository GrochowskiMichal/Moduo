import { describe, expect, it } from "@rstest/core";

import { createTauriMailAccounts, toSavedAccount } from "./runtime.tauri.mail-accounts";

const row = {
  id: "imap:a@corp.io",
  address: "a@corp.io",
  displayName: "",
  provider: "imap",
  hue: 1,
  syncState: "reconnect",
  backfillProgress: null,
  lastError: "reconnect",
  historyDepth: "sixMonths",
};

describe("tauri mail accounts", () => {
  it("maps engine rows to the connect dialog's account shape", () => {
    expect(toSavedAccount(row)).toMatchObject({
      id: "imap:a@corp.io",
      provider: "custom",
      email: "a@corp.io",
      status: "reauth_required",
      historyDepth: "sixMonths",
      syncState: "reconnect",
    });
    expect(toSavedAccount({ ...row, syncState: "idle", provider: "gmail" }).status).toBe("active");
  });

  it("routes every lifecycle call to the engine's mail_* commands", async () => {
    const calls: [string, unknown][] = [];
    const port = createTauriMailAccounts(async <T>(cmd: string, args?: Record<string, unknown>) => {
      calls.push([cmd, args]);
      if (cmd === "mail_list_accounts") return [row] as T;
      if (cmd === "mail_disconnect") return { status: "purged" } as T;
      if (cmd === "mail_search_server") return { status: "ok", envelopes: [] } as T;
      return row as T;
    });
    expect(await port.listAccounts()).toHaveLength(1);
    await port.connectAndSave({ provider: "icloud", email: "a@icloud.com", password: "p" });
    await port.startGoogleOAuth({ historyDepth: "everything" });
    await port.startGoogleOAuth({ provider: "outlook", email: "o@x.com" });
    expect(await port.disconnect("a")).toEqual({ status: "purged" });
    await port.disconnect("a", { confirmed: true });
    await port.setHistoryDepth({ accountId: "a", depth: "everything" });
    await port.syncNow({ accountId: "a" });
    await port.searchServer({ accountId: "a", query: "x" });
    expect(calls.map(([c]) => c)).toEqual([
      "mail_list_accounts",
      "mail_connect_password",
      "mail_connect_oauth",
      "mail_connect_oauth",
      "mail_disconnect",
      "mail_disconnect",
      "mail_set_history_depth",
      "mail_sync_now",
      "mail_search_server",
    ]);
    expect(calls[2]![1]).toEqual({ input: { provider: "gmail", historyDepth: "everything" } });
    expect(calls[3]![1]).toEqual({ input: { provider: "outlook", email: "o@x.com" } });
    expect(calls[5]![1]).toEqual({ accountId: "a", confirmed: true });
    expect(calls[7]![1]).toEqual({ accountId: "a" });
  });

  it("pushes the classify items for the worker", async () => {
    const calls: [string, unknown][] = [];
    const port = createTauriMailAccounts(async <T>(cmd: string, args?: Record<string, unknown>) => {
      calls.push([cmd, args]);
      return undefined as T;
    });
    await port.setClassifyItems([{ id: "1", kind: "blocked_sender", position: 0, value: {} }]);
    expect(calls).toEqual([
      [
        "mail_set_classify_items",
        { items: [{ id: "1", kind: "blocked_sender", position: 0, value: {} }] },
      ],
    ]);
  });
});
