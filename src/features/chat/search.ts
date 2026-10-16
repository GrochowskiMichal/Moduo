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
  /** A centre surface other than the conversation: Browse channels (CV-8b),
   *  Catch up (CV-11), Chat's Search (CV-19). */
  view?: "browse" | "catchup" | "search";
  /** Chat's Search: the words (at most 256 characters, as the server reads). */
  q?: string;
  /** Chat's Search filters: from a person, in a conversation, has a file, a date range. */
  from?: string;
  in?: string;
  file?: "1";
  date?: DateRange;
};

import { type DateRange, isDateRange } from "./find/model";

const ID = /^[0-9a-fA-F-]{36}$/;
const pick = (v: unknown): string | undefined =>
  typeof v === "string" && ID.test(v) ? v : undefined;

export function validateChatSearch(search: Record<string, unknown>): ChatSearch {
  const c = pick(search.c);
  const t = c ? pick(search.t) : undefined;
  const m = c ? pick(search.m) : undefined;
  const view =
    search.view === "browse" || search.view === "catchup" || search.view === "search"
      ? (search.view as "browse" | "catchup" | "search")
      : undefined;
  // Chat's Search keeps its words and filters only while it is the view.
  const searching = view === "search";
  const q = searching && typeof search.q === "string" ? search.q.slice(0, 256) : "";
  const from = searching ? pick(search.from) : undefined;
  const inId = searching ? pick(search.in) : undefined;
  const file = searching && (search.file === "1" || search.file === 1) ? ("1" as const) : undefined;
  const date = searching && isDateRange(search.date) ? search.date : undefined;
  return {
    ...(c ? { c } : {}),
    ...(t ? { t } : {}),
    ...(m ? { m } : {}),
    ...(view ? { view } : {}),
    ...(q ? { q } : {}),
    ...(from ? { from } : {}),
    ...(inId ? { in: inId } : {}),
    ...(file ? { file } : {}),
    ...(date ? { date } : {}),
  };
}
