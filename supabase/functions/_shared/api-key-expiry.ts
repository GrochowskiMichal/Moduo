// Whether an API key's expiry has passed. Shared by the moduo-mcp connector
// (which refuses the key) and its test. A missing expiry never expires; an
// unparseable one fails closed, so a bad value can't leave a key live for good.

export function apiKeyExpired(expiresAt: string | null | undefined, now: number = Date.now()): boolean {
  if (expiresAt === null || expiresAt === undefined) return false;
  const at = Date.parse(expiresAt);
  return Number.isNaN(at) || at <= now;
}
