// Two seams the capture leaves for blocks that come after TV-U14:
// - templates (TV-D15): `/template` and More → "Template…" appear once a
//   provider is registered; picking one fills the capture;
// - attachments (AT-2's upload pipeline, AT-3's capture paste chip): files
//   pasted or dropped on a capture go to the handler with the new task's id
//   once it exists. Until one is registered, the capture says where files go.

/** What a template puts into the capture. */
export type CaptureTemplateFill = {
  title?: string;
  description?: string;
  subtasks?: string[];
};

export type CaptureTemplateProvider = {
  /** Open the template picker; call `fill` with the one picked. */
  open: (fill: (template: CaptureTemplateFill) => void) => void;
};

let templates: CaptureTemplateProvider | null = null;

export function registerCaptureTemplates(provider: CaptureTemplateProvider | null): void {
  templates = provider;
}

export function captureTemplates(): CaptureTemplateProvider | null {
  return templates;
}

export type CaptureAttachmentHandler = (input: {
  workspaceId: string;
  /** The task's id once it's created (null: it wasn't). */
  taskId: Promise<string | null>;
  files: File[];
}) => void;

let attachments: CaptureAttachmentHandler | null = null;

export function registerCaptureAttachments(handler: CaptureAttachmentHandler | null): void {
  attachments = handler;
}

export function captureAttachments(): CaptureAttachmentHandler | null {
  return attachments;
}
