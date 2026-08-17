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
 * Runtime drift tests (contract values vs `Constants.public.Enums` vs the
 * live pg_enum probe fixture) live in `vocabularies.test.ts`.
 */

import type { Database } from "../../../../src/types/supabase.ts";

import type { PlanTier } from "./vocabularies.ts";

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
type AssertEqual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

const _planTierCheck: AssertEqual<
  PlanTierGenerated,
  "free" | "pro" | "team" | "founder"
> = true;

/**
 * Assert the contract-layer `PlanTier` type (vocabularies.ts) is exactly the
 * generated enum — the type-level half of the drift guard; the runtime half
 * compares `PLAN_TIERS` to `Constants.public.Enums.plan_tier`.
 */
const _planTierContractCheck: AssertEqual<PlanTier, PlanTierGenerated> = true;

// Silence "unused" — these are compile-time assertions.
void _planTierCheck;
void _planTierContractCheck;
