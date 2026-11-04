import { describe, expect, it } from "@rstest/core";
import { fireEvent, render } from "@testing-library/react";

import { msg, row } from "../testing/intel-fixtures";
import { ContactMailPanel } from "./contact-mail";

const rows = [
  row({ threadId: "t1", from: "ann@x.test", subject: "Lunch", lastDateMs: 1 }),
  row({ threadId: "t2", from: "bob@x.test", subject: "Other", lastDateMs: 2 }),
];
const messages = [
  msg({
    id: "m1",
    threadId: "t1",
    from: "ann@x.test",
    attachments: [
      {
        id: "a",
        filename: "menu.pdf",
        mime: "application/pdf",
        size: 10,
        isInline: false,
        contentId: null,
      },
    ],
  }),
  msg({
    id: "m2",
    threadId: "t2",
    from: "bob@x.test",
    attachments: [
      {
        id: "b",
        filename: "bob.pdf",
        mime: "application/pdf",
        size: 10,
        isInline: false,
        contentId: null,
      },
    ],
  }),
];

describe("ContactMailPanel (AC30)", () => {
  it("lists the person's mail and files only", () => {
    const opened: string[] = [];
    const ui = render(
      <ContactMailPanel
        email="Ann@x.test"
        name="Ann"
        rows={rows}
        messages={messages}
        nowMs={1}
        suggestAdd={false}
        onOpenThread={(t) => opened.push(t)}
        onPreview={() => {}}
        onAddContact={() => {}}
      />,
    );
    expect(ui.getByText("Lunch")).toBeTruthy();
    expect(ui.queryByText("Other")).toBeNull();
    expect(ui.getByText("menu.pdf")).toBeTruthy();
    expect(ui.queryByText("bob.pdf")).toBeNull();
    expect(ui.queryByRole("button", { name: "Add as contact" })).toBeNull();
    fireEvent.click(ui.getByText("Lunch"));
    expect(opened).toEqual(["t1"]);
  });

  it("offers Add as contact when suggested, never adding by itself", () => {
    const added: string[] = [];
    const ui = render(
      <ContactMailPanel
        email="ann@x.test"
        name="Ann"
        rows={rows}
        messages={messages}
        nowMs={1}
        suggestAdd
        onOpenThread={() => {}}
        onPreview={() => {}}
        onAddContact={(e) => added.push(e)}
      />,
    );
    expect(added).toEqual([]);
    fireEvent.click(ui.getByRole("button", { name: "Add as contact" }));
    expect(added).toEqual(["ann@x.test"]);
  });
});
