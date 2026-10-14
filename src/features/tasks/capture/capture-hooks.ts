// Two seams the capture leaves for blocks that come after TV-U14:
// - templates (TV-D15): `/template` and More → "Template…" appear once a
//   provider is registered; picking one shows it in the capture, and Create
//   makes the task and its subtasks from it on the server (the title typed,
//   the destination, Due as the date its dates count from, Assign);
// - attachments (AT-2's upload pipeline, AT-3's capture paste chip): files
//   pasted or dropped on a capture go to the handler with the new task's id
//   once it exists (AT-3 registers `attachCaptureFiles`,
//   features/attachments/capture.ts). Until one is registered, the capture
//   says where files go.

import type { ModuoRuntime } from "../../../lib/runtime.types";
import type { WorkspaceStore } from "../../../lib/sync/store";

/** A task template as the capture offers it. */
export type CaptureTemplateChoice = {
  id: string;
  name: string;
  /** Its task's title (the capture's title when nothing is typed yet). */
  title: string | null;
  subtasks: number;
  /** It has dates. */
  dated: boolean;
  /** What they count from: its task's due date (Due sets it) or the day it's made. */
  anchor: "due" | "start" | null;
  /** Its own project (the destination it suggests). */
  project: string | null;
};

export type CaptureTemplateApply = {
  templateId: string;
  /** The new task's id. */
  id: string;
  title: string;
  /** Omitted: the template's own project. null: your Inbox. */
  projectId?: string | null;
  sectionId?: string | null;
  /** YYYY-MM-DD its dates count from; null = no dates. */
  date: string | null;
  /** Omitted: the template's own person. */
  assigneeId?: string | null;
};

export type CaptureTemplateProvider = {
  /** The task templates to offer (a hook: call it from a component that always renders it). */
  useChoices: (
    runtime: ModuoRuntime | null,
    workspaceId: string | null,
  ) => { loaded: boolean; choices: CaptureTemplateChoice[] };
  /** Make the task from a template; resolves its id, or null when it didn't (it says why). */
  apply: (
    deps: { runtime: ModuoRuntime; store: WorkspaceStore; workspaceId: string; userId: string },
    input: CaptureTemplateApply,
  ) => Promise<string | null>;
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
  /** Who captured it: the files are theirs to upload. */
  userId: string;
  /**
   * The task once it exists: made on the server, or waiting on this device to
   * sync (`queued`, an offline capture: its files wait with it). Null: it
   * wasn't made (the server refused), so there's nothing to attach to.
   */
  task: Promise<{ id: string; queued: boolean } | null>;
  files: File[];
}) => void;

let attachments: CaptureAttachmentHandler | null = null;

export function registerCaptureAttachments(handler: CaptureAttachmentHandler | null): void {
  attachments = handler;
}

export function captureAttachments(): CaptureAttachmentHandler | null {
  return attachments;
}
