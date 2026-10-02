/**
 * Structured error helpers for Zod boundary validation.
 *
 * Convention: use `parseOrError` at trust boundaries (Edge Function inputs,
 * RPC results, persistence reads, provider payloads). It wraps `safeParse`
 * into a discriminated union so callers can branch on `result.success`
 * without importing ZodError or dealing with the raw Zod error shape.
 *
 * `formatZodError` converts a ZodError into a serializable array of
 * `{ message, path, code }` objects — safe to return in HTTP responses,
 * log, or surface to the UI.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SafeParseOk<T> = { success: true; data: T };
export type SafeParseErr = { success: false; error: z.ZodError };
export type SafeParseResult<T> = SafeParseOk<T> | SafeParseErr;

/**
 * A single structured field error, serializable and UI-safe.
 */
export interface StructuredFieldError {
  /** Human-readable error message. */
  message: string;
  /** Path to the offending field (array of string keys / array indices). */
  path: (string | number)[];
  /** Zod issue code (e.g. `"invalid_type"`, `"invalid_value"`, `"too_small"`). */
  code: string;
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * Parse `input` against `schema`, returning a discriminated union.
 *
 * On success: `{ success: true, data: T }`.
 * On failure: `{ success: false, error: z.ZodError }` — use `formatZodError`
 * to convert the error into a serializable shape.
 *
 * This is the **boundary convention** — call it wherever untrusted data
 * enters the system (HTTP bodies, RPC results, localStorage, provider
 * responses). For optional reads that should degrade gracefully, catch
 * the error and fall back to a default rather than surfacing it.
 */
export function parseOrError<T>(schema: z.ZodType<T>, input: unknown): SafeParseResult<T> {
  const result = schema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

/**
 * Convert a ZodError into an array of serializable field errors.
 *
 * Each issue's `path` (which is `PropertyKey[]` in Zod 4, potentially
 * containing `symbol`) is narrowed to `(string | number)[]` by filtering
 * out non-string/number segments.
 */
export function formatZodError(error: z.ZodError): StructuredFieldError[] {
  return error.issues.map((issue) => ({
    message: issue.message,
    path: issue.path.filter(
      (segment): segment is string | number =>
        typeof segment === "string" || typeof segment === "number",
    ),
    code: issue.code,
  }));
}

/**
 * Parse `input` against `schema`, returning the data on success or a
 * serializable error array on failure. Convenience wrapper for HTTP
 * response paths where you want the structured errors directly.
 */
export function parseOrStructured<T>(
  schema: z.ZodType<T>,
  input: unknown,
):
  | { success: true; data: T }
  | { success: false; errors: StructuredFieldError[] } {
  const result = parseOrError(schema, input);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, errors: formatZodError(result.error) };
}
