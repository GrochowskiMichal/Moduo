// specs/mail-improve.md MI-0, AC21: typing a partial `;;` name shows the offer under the
// caret before anything is inserted (name, first line, "Tab to insert", "↑↓ n of m",
// "Esc dismiss"); it stays until Tab inserts or Esc dismisses.

import { afterEach, describe, expect, it } from "@rstest/core";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";

import { TooltipProvider } from "@/components/ui/tooltip";

import { createFakeCompose } from "../testing/fake-compose";
import { MailComposer } from "./mail-composer";
import { type ComposeOpenSpec, createComposeSession } from "./session";

afterEach(cleanup);

const spec: ComposeOpenSpec = {
  kind: "reply",
  accountId: "acc",
  threadId: "t1",
  fromAddr: "me@x.com",
  fromName: "Me",
  to: "Anna Lee <anna@x.com>",
  cc: "",
  bcc: "",
  subject: "Re: Hi",
  bodyHtml: "",
  inReplyTo: "<m1@x>",
  references: [],
  attachments: [],
  fromInbox: true,
};

const SNIPPETS = [
  { id: "1", name: "thanks", body: "Thanks {first name}, talk soon.\nRobin" },
  { id: "2", name: "thanks-long", body: "Thank you so much, {first name}." },
  { id: "3", name: "later", body: "Later this week works." },
];

async function mount() {
  const session = createComposeSession({
    port: createFakeCompose(),
    settings: () => ({ undoSeconds: 10, doneOnSend: true }),
    markDone: () => {},
  });
  const ui = render(
    <TooltipProvider>
      <MailComposer session={session} snippets={SNIPPETS} />
    </TooltipProvider>,
  );
  await act(() => session.open(spec).then(() => {}));
  const field = ui.getByLabelText("Message") as HTMLTextAreaElement;
  return { ui, session, field };
}

describe("partial trigger shows the offer (AC21)", () => {
  it(";;tha offers before inserting, with its footer, and stays until Tab", async () => {
    const { ui, session, field } = await mount();
    fireEvent.change(field, { target: { value: "Hi ;;tha" } });
    const list = ui.getByRole("listbox", { name: "Snippets" });
    const options = within(list).getAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]!.getAttribute("aria-selected")).toBe("true");
    // Nothing inserted yet.
    expect(field.value).toBe("Hi ;;tha");
    const offer = ui.getByRole("group", { name: "Snippet offer" });
    within(offer).getByText("Tab to insert");
    within(offer).getByText("1 of 2");
    within(offer).getByText("Esc dismiss");
    // Typing on keeps it.
    fireEvent.change(field, { target: { value: "Hi ;;than" } });
    ui.getByRole("listbox", { name: "Snippets" });
    fireEvent.keyDown(field, { key: "ArrowDown" });
    within(ui.getByRole("group", { name: "Snippet offer" })).getByText("2 of 2");
    fireEvent.keyDown(field, { key: "ArrowUp" });
    await act(async () => {
      fireEvent.keyDown(field, { key: "Tab" });
      await session.flush();
    });
    expect(field.value).toBe("Hi Thanks Anna, talk soon.\nRobin");
    expect(ui.queryByRole("listbox", { name: "Snippets" })).toBeNull();
  });

  it("Esc dismisses and leaves the text", async () => {
    const { ui, field } = await mount();
    fireEvent.change(field, { target: { value: "Hi ;;tha" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(ui.queryByRole("listbox", { name: "Snippets" })).toBeNull();
    expect(field.value).toBe("Hi ;;tha");
  });
});
