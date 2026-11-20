// The desktop account lifecycle over the rebuilt engine (connect, disconnect,
// depth, Sync now / Reconnect, server search, classify push). Command names
// are the contract `commands/mail_accounts.rs` registers; the engine's
// account rows are mapped to the connect dialog's `SavedAccount` shape.

import { normalizeEmailProvider } from "@contracts/vocabularies";
import { invoke } from "@tauri-apps/api/core";

import type { EmailRuntime, EmailSettingsItem } from "./runtime.types.email";

type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

type EngineRow = Record<string, unknown>;

/** An engine account row → the legacy `SavedAccount` shape the dialog and
 *  Settings read (`syncState` is kept so Settings shows the live state). */
export function toSavedAccount(r: EngineRow) {
  const state = String(r.syncState ?? "idle");
  const provider = r.provider === "google_workspace" ? "gmail" : normalizeEmailProvider(r.provider);
  return {
    id: String(r.id ?? ""),
    provider,
    email: String(r.address ?? ""),
    displayName: String(r.displayName ?? ""),
    lastSyncAt: null,
    status: state === "reconnect" ? "reauth_required" : state === "error" ? "error" : "active",
    lastError: (r.lastError as string | null) ?? null,
    historyDepth: String(r.historyDepth ?? "twelveMonths"),
    syncState: state,
    backfillProgress: (r.backfillProgress as number | null) ?? null,
  };
}

export type MailAccountsPort = Pick<
  EmailRuntime,
  | "listAccounts"
  | "connectAndSave"
  | "startGoogleOAuth"
  | "disconnect"
  | "setHistoryDepth"
  | "syncNow"
  | "searchServer"
> & {
  setClassifyItems(
    items: Pick<EmailSettingsItem, "id" | "kind" | "position" | "value">[],
  ): Promise<void>;
};

export function createTauriMailAccounts(call: Invoke = invoke): MailAccountsPort {
  return {
    listAccounts: async () => (await call<EngineRow[]>("mail_list_accounts")).map(toSavedAccount),
    connectAndSave: async (input) => {
      const { workspaceId: _w, ...rest } = (input ?? {}) as Record<string, unknown>;
      return toSavedAccount(await call<EngineRow>("mail_connect_password", { input: rest }));
    },
    startGoogleOAuth: async (input) => {
      const { workspaceId: _w, provider, ...rest } = (input ?? {}) as Record<string, unknown>;
      const row = await call<EngineRow>("mail_connect_oauth", {
        input: { provider: provider ?? "gmail", ...rest },
      });
      return toSavedAccount(row);
    },
    disconnect: (accountId, opts) =>
      call("mail_disconnect", { accountId, confirmed: opts?.confirmed ?? false }),
    setHistoryDepth: async (input) =>
      toSavedAccount(await call<EngineRow>("mail_set_history_depth", input)),
    syncNow: (input) => call("mail_sync_now", { accountId: input?.accountId ?? null }),
    searchServer: (input) => call("mail_search_server", { input }),
    setClassifyItems: (items) => call("mail_set_classify_items", { items }),
  };
}
