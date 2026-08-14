/**
 * Compile-time drift checks between Zod contract schemas and generated
 * Supabase types.
 *
 * These are TYPE-ONLY assertions — they produce no runtime code. If a
 * generated enum drifts from the contract, `tsc` (and `deno check`)
 * will fail with a type error on the corresponding `_check` constant.
 *
 * The generated types file (`src/types/supabase.ts`) is self-contained
 * (no imports), so both tsc and Deno can resolve this relative import.
 *
 * When task 2 adds vocabulary schemas, their drift checks go HERE.
 */

import type { Database } from "../../../../src/types/supabase.ts";

// ---------------------------------------------------------------------------
// plan_tier — the only enum in Database.public.Enums today
// ---------------------------------------------------------------------------

type PlanTierGenerated = Database["public"]["Enums"]["plan_tier"];

/**
 * Assert that the generated `plan_tier` union is exactly
 * `"free" | "pro" | "team" | "founder"`.
 *
 * `[T] extends [U]` (wrapped in tuples) prevents distributive conditional
 * types, giving a true bidirectional equality check.
 */
type AssertEqual<A, B> =
  [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const _planTierCheck: AssertEqual<
  PlanTierGenerated,
  "free" | "pro" | "team" | "founder"
> = true;

// ---------------------------------------------------------------------------
// Constants runtime check (re-exported for tests)
// ---------------------------------------------------------------------------

/**
 * The canonical `plan_tier` values as declared in the generated types.
 * Task 3's live `pg_enum` probe is the authority on whether the actual
 * production label is `founder` (singular, per generated types) or
 * `founders` (plural, per some Stripe/sync write paths). This constant
 * mirrors the generated `Constants` — it is NOT the live-catalog truth.
 */
export const PLAN_TIER_VALUES = [
  "free",
  "pro",
  "team",
  "founder",
] as const;

// Silence "unused" — _planTierCheck is a compile-time assertion.
void _planTierCheck;
