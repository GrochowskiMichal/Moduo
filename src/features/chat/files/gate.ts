// Upload first, send after (CV-9; round-3 §2.25 g): a message with files
// waits in the outbox until the files uploaded under its id are up, then goes,
// and the server takes the finished ones. The store asks this gate; the app's
// upload queue (AT-2) answers.

import type { UploadQueue, UploadView } from "@/lib/uploads/queue";

export type ChatFilesState =
  /** Nothing of this message is still uploading: send it. */
  | "ready"
  /** Still uploading, or waiting to (offline, a full pool, another window). */
  | "waiting"
  /** A file stopped (refused, or failed until Retry): the message waits for you. */
  | "failed";

export type ChatFileGate = {
  state(messageId: string): ChatFilesState;
  /** Something about the uploads changed: ask again. */
  subscribe(fn: () => void): () => void;
  /**
   * Let go of a message's uploads: the stopped ones only (Retry after a failed
   * file: the rest keep going and the message waits for them), or all (Discard).
   */
  release(messageId: string, only?: "stopped"): void;
};

/** The state of one message's uploads, from the queue's items. */
export function filesState(
  items: readonly Pick<UploadView, "target" | "state">[],
  messageId: string,
  restored: boolean,
): ChatFilesState {
  // Before the device's stored uploads are back, an empty queue proves nothing.
  if (!restored) return "waiting";
  let waiting = false;
  for (const item of items) {
    if (item.target.entityType !== "chat_message" || item.target.entityId !== messageId) continue;
    if (item.state === "failed" || item.state === "rejected") return "failed";
    waiting = true;
  }
  return waiting ? "waiting" : "ready";
}

type QueueLike = Pick<UploadQueue, "getSnapshot" | "subscribe" | "onUploaded" | "dismiss"> & {
  hasRestored(): boolean;
};

export function uploadQueueGate(queue: QueueLike): ChatFileGate {
  return {
    state: (messageId) => filesState(queue.getSnapshot().items, messageId, queue.hasRestored()),
    subscribe(fn) {
      const a = queue.subscribe(fn);
      const b = queue.onUploaded(() => fn());
      return () => {
        a();
        b();
      };
    },
    release(messageId, only) {
      for (const item of queue.getSnapshot().items) {
        if (item.target.entityType !== "chat_message" || item.target.entityId !== messageId) {
          continue;
        }
        if (only === "stopped" && item.state !== "failed" && item.state !== "rejected") continue;
        queue.dismiss(item.id);
      }
    },
  };
}
