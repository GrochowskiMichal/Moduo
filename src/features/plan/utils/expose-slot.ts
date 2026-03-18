type SupabaseResponse = { data?: unknown; error?: { message: string; code?: string } | null };

const SUPABASE_URL = "https://ahhqsxjkwsqyszhxzjbc.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_RfaTM1fcomIzU191dDS5kw_7TDtK_Kd";
const SLOT_LINKS_TABLE = "exposed_slot_links";

function sanitizeSegment(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "event"
  );
}

async function supabaseFetch(path: string, options: RequestInit = {}): Promise<SupabaseResponse> {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const headers: Record<string, string> = {
    apikey: SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...(options.headers as Record<string, string>),
  };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { message?: string };
      msg = body.message ?? msg;
    } catch {
      // ignore
    }
    return { error: { message: msg } };
  }
  let data: unknown = null;
  try {
    data = res.status === 204 ? null : await res.json();
  } catch {
    // ignore
  }
  return { data };
}

export function buildOwnerHandle(userEmail: string | null, userId: string | null): string {
  if (userEmail) {
    const [localPart] = userEmail.split("@");
    if (localPart?.trim()) return sanitizeSegment(localPart);
  }
  if (userId) return sanitizeSegment(userId.slice(0, 12));
  return "guest";
}

export function normalizeLinkName(value: string): string {
  return sanitizeSegment(value);
}

export function buildSlotSlug(input: {
  ownerHandle: string;
  linkName?: string;
  name?: string;
}): string {
  const owner = sanitizeSegment(input.ownerHandle);
  const eventPart = sanitizeSegment(input.linkName || input.name || "event");
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${owner}-${eventPart}-${suffix}`;
}

export type ExposeSlotPayload = {
  slotId: string;
  workspaceId: string | null;
  ownerUserId: string;
  ownerEmail: string | null;
  ownerHandle: string;
  ownerDisplayName: string | null;
  ownerAvatarUrl: string | null;
  name: string;
  linkName: string;
  duration: number;
  location: "video" | "phone" | "in_person" | "choose";
  videoProvider?: "zoom" | "google_meet";
  description: string;
  conflictCalendars: string;
  scheduleType: "working_hours" | "custom";
  dateRange: number;
  bufferBefore: number;
  bufferAfter: number;
  questions: Array<{ id: string; label: string; type: "short" | "email" | "long"; required: boolean }>;
  assignedSlug?: string;
};

export type ExposeSlotResult =
  | { success: true; slug: string; url: string }
  | { success: false; error: string };

export type SlotConflictWindow = {
  sourceCalendarId: string;
  sourceEventId: string;
  startAt: string;
  endAt: string;
};

export async function exposeSlotLink(payload: ExposeSlotPayload): Promise<ExposeSlotResult> {
  try {
    const existingRes = await supabaseFetch(
      `${SLOT_LINKS_TABLE}?slot_id=eq.${encodeURIComponent(payload.slotId)}&select=slug`,
      { method: "GET" }
    );

    let slug = payload.assignedSlug || buildSlotSlug(payload);
    const body = {
      workspace_id: payload.workspaceId,
      owner_user_id: payload.ownerUserId,
      owner_email: payload.ownerEmail,
      owner_handle: payload.ownerHandle,
      owner_display_name: payload.ownerDisplayName,
      owner_avatar_url: payload.ownerAvatarUrl,
      name: payload.name,
      link_name: payload.linkName,
      duration_minutes: payload.duration,
      location_type: payload.location,
      video_provider: payload.videoProvider ?? null,
      description: payload.description,
      conflict_calendars: payload.conflictCalendars,
      schedule_type: payload.scheduleType,
      date_range_days: payload.dateRange,
      buffer_before_minutes: payload.bufferBefore,
      buffer_after_minutes: payload.bufferAfter,
      questions_json: payload.questions,
      updated_at: new Date().toISOString(),
    };

    if (
      !existingRes.error &&
      Array.isArray(existingRes.data) &&
      (existingRes.data as { slug: string }[])[0]?.slug
    ) {
      slug = (existingRes.data as { slug: string }[])[0]!.slug;
      const updateRes = await supabaseFetch(
        `${SLOT_LINKS_TABLE}?slot_id=eq.${encodeURIComponent(payload.slotId)}`,
        { method: "PATCH", body: JSON.stringify(body) }
      );
      if (updateRes.error) throw new Error(updateRes.error.message);
    } else {
      const insertRes = await supabaseFetch(SLOT_LINKS_TABLE, {
        method: "POST",
        body: JSON.stringify({
          slot_id: payload.slotId,
          slug,
          created_at: new Date().toISOString(),
          ...body,
        }),
      });
      if (insertRes.error) throw new Error(insertRes.error.message);
    }

    return { success: true, slug, url: `https://moduo.app/slot/${slug}` };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to expose slot link",
    };
  }
}

export async function unexposeSlotLink(slotId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const conflictsRes = await supabaseFetch(
      `slot_conflict_windows?slot_id=eq.${encodeURIComponent(slotId)}`,
      { method: "DELETE" }
    );
    if (conflictsRes.error) throw new Error(conflictsRes.error.message);

    const res = await supabaseFetch(
      `${SLOT_LINKS_TABLE}?slot_id=eq.${encodeURIComponent(slotId)}`,
      { method: "DELETE" }
    );
    if (res.error) throw new Error(res.error.message);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to remove slot link",
    };
  }
}

export async function syncSlotConflictWindows(payload: {
  slotId: string;
  slotSlug: string;
  windows: SlotConflictWindow[];
}): Promise<{ success: boolean; error?: string }> {
  try {
    const clearRes = await supabaseFetch(
      `slot_conflict_windows?slot_id=eq.${encodeURIComponent(payload.slotId)}`,
      { method: "DELETE" }
    );
    if (clearRes.error) throw new Error(clearRes.error.message);

    if (payload.windows.length === 0) {
      return { success: true };
    }

    const insertRows = payload.windows.map((window) => ({
      slot_id: payload.slotId,
      slot_slug: payload.slotSlug,
      source_calendar_id: window.sourceCalendarId,
      source_event_id: window.sourceEventId,
      start_at: window.startAt,
      end_at: window.endAt,
      updated_at: new Date().toISOString(),
    }));

    const insertRes = await supabaseFetch("slot_conflict_windows", {
      method: "POST",
      body: JSON.stringify(insertRows),
    });
    if (insertRes.error) throw new Error(insertRes.error.message);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to sync slot conflict windows",
    };
  }
}
