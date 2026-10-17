/**
 * Deploy-gap reads: try the newest column set first and step down one tier
 * while the database answers "no such column" (42703), so a client deployed
 * ahead of its migration keeps reading instead of walling the module. Any
 * other error stops at once — an outage must surface, not look like an older
 * schema. NR-1 (notes) is the first three-tier user.
 */
export async function selectFirstDeployedTier<R extends { error: { code?: string } | null }>(
  tiers: readonly string[],
  query: (columns: string) => Promise<R>,
): Promise<{ res: R; tier: number }> {
  if (tiers.length === 0) throw new Error("selectFirstDeployedTier needs at least one tier.");
  let tier = 0;
  let res = await query(tiers[0]);
  while (res.error?.code === "42703" && tier < tiers.length - 1) {
    tier += 1;
    res = await query(tiers[tier]);
  }
  return { res, tier };
}

/** PostgREST's answer when a table doesn't exist (yet): Postgres' 42P01, or
 * PostgREST's schema-cache miss PGRST205. */
export function isMissingTableError(error: { code?: string } | null | undefined): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}
