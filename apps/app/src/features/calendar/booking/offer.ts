// Offer specific times (CALR-19, AC34): the host picks a few of a link's open
// times with the keyboard and sends them as one link (/book/r/<slug>). Pure.

import { openTimes, type OpenTimesInput } from "./availability";
import { dayShort, time24, zoneKey, zonePlace } from "./sentence";

/** Holds last this long (slot_offers.expires_at). */
export const OFFER_HOLD_HOURS = 48;
/** At most this many times in one offer (calendar_op_offer_create). */
export const OFFER_MAX_TIMES = 10;

export type OfferDraft = { picks: number[]; cursorMs: number | null };
export type OfferKey = "add" | "next" | "next-day" | "prev-day" | "remove-last";

/** A calendar item that holds an offered time. */
export function isHoldItem(item: { kind?: string | null }): boolean {
  return item.kind === "hold";
}

/** The link's open times (start instants) an offer picks from. */
export function offerSlots(input: OpenTimesInput): number[] {
  return openTimes(input).times.map((t) => t.startMs);
}

export function startOfferDraft(slots: readonly number[]): OfferDraft {
  return { picks: [], cursorMs: slots.length > 0 ? Math.min(...slots) : null };
}

/** One key while offering. Days are the host zone's. */
export function offerKey(
  draft: OfferDraft,
  key: OfferKey,
  slots: readonly number[],
  zone: string,
): OfferDraft {
  const { picks, cursorMs } = draft;
  if (key === "remove-last") {
    return picks.length === 0
      ? draft
      : { picks: picks.slice(0, -1), cursorMs: picks[picks.length - 1]! };
  }
  if (cursorMs == null) return draft;
  const day = (ms: number) => zoneKey(new Date(ms), zone);
  const free = [...slots].sort((a, b) => a - b).filter((ms) => !picks.includes(ms));
  const today = day(cursorMs);
  const firstOfNextDay = free.find((ms) => day(ms) > today);
  if (key === "add") {
    if (picks.includes(cursorMs) || picks.length >= OFFER_MAX_TIMES) return draft;
    const later = free.find((ms) => ms > cursorMs && day(ms) === today);
    return { picks: [...picks, cursorMs], cursorMs: firstOfNextDay ?? later ?? null };
  }
  if (key === "next") return { picks, cursorMs: free.find((ms) => ms > cursorMs) ?? cursorMs };
  if (key === "next-day") return { picks, cursorMs: firstOfNextDay ?? cursorMs };
  const prevDay = free
    .filter((ms) => day(ms) < today)
    .map(day)
    .pop();
  return { picks, cursorMs: prevDay ? free.find((ms) => day(ms) === prevDay)! : cursorMs };
}

export function offerUrl(origin: string, slug: string): string {
  return `${origin}/book/r/${slug}`;
}

/** "Tue 3 Nov, 09:00–09:30" in the host's zone. */
export function offerTimeLabel(startMs: number, durationMinutes: number, timeZone: string): string {
  const start = new Date(startMs);
  return `${dayShort(start, timeZone)}, ${time24(start, timeZone)}–${time24(new Date(startMs + durationMinutes * 60_000), timeZone)}`;
}

/** The times as text (⇧⌘C), in time order, ending with the link. */
export function offerText(input: {
  picks: number[];
  durationMinutes: number;
  timeZone: string;
  url: string;
}): string {
  if (input.picks.length === 0) return "";
  return [
    "Would one of these work?",
    ...[...input.picks]
      .sort((a, b) => a - b)
      .map((ms) => offerTimeLabel(ms, input.durationMinutes, input.timeZone)),
    `(${zonePlace(input.timeZone)} time)`,
    `Pick one: ${input.url.replace(/^https?:\/\//, "")}`,
  ].join("\n");
}

/** The guest page asks booking-public by the offer when it has one, else by the link. */
export function offerRequest(page: {
  slug?: string;
  offer?: string;
}): { slug: string } | { offer: string } {
  return page.offer ? { offer: page.offer } : { slug: page.slug ?? "" };
}

/** What the guest page says when the offer isn't open; null when it is. */
export function offerClosedNotice(status: string, hostName: string): string | null {
  if (status === "open") return null;
  if (status === "booked")
    return `A time from these has already been picked. ${hostName} has the details.`;
  return `These times aren't on offer any more. Ask ${hostName} for new ones.`;
}
