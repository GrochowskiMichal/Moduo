// The Event view's pure pieces (CALR-10, AC25): which event the right panel
// follows, the place on two lines and its map, the link's provider, Google's
// reply words, whether "Add a Meet link" can work, and the who-sees-it line.
//
// The who-sees-it line says what the calendar's sharing gives each teammate
// (can_access('event') follows the calendar's grants), and for a private event
// that teammates see "Busy": CALR-15 enforces it (the masked read,
// calendar_events_visible, and can_access giving others only freebusy).

import { type ConferenceProvider, GRANT_LEVELS } from "@contracts/vocabularies";

import type { PanelVariantId } from "./prefs";
import type { EventWriter } from "./writable";

/** What the panel reads about an event beyond its row (`event-context.ts`). */
export type EventContext = {
  /** "Your calendar", "Work", "Kai's calendar", or null when unknown. */
  calendarName: string | null;
  /** Who owns the calendar the event is on (sharing opens only for them). */
  calendarOwnerId?: string | null;
  /** The calendar's sharing, or null when it can't be read. */
  share: ShareState | null;
  /** The booking link the event was booked through, if any. */
  bookedThrough: { name: string; bookedAt: string } | null;
};

/** `share_op_state` for a calendar: the workspace-wide level and personal grants. */
export type ShareState = {
  workspaceLevel: string | null;
  people: { userId: string; level: string }[];
};

/** The event the panel follows when the selection moves, or null to leave it. */
export function followedEventId(
  occurrenceKey: string | null,
  variant: PanelVariantId,
  rightOpen: boolean,
): string | null {
  if (!occurrenceKey || !rightOpen) return null;
  if (variant !== "detail" && variant !== "notes") return null;
  return occurrenceKey.split(":")[0] || null;
}

/** A place on two lines: its name, then the address after the first comma. */
export function placeLines(
  location: string | null | undefined,
): { name: string; address: string | null } | null {
  const text = location?.trim() ?? "";
  if (!text || /^https?:\/\/\S+$/i.test(text)) return null;
  const comma = text.indexOf(",");
  if (comma < 0) return { name: text, address: null };
  const name = text.slice(0, comma).trim();
  const address = text.slice(comma + 1).trim();
  return { name: name || text, address: address || null };
}

export function mapUrl(location: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location.trim())}`;
}

const PROVIDER_NAMES: Record<ConferenceProvider, string> = {
  google_meet: "Google Meet",
  zoom: "Zoom",
  teams: "Microsoft Teams",
  other: "Meeting link",
};

function providerFromUrl(url: string): string {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return PROVIDER_NAMES.other;
  }
  if (host === "meet.google.com") return PROVIDER_NAMES.google_meet;
  if (host === "zoom.us" || host.endsWith(".zoom.us")) return PROVIDER_NAMES.zoom;
  if (host.startsWith("teams.")) return PROVIDER_NAMES.teams;
  return PROVIDER_NAMES.other;
}

/** The meeting link on two lines: the provider, then the URL. */
export function linkLines(event: {
  conferenceUrl?: string | null;
  conferenceProvider?: ConferenceProvider | null;
  location?: string | null;
}): { provider: string; url: string } | null {
  const stored = event.conferenceUrl?.trim();
  const location = event.location?.trim() ?? "";
  const url = stored || (/^https?:\/\/\S+$/i.test(location) ? location : "");
  if (!url) return null;
  const named =
    stored && event.conferenceProvider ? PROVIDER_NAMES[event.conferenceProvider] : null;
  const provider = named && named !== PROVIDER_NAMES.other ? named : providerFromUrl(url);
  return { provider, url };
}

/** Google's response status, in the words the People rows use. */
export function replyLabel(status: string | null | undefined): string {
  switch (status) {
    case "accepted":
      return "Accepted";
    case "declined":
      return "Declined";
    case "tentative":
      return "Maybe";
    default:
      return "No reply yet";
  }
}

/**
 * "Add a Meet link" only where it can work: Google makes the link (CALR-8's
 * `meet: "add"`), so a Moduo event, with no Google event behind it, can't.
 */
export function canAddMeet(
  writer: EventWriter | null,
  event: { conferenceUrl?: string | null },
): boolean {
  return writer === "google" && !event.conferenceUrl?.trim();
}

/** freebusy 1, view 2, edit 3, full 4 (the contracts' order); anything else sees nothing. */
function rankOf(level: string | null | undefined): number {
  return level ? (GRANT_LEVELS as readonly string[]).indexOf(level) + 1 : 0;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length <= 3) return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const rest = names.length - 2;
  return `${names.slice(0, 2).join(", ")} and ${rest} others`;
}

/** "sees" for one person, "see" for several. */
function verb(count: number): string {
  return count === 1 ? "sees" : "see";
}

/**
 * The one line on who sees the event, from its calendar's sharing: who gets
 * all the details, who gets "Busy", and nothing about anyone who gets neither.
 * A private event is "Busy" to every teammate, whatever the sharing.
 */
export function whoSeesLine(
  share: ShareState,
  members: readonly { userId: string; name: string }[],
  selfUserId: string | null,
  opts?: { isPrivate?: boolean; isFocus?: boolean },
): string {
  if (opts?.isPrivate) return "Private · workspace members see “Busy”";
  const others = members.filter((m) => m.userId !== selfUserId);
  const workspace = rankOf(share.workspaceLevel);
  const levelOf = (userId: string) =>
    Math.max(workspace, rankOf(share.people.find((p) => p.userId === userId)?.level));
  const all = others.filter((m) => levelOf(m.userId) >= 2);
  const busy = others.filter((m) => levelOf(m.userId) === 1);
  if (all.length === 0 && busy.length === 0) return "Only you see it";
  // Focus time (CALR-14): the server masks it for every teammate.
  if (opts?.isFocus) return "Workspace members see “Focus time”, not the task";
  if (all.length === others.length) return "Everyone here sees it all";
  if (busy.length === others.length) return "Everyone here sees “Busy”";

  const parts: string[] = [];
  if (all.length > 0) parts.push(`${joinNames(all.map((m) => m.name))} ${verb(all.length)} it all`);
  if (busy.length > 0) {
    const rest = all.length > 0 && all.length + busy.length === others.length;
    parts.push(
      rest
        ? "others see “Busy”"
        : `${joinNames(busy.map((m) => m.name))} ${verb(busy.length)} “Busy”`,
    );
  }
  return parts.join(" · ");
}

/** Private is the owner's call, on an event that can change (Google's too). */
export function canMakePrivate(
  event: { ownerId: string | null },
  currentUserId: string | null,
  editable: boolean,
): boolean {
  return editable && currentUserId !== null && event.ownerId === currentUserId;
}

/** The lock shows on your own private events; a teammate's reaches you as "Busy". */
export function showsLock(
  event: { ownerId: string | null; isPrivate?: boolean },
  currentUserId: string | null,
): boolean {
  return !!event.isPrivate && currentUserId !== null && event.ownerId === currentUserId;
}
