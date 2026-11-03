import { afterEach, describe, expect, it } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { MailThreadRow } from "@/lib/runtime.types.mail-engine";

import { createMailCommands } from "../commands/triage";
import { createMailStore } from "../store/mail-store";
import { FollowupNudges, followupNudgeLabel } from "./followup-nudge";

afterEach(cleanup);

const NOW = 10 * 86_400_000;
const row: MailThreadRow = {
  threadId: "t1",
  accountId: "a",
  subject: "Quote",
  snippet: "",
  senders: [
    { name: "Anna", email: "anna@x.com" },
    { name: "Me", email: "me@x.com" },
  ],
  lastDateMs: NOW - 3 * 86_400_000,
  messageCount: 2,
  unread: false,
  pinned: false,
  hasAttachments: false,
  hasInvite: false,
  tab: "personal",
  priority: false,
  muted: false,
  snoozedUntilMs: null,
};

describe("follow-up nudge (AC34, X19)", () => {
  it("names the counterpart, never you, and the days waited", () => {
    expect(followupNudgeLabel(row, ["ME@x.com"], NOW)).toBe("No reply from Anna in 3 days");
    expect(followupNudgeLabel({ ...row, lastDateMs: NOW }, ["me@x.com"], NOW)).toBe(
      "No reply from Anna yet",
    );
  });

  it("Dismiss drops it from the inbox top", () => {
    const store = createMailStore();
    store.setState({ followupsDue: [row] });
    const commands = createMailCommands(store);
    render(
      <FollowupNudges
        rows={store.getState().followupsDue}
        selfAddresses={["me@x.com"]}
        nowMs={NOW}
        onOpen={() => {}}
        onDismiss={(id) => commands.dismissFollowup(id)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(store.getState().followupsDue).toEqual([]);
    expect(store.getState().dismissedFollowups).toEqual(["t1"]);
  });
});
