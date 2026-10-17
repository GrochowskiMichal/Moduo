// Pure helpers for the Account settings section (DF-19c). Kept side-effect-free
// so the identity + change-password logic is unit-tested without a live session.

export const MIN_PASSWORD_LENGTH = 8;

/** Validates a new-password + confirmation pair. Returns an error message to
 *  show inline, or null when the pair is acceptable. */
export function validateNewPassword(password: string, confirm: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password !== confirm) {
    return "The two passwords don't match.";
  }
  return null;
}

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

/** Whether an account can set/change a Supabase password. OAuth-only accounts
 *  (google/github/…) sign in through their provider and have no password to
 *  manage. An unknown/absent provider defaults to email (password-capable). */
export function isPasswordProvider(provider: string | null | undefined): boolean {
  return !provider || provider === "email";
}
