// The device's time zone goes to the server at every sign-in (TV-D8): a
// repeating task comes back at its assignee's midnight, which the server works
// out from `user_preferences.time_zone`. Settings → Time & region (TV-D14) adds
// a way to override it. Never awaited on the boot path; a failure is retried
// at the next sign-in.

import type { ModuoRuntime } from "./runtime.types";

/** The IANA zone the device is in ("Europe/Warsaw"), or null when unknown. */
export function deviceTimeZone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && zone.trim() ? zone : null;
  } catch {
    return null;
  }
}

const sent = new Set<string>();

/** Send it once per person per app start. */
export function sendDeviceTimeZone(
  runtime: Pick<ModuoRuntime, "preferences">,
  userId: string,
  zone: string | null = deviceTimeZone(),
): void {
  if (!zone || sent.has(userId)) return;
  // A runtime without the call (a test fake, an old desktop shell) sends nothing.
  if (typeof runtime.preferences?.setTimeZone !== "function") return;
  sent.add(userId);
  Promise.resolve()
    .then(() => runtime.preferences.setTimeZone(zone))
    .catch(() => {
      sent.delete(userId);
    });
}

/** Tests only. */
export function resetDeviceTimeZoneSends(): void {
  sent.clear();
}
