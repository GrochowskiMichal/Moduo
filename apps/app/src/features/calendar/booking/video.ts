// Which video platform a booking link uses. Shared by the host UI, the public
// page and the booking-public edge function (imported there by path).

export type VideoProvider = "google_meet" | "zoom";

/** What the host picks on the link: one platform, or let the guest choose. */
export type VideoSetting = VideoProvider | "guest_choice";

export const VIDEO_PROVIDERS: VideoProvider[] = ["google_meet", "zoom"];

export const VIDEO_LABEL: Record<VideoProvider, string> = {
  google_meet: "Google Meet",
  zoom: "Zoom",
};

export function videoSetting(raw: unknown): VideoSetting {
  return raw === "zoom" || raw === "guest_choice" ? raw : "google_meet";
}

/** The platforms a guest can actually get on this link, given what the host has connected. */
export function videoOptions(
  setting: VideoSetting,
  connected: Record<VideoProvider, boolean>,
): VideoProvider[] {
  const wanted = setting === "guest_choice" ? VIDEO_PROVIDERS : [setting];
  return wanted.filter((provider) => connected[provider]);
}

/** The guest's pick when it is allowed, otherwise the first option. */
export function pickVideo(options: VideoProvider[], requested: unknown): VideoProvider | null {
  const match = options.find((option) => option === requested);
  return match ?? options[0] ?? null;
}

/**
 * Why a link with this setting can't make its video calls yet, or null when it
 * can. "Their choice" needs both logins: with one, guests would have no choice.
 */
export function videoBlocker(
  setting: VideoSetting,
  connected: Record<VideoProvider, boolean>,
): string | null {
  const google = connected.google_meet;
  const zoom = connected.zoom;
  if (setting === "google_meet") return google ? null : "Connect Google to use Google Meet.";
  if (setting === "zoom") return zoom ? null : "Connect Zoom to use Zoom.";
  if (google && zoom) return null;
  if (!google && !zoom) return "Connect Google and Zoom so guests can choose.";
  return google
    ? "Connect Zoom too, so guests can choose."
    : "Connect Google too, so guests can choose.";
}
