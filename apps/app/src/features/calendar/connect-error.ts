// What a failed Google or Outlook Connect says. The desktop sign-in fails with
// internal codes (`missing_google_client_id:set …`, `oauth_callback_bind_failed`);
// people see a sentence instead. Anything that is already a sentence passes as is.

export type ConnectProvider = "google" | "microsoft";

const NAMES: Record<ConnectProvider, string> = {
  google: "Google Calendar",
  microsoft: "Outlook",
};

const CODE = /^[a-z0-9_]+(?::|$)/;

export function connectErrorText(provider: ConnectProvider, raw: string): string {
  const name = NAMES[provider];
  // Both connect on the web too, and a login connected there syncs here.
  if (/^missing_[a-z]+_client_id\b/.test(raw)) {
    return `Connecting ${name} isn't set up in this version of the app. Connect it at app.moduo.app instead; it shows here too.`;
  }
  if (CODE.test(raw)) return `Couldn't connect ${name}. Try again.`;
  return raw;
}
