// Telling "the server said no" from "the network is gone" for chat (CH64).
// The ops' codes `42501` (not allowed: a viewer, an announcement channel, a
// paused plan, removed), `P0002` (gone) and `22023` (bad input) are refusals:
// "Not sent · Retry". So is any other answer the server gave (a rate limit, a
// length). Only a request that never got an answer leaves a message "Waiting
// to send", sent by itself in order when the network is back.

import { isNetworkError } from "../../../lib/sync/network";
import type { ChatError } from "../model";

/** The codes the chat ops refuse with (round-3 §2.4). */
export const REFUSAL_CODES: ReadonlySet<string> = new Set(["42501", "P0002", "22023"]);

export type ChatFailure = "network" | "refused";

export function classifyChatError(error: ChatError): ChatFailure {
  if (error.code && REFUSAL_CODES.has(error.code)) return "refused";
  return isNetworkError(error) ? "network" : "refused";
}

/** A client-minted message id (the outbox resends under it: no duplicate on a retry). */
export function newMessageId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (Number(c) ^ ((Math.random() * 16) >> (Number(c) / 4))).toString(16),
  );
}
