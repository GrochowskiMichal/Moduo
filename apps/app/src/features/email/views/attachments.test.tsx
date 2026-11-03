import { describe, expect, it } from "@rstest/core";
import { fireEvent, render } from "@testing-library/react";

import type { MailAttachment } from "@/lib/runtime.types.mail-engine";

import { msg } from "../testing/intel-fixtures";
import { AttachmentsView } from "./attachments";
import { attachmentType, collectAttachments } from "./attachments-model";

const att = (id: string, filename: string, mime: string, isInline = false): MailAttachment => ({
  id,
  filename,
  mime,
  size: 2048,
  isInline,
  contentId: null,
});
const messages = [
  msg({
    id: "m1",
    threadId: "t1",
    from: "a@x.test",
    dateMs: 1,
    attachments: [att("1", "photo.jpg", "image/jpeg"), att("2", "logo.png", "image/png", true)],
  }),
  msg({
    id: "m2",
    threadId: "t2",
    from: "b@x.test",
    dateMs: 2,
    attachments: [
      att("3", "Q3.pdf", "application/pdf"),
      att("4", "plan.xlsx", "application/octet-stream"),
    ],
  }),
];

describe("Attachments view (AC30)", () => {
  it("types attachments by mime and extension", () => {
    expect(attachmentType({ mime: "application/octet-stream", filename: "a.DOCX" })).toBe(
      "documents",
    );
    expect(attachmentType({ mime: "text/csv", filename: "x" })).toBe("spreadsheets");
    expect(attachmentType({ mime: "application/zip", filename: "x.zip" })).toBe("other");
  });

  it("lists every non-inline attachment newest first, and filters by type", () => {
    expect(collectAttachments(messages).map((e) => e.attachment.filename)).toEqual([
      "Q3.pdf",
      "plan.xlsx",
      "photo.jpg",
    ]);
    const ui = render(<AttachmentsView messages={messages} onPreview={() => {}} />);
    expect(ui.getAllByRole("listitem")).toHaveLength(3);
    fireEvent.click(ui.getByRole("button", { name: "PDFs" }));
    expect(ui.getAllByRole("listitem")).toHaveLength(1);
    expect(ui.getByText("Q3.pdf")).toBeTruthy();
    fireEvent.click(ui.getByRole("button", { name: "Images" }));
    expect(ui.queryByText("logo.png")).toBeNull();
  });

  it("previews on click and on Space", () => {
    const seen: string[] = [];
    const ui = render(
      <AttachmentsView messages={messages} onPreview={(e) => seen.push(e.attachment.id)} />,
    );
    fireEvent.click(ui.getByText("photo.jpg"));
    fireEvent.keyDown(ui.getByText("Q3.pdf").closest("button")!, { key: " " });
    expect(seen).toEqual(["1", "3"]);
  });
});
