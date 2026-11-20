/** The web runtime's offer calls (CALR-19): make an offer, release its holds. One RPC each. */

import { runQuery, runRpc, untypedDb } from "./runtime.db";
import type { CalendarRuntime } from "./runtime.types";
import { supabaseClient } from "./runtime.web.client";

// The ops aren't in the generated Database types until the migration reaches prod.
const rpc = (fn: string, args: Record<string, unknown>) =>
  runRpc(untypedDb(supabaseClient).rpc(fn, args));

export const webCalendarOffers: Pick<
  CalendarRuntime,
  "createOffer" | "releaseOffer" | "firstOpenBookingLink"
> = {
  async createOffer({
    workspaceId,
    linkId,
    startsAt,
    hold,
    title,
    durationMinutes,
    videoProvider,
  }) {
    const args: Record<string, unknown> = {
      p_workspace_id: workspaceId,
      p_link_id: linkId,
      p_starts_at: startsAt,
      p_hold: hold,
    };
    if (title !== undefined) args.p_title = title;
    if (durationMinutes !== undefined) args.p_duration_minutes = durationMinutes;
    if (videoProvider !== undefined) args.p_video_provider = videoProvider;
    const o = (await rpc("calendar_op_offer_create", args)) as Record<string, unknown>;
    return {
      id: String(o.id),
      slug: String(o.slug),
      status: String(o.status),
      expiresAt: String(o.expires_at),
      holdEventIds: Array.isArray(o.hold_event_ids) ? o.hold_event_ids.map(String) : [],
    };
  },
  async firstOpenBookingLink({ workspaceId, userId }) {
    const rows = await runQuery(
      supabaseClient
        .from("exposed_slot_links")
        .select("id")
        .eq("owner_user_id", userId)
        .eq("workspace_id", workspaceId)
        .eq("paused", false)
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .limit(1),
    );
    return rows[0]?.id ?? null;
  },
  async releaseOffer({ workspaceId, offerId }) {
    return String(
      await rpc("calendar_op_offer_release", { p_workspace_id: workspaceId, p_offer_id: offerId }),
    );
  },
};
