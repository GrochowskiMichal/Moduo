// Guest-side calls to the public booking function. No session.

import type { VideoProvider } from "./video";

const SUPABASE_URL: string =
  (import.meta.env.PUBLIC_SUPABASE_URL as string | undefined) || "http://127.0.0.1:54321";
const SUPABASE_KEY: string =
  (import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY as string | undefined) || "";

export type BookingPreview = {
  slug: string;
  name: string;
  description: string;
  durationMinutes: number;
  hostName: string;
  hostAvatarUrl: string | null;
  hostTimeZone: string;
  noteEnabled: boolean;
  guestsEnabled: boolean;
  questions: { id?: string; label?: string; required?: boolean }[];
  paused: boolean;
  slots: string[];
  /** The default platform, and every platform the guest may pick from. */
  video?: VideoProvider | null;
  videoOptions?: VideoProvider[];
};

export async function bookingRequest(body: Record<string, unknown>): Promise<{
  ok: boolean;
  status: number;
  json: Record<string, unknown>;
}> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/booking-public`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: SUPABASE_KEY,
      authorization: `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, json };
}

export const GUEST_ZONES = [
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Warsaw",
  "Europe/Paris",
  "Europe/Berlin",
  "Africa/Johannesburg",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
  "UTC",
];
