// Positions in a conversation's stream (CV-3). Pages key on (created_at, id);
// stamps travel as the server's text and are compared to the microsecond
// (a JS `Date` drops them and a keyset page repeats or skips a row at the
// boundary: CV-0 spike 2's gotcha). Ids are uuids: Postgres orders them
// bytewise, which for lowercase text is the string order.

import { micros as stampMicros } from "../../../lib/sync/kernel/stamps";
import type { ChatKey, ChatMessage } from "../model";

const micros = (at: string) => stampMicros(at, 0);

export function keyOf(m: Pick<ChatMessage, "createdAt" | "id">): ChatKey {
  return { at: m.createdAt, id: m.id };
}

/** < 0 when `a` comes first in the stream. */
export function compareKeys(a: ChatKey, b: ChatKey): number {
  const d = micros(a.at) - micros(b.at);
  if (d !== 0) return d < 0 ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function compareRows(a: ChatMessage, b: ChatMessage): number {
  return compareKeys(keyOf(a), keyOf(b));
}

/** A stamp as a fixed-width string that sorts like the time (the device copy's key). */
export function sortableAt(at: string): string {
  return String(micros(at)).padStart(17, "0");
}

/** A server stamp moved back by `ms`, keeping its microseconds (the delta's lookback). The
 *  stamp rule (an unknown stamp is the epoch) lives in the kernel with every caller's pick. */
export { isNewerRow, laterStamp, stampMinus } from "../../../lib/sync/kernel/stamps";
