// Pure helpers for the Account settings section (DF-19c). Kept side-effect-free
// so the identity logic is unit-tested without a live session. There is no
// password to change: people sign in with an emailed code, and passwords can't be
// set through Supabase Auth (MCPO-1, 20261023000000_auth_no_password_changes.sql).

/** A friendly label for the Supabase auth provider. Supabase reports both
 *  password and magic-link email sign-ups as "email". */
export function providerLabel(provider: string | null | undefined): string {
  switch (provider) {
    case "email":
      return "Email";
    case "google":
      return "Google";
    case "github":
      return "GitHub";
    case "apple":
      return "Apple";
    case "azure":
      return "Microsoft";
    default:
      return provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : "Email";
  }
}
