import { afterEach, describe, expect, it } from "@rstest/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { createTauriMailEngine } from "@/lib/runtime.tauri.mail-engine";
import type { MailAccount } from "@/lib/runtime.types.mail-engine";

import { createMailCommands } from "../commands/triage";
import { createMailStore } from "../store/mail-store";
import { MailRail } from "./mail-rail";

afterEach(cleanup);

const account = (syncState: MailAccount["syncState"], backfillProgress: number | null) =>
  ({
    id: "a1",
    address: "me@x.com",
    displayName: "Me",
    provider: "imap",
    hue: 0,
    syncState,
    backfillProgress,
    lastError: null,
  }) as MailAccount;

function setup(acc: MailAccount) {
  const invoked: [string, unknown][] = [];
  const engine = createTauriMailEngine(async <T,>(cmd: string, args?: Record<string, unknown>) => {
    invoked.push([cmd, args]);
    return undefined as T;
  });
  const store = createMailStore();
  store.setState({ engine });
  const commands = createMailCommands(store);
  render(
    <MailRail
      current={{ kind: "unified", role: "inbox" }}
      counts={null}
      accounts={[acc]}
      mailboxes={{}}
      hues={{}}
      outboxCount={0}
      screenerOn={false}
      onSelect={() => {}}
      onConnect={() => {}}
      onLoadHistory={(id) => void commands.backfill(id)}
      onCancelBackfill={(id) => void commands.cancelBackfill(id)}
    />,
  );
  return invoked;
}

describe("rail history backfill (AC6)", () => {
  it("Load more history starts a backfill on the engine", async () => {
    const invoked = setup(account("idle", null));
    fireEvent.click(screen.getByRole("button", { name: "Load more history" }));
    await waitFor(() => expect(invoked).toEqual([["mail_backfill", { accountId: "a1" }]]));
  });

  it("while backfilling it shows progress with Cancel instead", async () => {
    const invoked = setup(account("backfilling", 0.4));
    expect(screen.queryByRole("button", { name: "Load more history" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(invoked).toEqual([["mail_cancel_backfill", { accountId: "a1" }]]));
  });
});
