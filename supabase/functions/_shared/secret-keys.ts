/**
 * Shared Edge Function helper: resolve the project's full-access credential
 * from the SUPABASE_SECRET_KEYS JSON secret (the `default` entry).
 *
 * Supabase's secret-key format ships as a JSON object in a single env var; the
 * `default` entry is the full-access secret used by backend functions.
 *
 * Strict by design: a missing/malformed secret throws at module load, so a
 * function deployed without the secret fails loudly instead of booting with an
 * empty key.
 */

export class SecretKeyConfigError extends Error {
  constructor(message: string) {
    super(`SUPABASE_SECRET_KEYS: ${message}`);
    this.name = "SecretKeyConfigError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse the SUPABASE_SECRET_KEYS value and return the `default` secret key. */
export function parseSecretKeys(raw: string | null): string {
  if (!raw) {
    throw new SecretKeyConfigError(
      'is not set. Add it to Edge Function secrets as the JSON object of secret keys, e.g. {"default":"sb_secret_..."}.',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SecretKeyConfigError("is not valid JSON.");
  }

  if (!isRecord(parsed)) {
    throw new SecretKeyConfigError(
      'must be a JSON object of secret keys, e.g. {"default":"sb_secret_..."}.',
    );
  }

  const value = parsed["default"];
  if (typeof value !== "string" || value.length === 0) {
    throw new SecretKeyConfigError('must include a "default" entry with a non-empty string value.');
  }
  if (!value.startsWith("sb_secret_")) {
    throw new SecretKeyConfigError('the "default" entry must be a Supabase secret key starting with "sb_secret_".');
  }

  return value;
}

/** Read SUPABASE_SECRET_KEYS from the environment and return the `default` secret key. */
export function getDefaultSecretKey(): string {
  return parseSecretKeys(Deno.env.get("SUPABASE_SECRET_KEYS"));
}
