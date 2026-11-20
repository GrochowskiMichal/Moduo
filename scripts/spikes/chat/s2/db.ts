// CV-0 spike 2: the local database half. Only the local stack, only the
// scratch schema `spike_s2`: the draft (docs/build/chat-v2/drafts/store.sql)
// is applied there, proven and dropped. `public` is read for its tables'
// shape only (the draft's `like public.…`), never written.

import { SQL } from "bun";

export const LOCAL_DB = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
export const DRAFT = new URL("../../../../docs/build/chat-v2/drafts/store.sql", import.meta.url)
  .pathname;

// Bun.sql double-encodes a string parameter cast `$n::jsonb` (a JSON string is
// stored, not an object): cast `$n::text::jsonb`.
export function connect(): SQL {
  const url = process.env.SPIKE_DB_URL ?? LOCAL_DB;
  if (!/@(127\.0\.0\.1|localhost):54322\//.test(url)) {
    throw new Error("Spike 2 runs on the local stack only (127.0.0.1:54322).");
  }
  return new SQL(url, { max: 4 });
}

function psql(args: string[]): void {
  const res = Bun.spawnSync(["psql", process.env.SPIKE_DB_URL ?? LOCAL_DB, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (res.exitCode !== 0) {
    throw new Error(`psql failed: ${res.stderr.toString()}`);
  }
}

/** Drop and re-create spike_s2 from the draft. */
export function freshSchema(): void {
  psql(["-q", "-c", "drop schema if exists spike_s2 cascade"]);
  psql(["-v", "ON_ERROR_STOP=1", "-q", "-f", DRAFT]);
}

export function dropSchema(): void {
  psql(["-q", "-c", "drop schema if exists spike_s2 cascade"]);
}

/** A server stamp as fixed-width text (microseconds kept; compares as a string). */
export const STAMP = `to_char(m.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '+00'`;
export const CREATED = `to_char(m.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '+00'`;

/** A stamp moved back by `ms` (the delta's lookback), same text form. */
export function stampMinus(stamp: string, ms: number): string {
  const [date, rest] = stamp.split("T");
  const [hms, frac] = rest.replace("+00", "").split(".");
  const at = Date.parse(`${date}T${hms}Z`) * 1000 + Number(frac) - ms * 1000;
  const whole = Math.floor(at / 1_000_000) * 1000;
  const micros = String(at % 1_000_000).padStart(6, "0");
  return `${new Date(whole).toISOString().slice(0, 19)}.${micros}+00`;
}

export function stats(values: number[]): { p50: number; p95: number; max: number; n: number } {
  const s = [...values].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)];
  const r = (v: number) => Math.round(v * 100) / 100;
  return { p50: r(q(0.5)), p95: r(q(0.95)), max: r(s[s.length - 1]), n: s.length };
}
