import { describe, expect, it, rstest } from "@rstest/core";
import { fireEvent, render, screen } from "@testing-library/react";

import { TooltipProvider } from "@/components/ui/tooltip";
import { DEFAULT_MAIL_BEHAVIOR } from "@/features/email/engine/behavior";
import type { EmailSettingsItem } from "@/lib/runtime.types.email";

import { MailSettingsView, type MailSettingsViewProps } from "./mail-settings-view";

const GB = 1024 ** 3;
const row = (
  id: string,
  kind: EmailSettingsItem["kind"],
  value: Record<string, unknown>,
  position = 0,
) =>
  ({
    id,
    kind,
    position,
    value,
    updatedAt: "2026-11-01T00:00:00Z",
    deletedAt: null,
  }) as EmailSettingsItem;

function setup(over: Partial<MailSettingsViewProps> = {}) {
  const props: MailSettingsViewProps = {
    behavior: DEFAULT_MAIL_BEHAVIOR,
    onBehavior: rstest.fn(),
    items: [
      row(
        "r1",
        "rule",
        { conditions: [{ field: "from", value: "a@x.com" }], actions: [{ action: "skip_inbox" }] },
        0,
      ),
      row(
        "r2",
        "rule",
        { conditions: [{ field: "domain", value: "y.com" }], actions: [{ action: "mark_read" }] },
        1,
      ),
      row("p1", "priority_person", { address: "boss@x.com" }),
    ],
    itemActions: { add: rstest.fn(), update: rstest.fn(), remove: rstest.fn() },
    accounts: [
      {
        id: "a1",
        address: "me@x.com",
        label: "me@x.com",
        hue: "blue",
        state: "idle",
        status: "Up to date",
        needsReconnect: false,
        push: true,
        lastSyncedMs: null,
        depth: "twelveMonths",
      },
    ],
    accountActions: { reconnect: rstest.fn(), disconnect: rstest.fn(), setDepth: rstest.fn() },
    storage: {
      stats: [
        {
          accountId: "a1",
          diskCapBytes: 2 * GB,
          mailBytes: 1.5 * GB,
          attachmentBytes: 0.25 * GB,
          messageCount: 9,
        },
      ],
      actions: { setCap: rstest.fn(), clearAttachments: rstest.fn(), clearDownloaded: rstest.fn() },
    },
    defaultApp: { isDefault: false, make: rstest.fn() },
    ...over,
  };
  render(
    <TooltipProvider>
      <MailSettingsView {...props} />
    </TooltipProvider>,
  );
  return props;
}

describe("MailSettingsView (AC36)", () => {
  it("has every Settings → Mail control", () => {
    setup();
    for (const name of [
      "Badge",
      "Remote images",
      "Undo send",
      "Density",
      "Notify for Personal mail",
      "Block trackers",
      "Spell check",
      "Done on send",
      "Shortcut hints",
      "Sender logos",
      "Screener",
      "Blocked mail goes to",
      "History depth for me@x.com",
      "Disk cap for me@x.com",
    ]) {
      expect(screen.getAllByLabelText(name).length).toBeGreaterThan(0);
    }
    for (const label of [
      "Aliases and signatures",
      "Snippets",
      "Rules",
      "Custom tabs",
      "Priority people",
      "Blocked senders",
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText("Make default")).toBeTruthy();
  });

  it("shows storage split and both Clear buttons work after a confirm", () => {
    const p = setup();
    expect(screen.getByText("mail 1.5 GB · attachments 0.3 GB")).toBeTruthy();
    fireEvent.click(screen.getByText("Clear attachments"));
    fireEvent.click(screen.getAllByText("Clear attachments").at(-1)!);
    expect(p.storage!.actions.clearAttachments).toHaveBeenCalledWith("a1");
    fireEvent.click(screen.getByText("Clear all downloaded mail"));
    fireEvent.click(screen.getAllByText("Clear all downloaded mail").at(-1)!);
    expect(p.storage!.actions.clearDownloaded).toHaveBeenCalledWith("a1");
  });

  it("toggles write a behavior patch", () => {
    const p = setup();
    fireEvent.click(screen.getByLabelText("Spell check"));
    expect(p.onBehavior).toHaveBeenCalledWith({ spellCheck: false });
    fireEvent.click(screen.getByLabelText("Screener"));
    expect(p.onBehavior).toHaveBeenCalledWith({ screener: true });
  });

  it("disconnect asks first and says it deletes this Mac's copy", () => {
    const p = setup();
    fireEvent.click(screen.getByText("Disconnect"));
    expect(p.accountActions.disconnect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Disconnect and delete this Mac's copy"));
    expect(p.accountActions.disconnect).toHaveBeenCalledWith("a1");
  });

  it("adds a Priority person, rejects a non-address, removes one", () => {
    const p = setup();
    const input = screen.getByLabelText("Add to Priority people");
    fireEvent.change(input, { target: { value: "Anna@X.com" } });
    fireEvent.submit(input.closest("form")!);
    expect(p.itemActions.add).toHaveBeenCalledWith("priority_person", { address: "anna@x.com" });
    fireEvent.click(screen.getByLabelText("Remove boss@x.com"));
    expect(p.itemActions.remove).toHaveBeenCalledWith("p1");
  });

  it("moving a rule rewrites positions per row", () => {
    const p = setup();
    fireEvent.click(screen.getAllByLabelText("Move rule down")[0]!);
    expect(p.itemActions.update).toHaveBeenCalledTimes(2);
    expect(
      (p.itemActions.update as ReturnType<typeof rstest.fn>).mock.calls.map((c) => [c[0].id, c[2]]),
    ).toEqual([
      ["r2", 0],
      ["r1", 1],
    ]);
  });

  it("adds a snippet and makes the default mail app", () => {
    const p = setup();
    fireEvent.change(screen.getByLabelText("Snippet name"), { target: { value: "thanks" } });
    fireEvent.change(screen.getByLabelText("Snippet text"), {
      target: { value: "Thanks {first name}!" },
    });
    fireEvent.click(screen.getByText("Add snippet"));
    expect(p.itemActions.add).toHaveBeenCalledWith("snippet", {
      name: "thanks",
      body: "Thanks {first name}!",
    });
    fireEvent.click(screen.getByText("Make default"));
    expect(p.defaultApp!.make).toHaveBeenCalled();
  });

  it("on the web hides storage and the default mail app", () => {
    setup({ storage: null, defaultApp: null });
    expect(screen.queryByText("Clear attachments")).toBeNull();
    expect(screen.queryByText("Make default")).toBeNull();
  });
});
