import { describe, expect, it } from "@rstest/core";
import { act, fireEvent, render } from "@testing-library/react";

import { TooltipProvider } from "@/components/ui/tooltip";

import { createFakeCompose } from "../testing/fake-compose";
import { MailComposer } from "./mail-composer";
import { type ComposeOpenSpec, createComposeSession } from "./session";

const spec = (p: Partial<ComposeOpenSpec> = {}): ComposeOpenSpec => ({
  kind: "reply",
  placement: "inline",
  accountId: "acc",
  threadId: "t1",
  fromAddr: "me@x.com",
  fromName: "Me",
  to: "anna@x.com",
  cc: "",
  bcc: "",
  subject: "Re: Hi",
  bodyHtml: "",
  inReplyTo: "<m1@x>",
  references: [],
  attachments: [],
  fromInbox: true,
  ...p,
});

function setup() {
  const port = createFakeCompose();
  const session = createComposeSession({
    port,
    settings: () => ({ undoSeconds: 10, doneOnSend: true }),
    markDone: () => {},
  });
  return { port, session };
}

describe("MailComposer (AC20)", () => {
  it("inline reply: opens under the thread and saves as you type", async () => {
    const { port, session } = setup();
    const ui = render(
      <TooltipProvider>
        <MailComposer session={session} />
      </TooltipProvider>,
    );
    await act(() => session.open(spec()).then(() => {}));
    const region = ui.getByRole("region", { name: "Reply" });
    expect(region.getAttribute("data-placement")).toBe("inline");
    await act(async () => {
      fireEvent.change(ui.getByLabelText("Message"), { target: { value: "Sounds good" } });
      await session.flush();
    });
    const drafts = await port.listDrafts();
    expect(drafts[0].doc.text).toBe("Sounds good");
  });

  it("one active compose saves draft: starting another keeps the first as a draft", async () => {
    const { port, session } = setup();
    const ui = render(
      <TooltipProvider>
        <MailComposer session={session} />
      </TooltipProvider>,
    );
    await act(() => session.open(spec()).then(() => {}));
    await act(async () => {
      fireEvent.change(ui.getByLabelText("Message"), { target: { value: "First" } });
      await session.flush();
    });
    await act(() =>
      session.open(spec({ kind: "new", placement: "pane", threadId: null, to: "" })).then(() => {}),
    );
    expect(ui.getByRole("region", { name: "New message" })).toBeTruthy();
    expect(ui.queryByRole("region", { name: "Reply" })).toBeNull();
    const drafts = await port.listDrafts();
    expect(drafts.map((d) => d.doc.text)).toContain("First");
  });

  it("⌘Enter without recipients shows the reason", async () => {
    const { session } = setup();
    const ui = render(
      <TooltipProvider>
        <MailComposer session={session} />
      </TooltipProvider>,
    );
    await act(() => session.open(spec({ to: "" })).then(() => {}));
    await act(async () => {
      fireEvent.keyDown(ui.getByLabelText("Message"), { key: "Enter", metaKey: true });
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(ui.getByRole("alert").textContent).toBe("Add a recipient.");
  });

  it("attaches picked files by opaque staging id, never a path", async () => {
    const { port, session } = setup();
    const ui = render(
      <TooltipProvider>
        <MailComposer
          session={session}
          pickFiles={async () => [{ id: "stg-1", filename: "a.pdf", size: 3 }]}
        />
      </TooltipProvider>,
    );
    await act(() => session.open(spec()).then(() => {}));
    await act(async () => {
      fireEvent.click(ui.getByRole("button", { name: "Attach files" }));
      await new Promise((r) => setTimeout(r, 0));
      await session.flush();
    });
    const att = (await port.listDrafts())[0].doc.attachments[0];
    expect(att.id).toBe("stg-1");
    expect("path" in att).toBe(false);
  });
});

import { outboxLabel, OutboxView } from "./outbox-view";

describe("OutboxView (AC22)", () => {
  const item = {
    id: "o",
    accountId: "a",
    draftId: "d",
    subject: "Hi",
    to: ["x@y.com"],
    state: "queued",
    attempts: 0,
    lastError: null,
    notBeforeMs: 5000,
  };
  it("labels the window and offline wait, and Edit reopens", () => {
    expect(outboxLabel(item, 1000)).toBe("Sends in 4 s");
    expect(outboxLabel(item, 9000)).toBe("Waiting for connection");
    const edited: string[] = [];
    const ui = render(<OutboxView items={[item]} nowMs={1000} onEdit={(id) => edited.push(id)} />);
    fireEvent.click(ui.getByText("Edit"));
    expect(edited).toEqual(["o"]);
  });
});
