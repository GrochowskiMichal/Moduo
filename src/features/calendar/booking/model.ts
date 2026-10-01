// Host-side booking link. Guest name and email are always collected; everything
// else is chosen while setting the link up.

export type GuestQuestion = {
  id: string;
  label: string;
  required: boolean;
};

export type VideoChoice = "google_meet" | "zoom" | "moduo_video";

export const VIDEO_CHOICES: { id: VideoChoice; label: string; enabled: boolean }[] = [
  { id: "google_meet", label: "Google Meet", enabled: true },
  { id: "zoom", label: "Zoom", enabled: false },
  { id: "moduo_video", label: "Moduo video", enabled: false },
];

export type BookingLink = {
  id: string;
  slotId: string;
  slug: string;
  name: string;
  description: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  horizonDays: number;
  minNoticeMinutes: number;
  hostTimeZone: string;
  weeklyHours: unknown;
  busyCalendarIds: string[];
  noteEnabled: boolean;
  questions: GuestQuestion[];
  paused: boolean;
  videoProvider: VideoChoice;
};

export function newQuestionId(): string {
  return crypto.randomUUID();
}

export function slugFor(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base || "meet"}-${suffix}`;
}

export function questionsFromJson(raw: unknown): GuestQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: GuestQuestion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as { id?: unknown; label?: unknown; required?: unknown };
    const label = typeof row.label === "string" ? row.label.trim() : "";
    if (!label) continue;
    out.push({
      id: typeof row.id === "string" && row.id ? row.id : newQuestionId(),
      label,
      required: row.required === true,
    });
  }
  return out;
}

export function busyIdsFromJson(raw: unknown): string[] {
  if (!Array.isArray(raw)) return ["moduo"];
  return raw.filter((id): id is string => typeof id === "string" && id.length > 0);
}
