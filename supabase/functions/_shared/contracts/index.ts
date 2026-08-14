/**
 * Barrel re-export for the shared Zod contract layer.
 *
 * Import from `@contracts` (browser) or `../_shared/contracts` (Deno):
 *
 * ```ts
 * import { parseOrError, isoDateTime, uuid } from "@contracts";
 * // or in Deno:
 * import { parseOrError, isoDateTime, uuid } from "../_shared/contracts/index.ts";
 * ```
 */

export {
  formatZodError,
  parseOrError,
  parseOrStructured,
  type SafeParseErr,
  type SafeParseOk,
  type SafeParseResult,
  type StructuredFieldError,
} from "./errors.ts";

export {
  envString,
  httpUrl,
  isoDateTime,
  jsonString,
  nonEmptyString,
  optionalString,
  positiveInt,
  uuid,
  type EnvString,
  type HttpUrl,
  type IsoDateTime,
  type JsonString,
  type NonEmptyString,
  type OptionalString,
  type PositiveInt,
  type Uuid,
} from "./primitives.ts";

export { PLAN_TIER_VALUES } from "./supabase-types-check.ts";
