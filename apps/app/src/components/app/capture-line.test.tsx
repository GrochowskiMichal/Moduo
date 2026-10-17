// SH-1 (tasks-v3 calls 90b, 91) — the one-line capture body every type uses
// today: ⏎ creates through the module's op and closes, ⌘⏎ creates and stays
// for the next one, a double ⏎ creates once, and a type you can't create never
// reaches the server and says so in one line.
import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

const h = rs.hoisted(() => ({
  create: rs.fn(),
  toast: Object.assign(rs.fn(), { error: rs.fn() }),
  refresh: rs.fn(),
}));

rs.mock("sonner", () => ({ toast: h.toast }));
rs.mock("@tanstack/react-router", () => ({ useNavigate: () => () => {} }));
rs.mock("../../providers/auth-provider", () => ({ useAuth: () => ({ runtime: {} }) }));
rs.mock("../../providers/workspace-provider", () => ({
  useWorkspace: () => ({ selectedWorkspaceId: "ws-1" }),
}));
rs.mock("../../features/dashboard/context/dashboard-data-context", () => ({
  requestDashboardDataRefresh: h.refresh,
}));
// The write path is capture-command's own test; here only what the line does
// with its result. isPermissionError keeps the real rule's "edit access" match.
rs.mock("../../features/spine/capture-command", () => ({
  CAPTURE_ROUTES: [{ target: "note", label: "Note", openTo: "/notes", lane: "notes" }],
  canWriteRoute: () => true,
  createCapturedEntity: h.create,
  isPermissionError: (message: string | null | undefined) =>
    Boolean(message?.toLowerCase().includes("edit access")),
}));

import { lineCaptureBody } from "./capture-line";

const NoteLine = lineCaptureBody({
  target: "note",
  plural: "notes",
  placeholder: "Capture a note…",
});

function Harness({ writable = true, onDone }: { writable?: boolean; onDone: () => void }) {
  const [draft, setDraft] = useState("");
  return <NoteLine draft={draft} onDraftChange={setDraft} writable={writable} onDone={onDone} />;
}

const field = () => screen.getByRole("textbox", { name: "Capture a note…" }) as HTMLInputElement;

async function type(text: string) {
  fireEvent.change(field(), { target: { value: text } });
}

async function enter(init: KeyboardEventInit = {}) {
  await act(async () => {
    fireEvent.keyDown(field(), { key: "Enter", ...init });
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  h.create.mockReset();
  h.create.mockResolvedValue({
    target: "note",
    title: "Pick up keys",
    description: "Added to Notes",
    openTo: "/notes",
  });
  h.toast.mockReset();
  h.toast.error.mockReset();
  h.refresh.mockReset();
});
afterEach(cleanup);

describe("the capture line", () => {
  it("⏎ creates through the module's op and closes", async () => {
    const onDone = rs.fn();
    render(<Harness onDone={onDone} />);
    await type("Pick up keys");
    await enter();
    expect(h.create).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "ws-1", target: "note", body: "Pick up keys" }),
    );
    expect(h.toast).toHaveBeenCalledWith("Pick up keys", expect.anything());
    expect(h.refresh).toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("⌘⏎ creates, clears the line and stays open for the next one", async () => {
    const onDone = rs.fn();
    render(<Harness onDone={onDone} />);
    await type("Pick up keys");
    await enter({ metaKey: true });
    expect(h.create).toHaveBeenCalledTimes(1);
    expect(field().value).toBe("");
    expect(onDone).not.toHaveBeenCalled();
  });

  it("a double ⏎ creates once", async () => {
    let resolve: (v: unknown) => void = () => {};
    h.create.mockImplementation(() => new Promise((r) => (resolve = r)));
    render(<Harness onDone={() => {}} />);
    await type("Pick up keys");
    await enter();
    await enter();
    expect(h.create).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve({ target: "note", title: "Pick up keys", description: "", openTo: "/notes" });
    });
  });

  it("an empty line does nothing", async () => {
    render(<Harness onDone={() => {}} />);
    await type("   ");
    await enter();
    expect(h.create).not.toHaveBeenCalled();
  });

  it("a type you can't create says so and never writes", async () => {
    const onDone = rs.fn();
    render(<Harness writable={false} onDone={onDone} />);
    expect(screen.getByText("You have view-only access to notes.")).toBeTruthy();
    await type("Pick up keys");
    await enter();
    expect(h.create).not.toHaveBeenCalled();
    expect(h.toast.error).toHaveBeenCalledWith("You have view-only access to notes.");
    expect(onDone).not.toHaveBeenCalled();
  });

  it("a refusal from the server reads as view-only, and the line stays", async () => {
    h.create.mockRejectedValue(new Error("You don't have edit access to Notes"));
    const onDone = rs.fn();
    render(<Harness onDone={onDone} />);
    await type("Pick up keys");
    await enter();
    expect(h.toast.error).toHaveBeenCalledWith("You have view-only access to notes.");
    expect(field().value).toBe("Pick up keys");
    expect(onDone).not.toHaveBeenCalled();
  });
});
