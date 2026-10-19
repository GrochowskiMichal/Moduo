// App version order (REL-4): SemVer, enough for Moduo's versions. Shared by
// What's new and the synced preferences (the last-seen version only moves forward).

function parseVersion(v: string): { core: number[]; pre: string | null } {
  const [main, ...rest] = v.trim().replace(/^v/, "").split("-");
  const core = (main ?? "").split(".").map((n) => Number.parseInt(n, 10) || 0);
  while (core.length < 3) core.push(0);
  return { core, pre: rest.length ? rest.join("-") : null };
}

/** SemVer order, enough for Moduo's versions: 1.2.0-rc.3 < 1.2.0 < 1.2.1. */
export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    const diff = (pa.core[i] ?? 0) - (pb.core[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;
  return pa.pre.localeCompare(pb.pre, "en", { numeric: true });
}

/** The newer of two versions (either may be missing). */
export function newerVersion(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return compareVersions(a, b) >= 0 ? a : b;
}
