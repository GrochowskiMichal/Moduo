// Bar 2's alternative: the device copy written from a worker. The main
// thread's cost becomes the postMessage (one structured clone of the batch).

import { DeviceCopy, type Layout } from "./device-copy";
import type { ChatRow } from "./fixture";

let copy: DeviceCopy | null = null;

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data as { id: number; op: string; db?: string; layout?: Layout; rows?: ChatRow[] };
  if (msg.op === "open") {
    copy = await DeviceCopy.open(msg.db as string, msg.layout as Layout);
    self.postMessage({ id: msg.id });
    return;
  }
  if (msg.op === "put" && copy) {
    const t = performance.now();
    await copy.put(msg.rows ?? []).done;
    self.postMessage({ id: msg.id, ms: performance.now() - t });
  }
};
