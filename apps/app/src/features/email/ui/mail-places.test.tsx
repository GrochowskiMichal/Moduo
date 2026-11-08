// specs/mail-improve.md MI-0, AC19: a failed send leads with its cause, unclipped, on two
// lines at most; the action fits the cause. A size limit offers "Remove {file} and send"
// plus Edit (no Retry) and flags the attachment chip; a transient failure offers Retry
// plus Edit; an unknown cause shows the server's words with Retry plus Edit.

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import type { MailDraftRow } from "@/lib/runtime.types.mail-compose";

import { createFakeCompose } from "../testing/fake-compose";
import { FailedSends, sendFailure } from "./mail-places";

afterEach(cleanup);

const tick = () => act(async () => await new Promise((r) => setTimeout(r, 0)));

describe("failed send leads with the cause and fits the action (AC19)", () => {
  it("reads the cause from the server's words", () => {
    const deck = [{ filename: "Deck v4.pdf", size: 31_000_000 }];
    expect(
      sendFailure("552 5.3.4 Message size exceeds fixed limit (attachment over 25 MB)", deck),
    ).toEqual({
      kind: "size",
      cause: "Server refused: attachment over 25 MB",
      file: "Deck v4.pdf",
    });
    expect(sendFailure("The server didn't answer in 30 seconds", [])).toEqual({
      kind: "transient",
      cause: "The server didn't answer in 30 seconds",
      file: null,
    });
    expect(sendFailure("The server refused the address dana@northzone.tst", [])).toEqual({
      kind: "unknown",
      cause: "The server refused the address dana@northzone.tst",
      file: null,
    });
  });

  it("size limit: cause first, Remove {file} and send, Edit, the flagged chip", async () => {
    const port = createFakeCompose({ scenario: ["sendFailedSize"] });
    const onFix = rs.fn<(d: MailDraftRow) => void>();
    const onRemoveAndSend = rs.fn<(d: MailDraftRow, file: string) => void>();
    render(
      <FailedSends port={port} refreshKey="1" onFix={onFix} onRemoveAndSend={onRemoveAndSend} />,
    );
    await tick();
    const list = screen.getByRole("list", { name: "Not sent" });
    const alert = within(list).getByRole("alert");
    expect(alert.textContent).toBe("Not sent · Server refused: attachment over 25 MB");
    // Two lines at most, never a single-line clip.
    expect(alert.className).toContain("line-clamp-2");
    expect(alert.className).not.toContain("truncate");
    expect(within(list).queryByRole("button", { name: /^Retry/ })).toBeNull();
    const chip = list.querySelector<HTMLElement>("[data-attachment-flag]")!;
    expect(chip.className).toContain("text-warning");
    fireEvent.click(within(list).getByRole("button", { name: /^Remove .+ and send$/ }));
    expect(onRemoveAndSend).toHaveBeenCalledTimes(1);
    expect(onRemoveAndSend.mock.calls[0]![1]).toBe(chip.dataset.attachmentFlag);
    fireEvent.click(within(list).getByRole("button", { name: "Edit" }));
    expect(onFix).toHaveBeenCalledTimes(1);
  });

  it("anything else: the cause, Retry and Edit", async () => {
    const port = createFakeCompose({ scenario: ["sendFailed"] });
    const onRetry = rs.fn<(d: MailDraftRow) => void>();
    render(<FailedSends port={port} refreshKey="1" onFix={() => {}} onRetry={onRetry} />);
    await tick();
    const list = screen.getByRole("list", { name: "Not sent" });
    expect(within(list).getByRole("alert").textContent).toBe(
      "Not sent · The server refused the address dana@northzone.tst",
    );
    fireEvent.click(within(list).getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    within(list).getByRole("button", { name: "Edit" });
    expect(within(list).queryByRole("button", { name: /^Remove/ })).toBeNull();
  });
});
