import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { MailAttachment } from "@/lib/runtime.types.mail-engine";

import { attachmentDragPayload, AttachmentStrip } from "./attachments";

afterEach(cleanup);

const pdf: MailAttachment = {
  id: "m1:a0",
  filename: "Q3 plan.pdf",
  mime: "application/pdf",
  size: 2048,
  isInline: false,
  contentId: null,
};
const logo: MailAttachment = { ...pdf, id: "m1:a1", filename: "logo.png", isInline: true };

describe("reader attachments strip (AC17)", () => {
  it("lists only real attachments", () => {
    render(<AttachmentStrip attachments={[pdf, logo]} threadId="t1" messageId="m1" />);
    expect(screen.getByRole("button", { name: /Q3 plan\.pdf/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /logo\.png/ })).toBeNull();
  });

  it("space previews", () => {
    const onPreview = rs.fn();
    render(
      <AttachmentStrip attachments={[pdf]} threadId="t1" messageId="m1" onPreview={onPreview} />,
    );
    const chip = screen.getByRole("button", { name: /Q3 plan\.pdf/ });
    fireEvent.keyDown(chip, { key: " ", code: "Space" });
    expect(onPreview).toHaveBeenCalledWith(pdf);
    const dialog = screen.getByRole("dialog", { name: "Q3 plan.pdf" });
    expect(dialog.textContent).toContain("PDF");
  });

  it("drag payload gives Finder a file and a task a link", () => {
    const payload = attachmentDragPayload(pdf, {
      threadId: "t1",
      messageId: "m1",
      fileUrl: "file:///tmp/Q3%20plan.pdf",
    });
    expect(payload.DownloadURL).toBe("application/pdf:Q3 plan.pdf:file:///tmp/Q3%20plan.pdf");
    expect(JSON.parse(payload["application/x-moduo-entity"]!)).toEqual({
      type: "email_thread",
      id: "t1",
      label: "Q3 plan.pdf",
    });
    expect(payload["text/plain"]).toBe("Q3 plan.pdf");

    const noFile = attachmentDragPayload(pdf, { threadId: "t1", messageId: "m1" });
    expect(noFile.DownloadURL).toBeUndefined();

    const set = rs.fn();
    render(
      <AttachmentStrip
        attachments={[pdf]}
        threadId="t1"
        messageId="m1"
        fileUrl={() => "file:///tmp/Q3%20plan.pdf"}
      />,
    );
    const chip = screen.getByRole("button", { name: /Q3 plan\.pdf/ });
    expect(chip.getAttribute("draggable")).toBe("true");
    fireEvent.dragStart(chip, { dataTransfer: { setData: set, effectAllowed: "" } });
    expect(set).toHaveBeenCalledWith("DownloadURL", payload.DownloadURL);
    expect(set).toHaveBeenCalledWith("application/x-moduo-entity", expect.any(String));
  });
});
