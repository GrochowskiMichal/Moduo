// /chat URL search params. Shared between the route definition (validateSearch)
// and the page without a route-tree ↔ page import cycle. The open conversation,
// the open thread and a message to focus are URL-held so links, back/forward and
// notification deep-links all land in the same place.

export type ChatSearch = {
  /** Open conversation (chat_channels.id). */
  c?: string;
  /** Open thread (the parent message id). */
  t?: string;
  /** Message to scroll to + flash. */
  m?: string;
};

const ID = /^[0-9a-fA-F-]{36}$/;
const pick = (v: unknown): string | undefined =>
  typeof v === "string" && ID.test(v) ? v : undefined;

export function validateChatSearch(search: Record<string, unknown>): ChatSearch {
  const c = pick(search.c);
  const t = c ? pick(search.t) : undefined;
  const m = c ? pick(search.m) : undefined;
  return { ...(c ? { c } : {}), ...(t ? { t } : {}), ...(m ? { m } : {}) };
}
