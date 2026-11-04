import { afterEach, describe, expect, it } from "@rstest/core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { createTauriMailEngine } from "@/lib/runtime.tauri.mail-engine";
import type { MailThreadRow } from "@/lib/runtime.types.mail-engine";

import { createMailCommands } from "../commands/triage";
import { createMailStore } from "../store/mail-store";
import { decideNewSender, groupNewSenders, NewSendersPanel } from "./new-senders-panel";

afterEach(cleanup);

const row = (threadId: string, email: string, name = "Ann"): MailThreadRow => ({
  threadId,
  accountId: "a1",
  subject: "Hi",
  snippet: "",
  senders: [{ name, email }],
  lastDateMs: 0,
  messageCount: 1,
  unread: true,
  pinned: false,
  hasAttachments: false,
  hasInvite: false,
  tab: "personal",
  priority: false,
  muted: false,
  snoozedUntilMs: null,
});

describe("New senders Allow / Block (AC27, AC28)", () => {
  it("groups threads by sender address, case-insensitively", () => {
    const g = groupNewSenders([row("t1", "Ann@X.com"), row("t2", "ann@x.com"), row("t3", "b@y.com", "Bo")]);
    expect(g.map((s) => [s.address, s.threadIds])).toEqual([
      ["ann@x.com", ["t1", "t2"]],
      ["b@y.com", ["t3"]],
    ]);
  });

  it("Block writes a blocked sender and Allow a screener decision, then releases on the real engine path", async () => {
    const invoked: [string, unknown][] = [];
    const engine = createTauriMailEngine(async <T,>(cmd: string, args?: Record<string, unknown>) => {
      invoked.push([cmd, args]);
      return undefined as T;
    });
    const store = createMailStore();
    store.setState({ engine });
    const commands = createMailCommands(store);
    const saved: unknown[] = [];
    const save = async (kind: string, value: Record<string, unknown>) => void saved.push([kind, value]);
    render(
      <NewSendersPanel
        rows={[row("t1", "ann@x.com"), row("t2", "b@y.com", "Bo")]}
        onDecide={(s, d) => decideNewSender(s, d, { commands, save })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Block Ann" }));
    fireEvent.click(screen.getByRole("button", { name: "Allow Bo" }));
    await waitFor(() => expect(invoked.length).toBe(2));
    expect(saved).toEqual([
      ["blocked_sender", { address: "ann@x.com" }],
      ["screener_decision", { address: "b@y.com", decision: "allow" }],
    ]);
    expect(invoked).toEqual([
      ["mail_release_new_senders", { threadIds: ["t1"] }],
      ["mail_release_new_senders", { threadIds: ["t2"] }],
    ]);
  });
});
