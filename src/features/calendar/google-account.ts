/** `google:{email}` is one Google login. `google:{email}:{calendarId}` is one calendar inside it. */

export function googleLoginExternalId(email: string): string {
  return `google:${email}`;
}

export function googleCalendarExternalId(email: string, calendarId: string): string {
  return `google:${email}:${calendarId}`;
}

export function parseGoogleExternalId(
  externalId: string,
): { email: string; calendarId: string | null } | null {
  if (!externalId.startsWith("google:")) return null;
  const rest = externalId.slice("google:".length);
  const colon = rest.indexOf(":");
  if (colon < 0) {
    return rest.length > 0 ? { email: rest, calendarId: null } : null;
  }
  const email = rest.slice(0, colon);
  const calendarId = rest.slice(colon + 1);
  if (!email || !calendarId) return null;
  return { email, calendarId };
}
