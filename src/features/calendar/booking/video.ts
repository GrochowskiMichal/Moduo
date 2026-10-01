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
