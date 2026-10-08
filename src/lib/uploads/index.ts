// The app's one upload queue (AT-2), shared by every surface that attaches
// files (the task panel now; capture, rows and Notes later).

import { getRuntime } from "../runtime";
import { prepareUpload } from "./pipeline";
import { UploadQueue } from "./queue";
import { countStoredUploads, idbUploadStore } from "./store";

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
 * Files still waiting to upload on this device (the "Reset local cache" guard):
 * the live queue when it's running, else what IndexedDB holds.
 */
export async function countPendingUploads(): Promise<number> {
  const stored = await countStoredUploads();
  return Math.max(stored, queue?.countPending() ?? 0);
}

export { closeUploadsDb, UPLOADS_DB_NAME } from "./store";
