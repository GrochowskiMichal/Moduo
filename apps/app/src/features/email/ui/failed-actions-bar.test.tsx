import { describe, expect, it } from "@rstest/core";
import { fireEvent, render } from "@testing-library/react";

import type { MailOpRecord } from "@/lib/runtime.types.mail-engine";

import { FailedActionsBar } from "./failed-actions-bar";

const op = (opId: string): MailOpRecord => ({
  opId,
  kind: "done",
  threadIds: ["t"],
  state: "failed",
  attempts: 3,
  lastError: "Server said no",
  createdAtMs: 0,
});

describe("FailedActionsBar (AC12)", () => {
  it("renders nothing without failures", () => {
    const { container } = render(
      <FailedActionsBar failed={[]} onRetry={() => {}} onDiscard={() => {}} />,
    );
    expect(container.textContent).toBe("");
  });

  it("names the count and reason, and Retry/Discard pass every op", () => {
    const retried: string[][] = [];
    const discarded: string[][] = [];
    const ui = render(
      <FailedActionsBar
        failed={[op("a"), op("b")]}
        onRetry={(ids) => retried.push(ids)}
        onDiscard={(ids) => discarded.push(ids)}
      />,
    );
    ui.getByText("Couldn't sync 2 actions");
    ui.getByText(/Server said no/);
    fireEvent.click(ui.getByRole("button", { name: "Retry" }));
    fireEvent.click(ui.getByRole("button", { name: "Discard" }));
    expect(retried).toEqual([["a", "b"]]);
    expect(discarded).toEqual([["a", "b"]]);
  });
});
