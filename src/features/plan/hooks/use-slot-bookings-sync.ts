/**
 * Polls Supabase for new (unsynced) slot bookings that belong to the currently
 * signed-in user and writes them as CalendarEvent entries into localStorage so
 * they show up in the desktop calendar view.
 *
 * Strategy:
 *  1. Fetch the host's slot IDs from `exposed_slot_links` (public, filtered by
 *     owner_user_id — no auth needed).
 *  2. Query `slot_bookings` for confirmed, future, calendar_synced=false rows
 *     using the host's Supabase JWT so RLS is satisfied.
 *  3. Write each booking as a CalendarEvent into localStorage.
 *  4. PATCH each processed row to set calendar_synced = true.
 *
 * The hook mounts once (inside AppGate/AppChrome) and runs on mount + every
 * SYNC_INTERVAL_MS milliseconds.
 */

import { useCallback, useEffect, useRef } from "react";
import { useAuth } from "../../../providers/auth-provider";
import type { CalendarEvent } from "../../calendar/types";

// ── Config ────────────────────────────────────────────────────────────────────

const SUPABASE_URL: string =
  (import.meta.env.PUBLIC_SUPABASE_URL as string | undefined) ||
  "https://wtoonrvuqumihpkbvwvs.supabase.co";
const SUPABASE_PUBLISHABLE_KEY: string =
  (import.meta.env.PUBLIC_SUPABASE_ANON_KEY as string | undefined) ||
  "sb_publishable_NAVl-rzFzPOi5ZU84aC3pA_SOIR00so";
const EVENTS_STORAGE_KEY = "moduo:calendar:events-v1";
const SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const BOOKING_CALENDAR_ID = "moduo-slot-bookings";

// ── REST helpers ──────────────────────────────────────────────────────────────

async function restGet(
  path: string,
  params: Record<string, string>,
  authToken?: string,
): Promise<unknown[] | null> {
  const urlParams = new URLSearchParams(params);
  const url = `${SUPABASE_URL}/rest/v1/${path}?${urlParams.toString()}`;
  const headers: Record<string, string> = {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${authToken ?? SUPABASE_PUBLISHABLE_KEY}`,
    "Content-Type": "application/json",
  };
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    return (await res.json()) as unknown[];
  } catch {
    return null;
  }
}

async function restPatch(
  path: string,
  filter: Record<string, string>,
  body: Record<string, unknown>,
  authToken?: string,
): Promise<void> {
  const urlParams = new URLSearchParams(filter);
  const url = `${SUPABASE_URL}/rest/v1/${path}?${urlParams.toString()}`;
  const headers: Record<string, string> = {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${authToken ?? SUPABASE_PUBLISHABLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };
  try {
    await fetch(url, { method: "PATCH", headers, body: JSON.stringify(body) });
  } catch {
    // best-effort
  }
}

// ── localStorage helpers ──────────────────────────────────────────────────────

function readLocalEvents(): CalendarEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(EVENTS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CalendarEvent[]) : [];
  } catch {
    return [];
  }
}

function writeLocalEvents(events: CalendarEvent[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(EVENTS_STORAGE_KEY, JSON.stringify(events));
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface SlotRow {
  slot_id: string;
  name: string;
}

interface BookingRow {
  id: string;
  slot_id: string;
  start_at: string;
  end_at: string;
  attendee_name: string;
  attendee_email: string;
  attendee_notes: string | null;
  meeting_link: string | null;
  timezone: string;
}

// ── Main hook ─────────────────────────────────────────────────────────────────

export function useSlotBookingsSync() {
  const { userId, runtime } = useAuth();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sync = useCallback(async () => {
    if (!userId) return;

    // 1. Get the user's Supabase JWT for authenticated queries
    let accessToken: string | undefined;
    if (runtime) {
      try {
        const { data } = await runtime.auth.getSession();
        accessToken = data.session?.access_token ?? undefined;
      } catch {
        // fall back to publishable key — RLS may block; tolerated
      }
    }

    // 2. Fetch the user's slot IDs (public table, no auth needed)
    const slotRows = await restGet(
      "exposed_slot_links",
      {
        owner_user_id: `eq.${userId}`,
        select: "slot_id,name",
      },
      accessToken,
    );

    if (!slotRows || slotRows.length === 0) return;

    const slots = slotRows as SlotRow[];
    const slotIds = slots.map((s) => s.slot_id);
    const slotNameById = Object.fromEntries(slots.map((s) => [s.slot_id, s.name]));

    // 3. Fetch unsynced, confirmed, future bookings for those slots
    const now = new Date().toISOString();
    const bookingRows = await restGet(
      "slot_bookings",
      {
        slot_id: `in.(${slotIds.join(",")})`,
        status: "eq.confirmed",
        calendar_synced: "eq.false",
        start_at: `gt.${now}`,
        select: "id,slot_id,start_at,end_at,attendee_name,attendee_email,attendee_notes,meeting_link,timezone",
      },
      accessToken,
    );

    if (!bookingRows || bookingRows.length === 0) return;

    const bookings = bookingRows as BookingRow[];

    // 4. Write new CalendarEvent entries into localStorage
    const existing = readLocalEvents();
    const existingIds = new Set(existing.map((e) => e.id));
    const toAdd: CalendarEvent[] = [];

    for (const booking of bookings) {
      const eventId = `booking-${booking.id}`;
      if (existingIds.has(eventId)) continue;

      const slotTitle = slotNameById[booking.slot_id] ?? "Booking";
      const location = booking.meeting_link ?? "";
      const description = [
        `Attendee: ${booking.attendee_name} <${booking.attendee_email}>`,
        booking.attendee_notes ? `Notes: ${booking.attendee_notes}` : "",
        booking.meeting_link ? `Meeting: ${booking.meeting_link}` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const event: CalendarEvent = {
        id: eventId,
        calendarId: BOOKING_CALENDAR_ID,
        title: `${slotTitle} — ${booking.attendee_name}`,
        description,
        location,
        startTime: booking.start_at,
        endTime: booking.end_at,
        allDay: false,
        color: "#4a90e2",
        recurring: false,
        recurrenceRule: null,
        attendees: [
          {
            email: booking.attendee_email,
            name: booking.attendee_name,
            status: "accepted",
          },
        ],
        reminders: [15], // 15 minutes before
        tags: ["booking"],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        deletedAt: null,
      };

      toAdd.push(event);
    }

    if (toAdd.length > 0) {
      writeLocalEvents([...existing, ...toAdd]);
    }

    // 5. Mark bookings as synced (best-effort, in parallel)
    await Promise.allSettled(
      bookings.map((b) =>
        restPatch(
          "slot_bookings",
          { id: `eq.${b.id}` },
          { calendar_synced: true, updated_at: new Date().toISOString() },
          accessToken,
        ),
      ),
    );
  }, [userId, runtime]);

  useEffect(() => {
    // Don't run if no user is logged in
    if (!userId) return;

    void sync();

    const schedule = () => {
      timerRef.current = setTimeout(() => {
        void sync().finally(() => {
          schedule();
        });
      }, SYNC_INTERVAL_MS);
    };

    schedule();

    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [userId, sync]);
}
