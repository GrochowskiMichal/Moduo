// The app's one upload queue (AT-2), shared by every surface that attaches
// files (the task panel now; capture, rows and Notes later).

import { getRuntime } from "../runtime";
import { prepareUpload } from "./pipeline";
import { UploadQueue } from "./queue";
import { idbUploadStore } from "./store";

let queue: UploadQueue | null = null;

export function getUploadQueue(): UploadQueue {
  queue ??= new UploadQueue({
    store: idbUploadStore(),
    getApi: () => getRuntime()?.attachments ?? null,
    prepare: (file, perFileBytes) => prepareUpload(file, { perFileBytes }),
    requestPersist: () => {
      // Keep the waiting bytes through storage pressure (web; a no-op elsewhere).
      void navigator.storage?.persist?.().catch(() => {});
    },
  });
  return queue;
}

/**
 * This person's files still waiting to upload on this device (the "Reset local
 * cache" guard): what IndexedDB holds plus what's only in memory. Another
 * account's files don't block this person's reset: they can't see or clear them.
 */
export async function countPendingUploads(userId: string | null): Promise<number> {
  if (!userId) return 0;
  const ids = new Set<string>();
  for (const item of await idbUploadStore().all()) {
    if (item.userId === userId && item.state !== "rejected") ids.add(item.id);
  }
  for (const id of queue?.pendingIds(userId) ?? []) ids.add(id);
  return ids.size;
}

export { closeUploadsDb, UPLOADS_DB_NAME } from "./store";
