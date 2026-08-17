/**
 * Reusable Zod 4 primitive schemas for boundary validation.
 *
 * These are framework-agnostic — no React, Node, or Deno runtime APIs.
 * Both the browser (via node_modules) and Deno (via deno.json import map)
 * resolve `import { z } from "zod"` to the same pinned version (4.4.3).
 *
 * Naming convention: each schema is a camelCase const (`isoDateTime`,
 * `httpUrl`), and each inferred type is the PascalCase equivalent
 * (`IsoDateTime`, `HttpUrl`). Schemas that produce a transformed output
 * type use `.transform()` and the inferred type reflects the output.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// String schemas
// ---------------------------------------------------------------------------

/**
 * A non-empty string (after trimming). Use for required text fields.
 */
export const nonEmptyString = z.string().trim().min(1);
export type NonEmptyString = z.infer<typeof nonEmptyString>;

/**
 * An optional string — accepts `undefined` and produces `string | undefined`.
 * Empty strings are NOT coerced to `undefined`; use `.optional()` at the
 * object-property level for that.
 */
export const optionalString = z.string().optional();
export type OptionalString = z.infer<typeof optionalString>;

/**
 * A non-empty environment variable string. Use for required env vars
 * (e.g. `Deno.env.get("KEY")` results that must be present).
 */
export const envString = z.string().min(1);
export type EnvString = z.infer<typeof envString>;

// ---------------------------------------------------------------------------
// Identifier schemas
// ---------------------------------------------------------------------------

/**
 * A UUID v4 string (validated by Zod's built-in UUID checker).
 */
export const uuid = z.uuid();
export type Uuid = z.infer<typeof uuid>;

// ---------------------------------------------------------------------------
// Numeric schemas
// ---------------------------------------------------------------------------

/**
 * A positive integer (excludes zero). Use for limits, counts, and
 * pagination parameters.
 */
export const positiveInt = z.number().int().positive();
export type PositiveInt = z.infer<typeof positiveInt>;

// ---------------------------------------------------------------------------
// Format schemas
// ---------------------------------------------------------------------------

/**
 * An ISO 8601 datetime string (e.g. `"2024-01-15T10:30:00Z"`).
 * Uses Zod 4's `z.iso.datetime()` which validates the full ISO format
 * including timezone designator.
 */
export const isoDateTime = z.iso.datetime();
export type IsoDateTime = z.infer<typeof isoDateTime>;

/**
 * An HTTP or HTTPS URL string. `z.url()` validates URL syntax; the
 * refine restricts the scheme to `http:` or `https:` so `ftp://`,
 * `file:`, etc. are rejected.
 */
export const httpUrl = z
  .url()
  .refine((url) => url.startsWith("http://") || url.startsWith("https://"), {
    message: "Must be an http or https URL",
  });
export type HttpUrl = z.infer<typeof httpUrl>;

/**
 * A string containing valid JSON (the string itself is returned, not
 * the parsed value). Use to validate that a text column or env var
 * holds parseable JSON before calling `JSON.parse()` downstream.
 */
export const jsonString = z
  .string()
  .refine(
    (val) => {
      try {
        JSON.parse(val);
        return true;
      } catch {
        return false;
      }
    },
    { message: "Invalid JSON string" },
  );
export type JsonString = z.infer<typeof jsonString>;
