// The Attachments view's data (AC30): every non-inline attachment across synced
// mail, newest first, filterable by type.

import type { MailAttachment, MailMessage } from "@/lib/runtime.types.mail-engine";

export const ATTACHMENT_TYPES = [
  "all",
  "images",
  "pdfs",
  "documents",
  "spreadsheets",
  "other",
] as const;
export type AttachmentType = (typeof ATTACHMENT_TYPES)[number];

export const ATTACHMENT_TYPE_LABEL: Record<AttachmentType, string> = {
  all: "All",
  images: "Images",
  pdfs: "PDFs",
  documents: "Documents",
  spreadsheets: "Spreadsheets",
  other: "Other",
};

export type AttachmentEntry = {
  attachment: MailAttachment;
  messageId: string;
  threadId: string;
  from: { name: string; email: string };
  dateMs: number;
  type: Exclude<AttachmentType, "all">;
};

const EXT = (name: string) => name.toLowerCase().split(".").pop() ?? "";

export function attachmentType(
  a: Pick<MailAttachment, "mime" | "filename">,
): AttachmentEntry["type"] {
  const mime = a.mime.toLowerCase();
  const ext = EXT(a.filename);
  if (mime.startsWith("image/")) return "images";
  if (mime === "application/pdf" || ext === "pdf") return "pdfs";
  if (/spreadsheet|excel|csv/.test(mime) || ["xls", "xlsx", "csv", "numbers", "ods"].includes(ext))
    return "spreadsheets";
  if (
    /word|document|presentation|powerpoint|rtf|text\/plain/.test(mime) ||
    ["doc", "docx", "pages", "txt", "rtf", "odt", "ppt", "pptx", "key", "md"].includes(ext)
  )
    return "documents";
  return "other";
}

export function collectAttachments(
  messages: readonly (MailMessage & { threadId: string })[],
  filter: AttachmentType = "all",
): AttachmentEntry[] {
  const out: AttachmentEntry[] = [];
  for (const m of messages) {
    for (const a of m.attachments) {
      if (a.isInline) continue;
      const type = attachmentType(a);
      if (filter !== "all" && filter !== type) continue;
      out.push({
        attachment: a,
        messageId: m.id,
        threadId: m.threadId,
        from: m.from,
        dateMs: m.dateMs,
        type,
      });
    }
  }
  return out.sort((a, b) => b.dateMs - a.dateMs || a.attachment.id.localeCompare(b.attachment.id));
}
