// The video link of an event, from its location or, failing that, the first
// known meeting URL in its description. Booked meetings and mirrored Google /
// Outlook events both carry it in one of those two places.

export type MeetingLink = { url: string; label: string };

const KNOWN =
  /https:\/\/(?:meet\.google\.com|[\w-]+\.zoom\.us|zoom\.us|teams\.microsoft\.com|teams\.live\.com)\/[^\s<>"')]+/i;

function labelFor(url: string): string {
  const host = (() => {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch {
      return "";
    }
  })();
  if (host === "meet.google.com") return "Join Google Meet";
  if (host === "zoom.us" || host.endsWith(".zoom.us")) return "Join Zoom";
  if (host.startsWith("teams.")) return "Join Teams";
  return "Join meeting";
}

export function meetingLinkOf(event: {
  location?: string | null;
  description?: string | null;
}): MeetingLink | null {
  const location = event.location?.trim() ?? "";
  if (/^https?:\/\/\S+$/i.test(location)) return { url: location, label: labelFor(location) };
  const found = `${location} ${event.description ?? ""}`
    .match(KNOWN)?.[0]
    ?.replace(/[.,;:!?]+$/, "");
  return found ? { url: found, label: labelFor(found) } : null;
}

/** The provider's join link for a raw Google Calendar event. */
export function googleMeetingLink(raw: Record<string, unknown>): string | null {
  if (typeof raw.hangoutLink === "string" && raw.hangoutLink) return raw.hangoutLink;
  const conference = raw.conferenceData as
    | { entryPoints?: { entryPointType?: string; uri?: string }[] }
    | undefined;
  const video = conference?.entryPoints?.find((point) => point.entryPointType === "video")?.uri;
  if (video) return video;
  return typeof raw.location === "string" && raw.location.trim() ? raw.location.trim() : null;
}

/** The join link (or place) for a raw Microsoft Graph event. */
export function graphMeetingLink(raw: Record<string, unknown>): string | null {
  const online = raw.onlineMeeting as { joinUrl?: string } | null | undefined;
  if (online?.joinUrl) return online.joinUrl;
  const location = raw.location as { displayName?: string } | undefined;
  return location?.displayName?.trim() || null;
}
