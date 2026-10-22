// Files pasted or dropped on a capture (AT-3, AT3-2): the task is always
// created first; then each file joins the device's upload queue for it, so it
// retries until attached, survives a restart, and shows on the task's strip
// ("Not attached yet…", Retry) meanwhile. A task captured offline waits in the
// store's outbox; its files wait with it (`awaitTask`) and go once it's sent.

import { getUploadQueue } from "@/lib/uploads";

import type { CaptureAttachmentHandler } from "../tasks/capture/capture-hooks";

export const attachCaptureFiles: CaptureAttachmentHandler = ({
  workspaceId,
  userId,
  task,
  files,
}) => {
  if (files.length === 0) return;
  void task
    .then((made) => {
      // Not made (refused): the capture came back with its words; nothing to attach to.
      if (!made) return;
      return getUploadQueue().add(
        files,
        { workspaceId, entityType: "task", entityId: made.id },
        userId,
        undefined,
        { awaitTask: made.queued },
      );
    })
    .catch(() => {});
};
