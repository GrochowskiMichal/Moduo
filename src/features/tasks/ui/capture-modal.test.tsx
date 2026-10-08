// Capture during a run adds to my queue by default (TV-F2, F2-5); elsewhere
// the "Add to my queue" switch starts off.

import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

rs.mock("../assignees", () => ({
  useAssignees: () => ({
    assignees: [{ userId: "u1", name: "Me", avatarUrl: null, isMe: true, canTakeTasks: true }],
    currentUserId: "u1",
    byId: () => null,
  }),
  previewAssign: async () => null,
  initialsOf: (name: string) => name.slice(0, 2).toUpperCase(),
}));

import { TooltipProvider } from "../../../components/ui/tooltip";
import type { Bucket } from "../model";
import { CaptureModal } from "./capture-modal";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});
afterEach(cleanup);

const inbox = { id: "inbox", name: "Inbox" } as Bucket;

function renderCapture(queueByDefault: boolean) {
  const onCreate = rs.fn();
  render(
    <TooltipProvider>
      <CaptureModal
        open
        onOpenChange={() => {}}
        buckets={[]}
        inbox={inbox}
        defaultBucketId="inbox"
        queueByDefault={queueByDefault}
        onCreate={onCreate}
      />
    </TooltipProvider>,
  );
  return onCreate;
}

describe("capture and my queue (F2-5)", () => {
  it("during a run, a capture joins my queue unless I switch it off", () => {
    const onCreate = renderCapture(true);
    const toggle = screen.getByRole("switch", { name: "Add to my queue" });
    expect(toggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.change(screen.getByPlaceholderText("Task title"), { target: { value: "Call Ola" } });
    fireEvent.click(screen.getByRole("button", { name: /^Create/ }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ title: "Call Ola" }), {
      queue: true,
    });
  });

  it("outside a run it starts off", () => {
    const onCreate = renderCapture(false);
    expect(
      screen.getByRole("switch", { name: "Add to my queue" }).getAttribute("aria-checked"),
    ).toBe("false");
    fireEvent.change(screen.getByPlaceholderText("Task title"), { target: { value: "Call Ola" } });
    fireEvent.click(screen.getByRole("button", { name: /^Create/ }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ title: "Call Ola" }), {
      queue: false,
    });
  });
});
