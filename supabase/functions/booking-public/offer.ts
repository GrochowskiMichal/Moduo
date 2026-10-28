/**
 * booking-public's offer mode (CALR-19, AC34): a guest opens /book/r/<slug>
 * and picks one of the times the host offered. Its rules and two reads; the pick itself
 * (book one, release the rest, in one transaction) is booking_op_offer_book.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";

import { normalizeSlotOfferStatus, type SlotOfferStatus } from "../_shared/contracts/vocabularies.ts";

export type OfferRow = {
  id: string;
  slug: string;
  link_id: string;
  owner_id: string;
  workspace_id: string;
  title: string;
  duration_minutes: number;
  video_provider: string | null;
  hold: boolean;
  expires_at: string;
  status: string;
};

export type OfferTimeRow = { id: string; offer_id: string; start_at: string; end_at: string };

/** The status a guest sees: an open offer past its 48 hours is expired; an unknown one is never open. */
export function offerState(offer: OfferRow, now: Date): SlotOfferStatus {
  const status = normalizeSlotOfferStatus(offer.status);
  return status === "open" && Date.parse(offer.expires_at) <= now.getTime() ? "expired" : status;
}

/** The offered times still ahead, in time order; none once the offer is closed. */
export function offerSlots(offer: OfferRow, times: readonly OfferTimeRow[], now: Date): Date[] {
  if (offerState(offer, now) !== "open") return [];
  return times
    .map((t) => new Date(t.start_at))
    .filter((d) => d.getTime() > now.getTime())
    .sort((a, b) => a.getTime() - b.getTime());
}

/** The offered time a guest picked, to the second. */
export function offerTimeAt(times: readonly OfferTimeRow[], at: Date): OfferTimeRow | null {
  return times.find((t) => Math.abs(Date.parse(t.start_at) - at.getTime()) < 1000) ?? null;
}

/** The offer's title, length and video stand in for the link's. */
export function offerAsLink<L extends { name: string; duration_minutes: number; video_provider: string | null }>(
  link: L,
  offer: OfferRow,
): L {
  return {
    ...link,
    name: offer.title,
    duration_minutes: offer.duration_minutes,
    video_provider: offer.video_provider ?? link.video_provider,
  };
}

/** booking_op_offer_book's refusal as the page's error. */
export function offerBookFailure(message: string): { error: string; status: number } {
  if (message.includes("offer_closed") || message.includes("offer_expired")) return { error: "offer_closed", status: 409 };
  if (message.includes("offer_time_unknown")) return { error: "slot_taken", status: 409 };
  return { error: "book_failed", status: 500 };
}

type LinkLike = { name: string; duration_minutes: number; video_provider: string | null; slug: string };

/**
 * An offer's guest page lives at /book/r/<token>. The overlaid link carries
 * that path as its slug, so nothing a guest of an offer sees (the preview, the
 * emails' rebook links) names the host's booking link: the token is the whole
 * capability, and it never reaches the link's open booking page.
 */
export const OFFER_SLUG_PREFIX = "r/";

/** The guest page for a link slug, or for an offer's `r/<token>`. */
export function guestPageUrl(origin: string, slug: string): string {
  return slug.startsWith(OFFER_SLUG_PREFIX)
    ? `${origin}/book/r/${encodeURIComponent(slug.slice(OFFER_SLUG_PREFIX.length))}`
    : `${origin}/book/${encodeURIComponent(slug)}`;
}
export type LoadedOffer<L> = { offer: OfferRow; times: OfferTimeRow[]; link: L };

/** An offer by its slug (service role), with its times and its live link overlaid. */
export async function loadOffer<L extends LinkLike>(db: SupabaseClient, slug: string): Promise<LoadedOffer<L> | null> {
  const offer = (await db.from("slot_offers").select("*").eq("slug", slug).maybeSingle()).data as OfferRow | null;
  if (!offer) return null;
  const link = (
    await db.from("exposed_slot_links").select("*").eq("id", offer.link_id).is("deleted_at", null).maybeSingle()
  ).data as L | null;
  if (!link) return null;
  const times = ((await db.from("slot_offer_times").select("*").eq("offer_id", offer.id)).data ?? []) as OfferTimeRow[];
  return { offer, times, link: { ...offerAsLink(link, offer), slug: OFFER_SLUG_PREFIX + offer.slug } };
}

/** The guest's pick: booked, and every hold released, in one transaction (booking_op_offer_book). */
export function bookOffer(
  db: SupabaseClient,
  found: LoadedOffer<unknown>,
  start: Date,
  a: {
    description: string;
    location: string;
    name: string;
    email: string;
    hostEmail: string;
    mirror: { id: string; calendarId: string; eventId: string | null } | null;
  },
) {
  return db.rpc("booking_op_offer_book", {
    p_offer_id: found.offer.id,
    p_start_at: offerTimeAt(found.times, start)?.start_at ?? start.toISOString(),
    p_description: a.description,
    p_location: a.location,
    p_attendee_name: a.name,
    p_attendee_email: a.email,
    p_host_email: a.hostEmail,
    p_source_account_id: a.mirror?.id ?? null,
    p_external_event_id: a.mirror?.eventId ?? null,
    p_calendar_id: a.mirror?.calendarId ?? null,
  });
}

/** A failed commit as the page's error: an offer's refusal is explained, anything else failed. */
export function commitFailure(found: unknown, error: { message: string } | null) {
  return found ? offerBookFailure(error?.message ?? "") : { error: "book_failed", status: 500 };
}
