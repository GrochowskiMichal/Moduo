// Honest connect-error copy (AC37): the engine's auth wire codes
// (`mail/auth/mod.rs` AuthError::code) become plain words. An org that blocks
// the OAuth app gets "ask your admin" with the provider's own code in the
// details; Google's testing-mode re-approval says so.

export type ConnectErrorCopy = { message: string; detail: string | null };

const ADMIN = "admin_consent_required:";

export function connectErrorCopy(raw: string): ConnectErrorCopy {
  const text = raw.trim();
  const admin = text.indexOf(ADMIN);
  if (admin >= 0) {
    const code = text.slice(admin + ADMIN.length).split(/\s/)[0] || null;
    return {
      message:
        "Your organization's admin needs to allow Moduo before this account can connect. Send them this message and try again once they have.",
      detail: code ? `Provider code: ${code}` : null,
    };
  }
  if (text.includes("account_reauth_required")) {
    return {
      message:
        "This account needs a fresh sign-in. While Moduo's Google app is in testing, Google asks again every 7 days.",
      detail: null,
    };
  }
  if (text.includes("account_secret_missing")) {
    return {
      message: "The saved password for this account is gone from the Keychain. Sign in again.",
      detail: null,
    };
  }
  return { message: text, detail: null };
}

export function ConnectError({ error }: { error: string }) {
  const copy = connectErrorCopy(error);
  return (
    <div role="alert" className="flex flex-col gap-1 text-xs text-destructive">
      <p>{copy.message}</p>
      {copy.detail ? <p className="text-muted-foreground">{copy.detail}</p> : null}
    </div>
  );
}
