import { describe, it, expect } from "vitest";
import { z } from "zod";

import {
  parseOrError,
  parseOrStructured,
  formatZodError,
  envString,
  httpUrl,
  isoDateTime,
  jsonString,
  nonEmptyString,
  optionalString,
  positiveInt,
  uuid,
} from "./index.ts";

// ---------------------------------------------------------------------------
// parseOrError
// ---------------------------------------------------------------------------

describe("parseOrError", () => {
  const schema = z.object({ name: z.string(), age: z.number() });

  it("returns success with data for valid input", () => {
    const result = parseOrError(schema, { name: "Alice", age: 30 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ name: "Alice", age: 30 });
    }
  });

  it("returns failure with ZodError for invalid input", () => {
    const result = parseOrError(schema, { name: 123, age: "old" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(z.ZodError);
      expect(result.error.issues.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("returns failure for null input", () => {
    const result = parseOrError(schema, null);
    expect(result.success).toBe(false);
  });

  it("returns failure for undefined input", () => {
    const result = parseOrError(schema, undefined);
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// formatZodError
// ---------------------------------------------------------------------------

describe("formatZodError", () => {
  it("produces serializable structured errors", () => {
    const schema = z.object({
      email: z.string().email(),
      age: z.number().int().positive(),
    });
    const result = parseOrError(schema, { email: "not-an-email", age: -5 });
    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = formatZodError(result.error);
      expect(formatted.length).toBe(2);
      for (const err of formatted) {
        expect(typeof err.message).toBe("string");
        expect(Array.isArray(err.path)).toBe(true);
        expect(typeof err.code).toBe("string");
      }
      // Paths should contain the field names
      const paths = formatted.map((e) => e.path.join("."));
      expect(paths).toContain("email");
      expect(paths).toContain("age");
    }
  });

  it("handles nested object paths", () => {
    const schema = z.object({
      user: z.object({
        name: z.string(),
      }),
    });
    const result = parseOrError(schema, { user: { name: 123 } });
    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = formatZodError(result.error);
      expect(formatted[0].path).toEqual(["user", "name"]);
    }
  });

  it("handles array index paths", () => {
    const schema = z.array(z.string());
    const result = parseOrError(schema, ["ok", 123]);
    expect(result.success).toBe(false);
    if (!result.success) {
      const formatted = formatZodError(result.error);
      expect(formatted[0].path).toEqual([1]);
    }
  });
});

// ---------------------------------------------------------------------------
// parseOrStructured
// ---------------------------------------------------------------------------

describe("parseOrStructured", () => {
  const schema = z.object({ id: z.string() });

  it("returns data on success", () => {
    const result = parseOrStructured(schema, { id: "abc" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ id: "abc" });
    }
  });

  it("returns structured errors on failure", () => {
    const result = parseOrStructured(schema, { id: 123 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(Array.isArray(result.errors)).toBe(true);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].code).toBe("invalid_type");
    }
  });
});

// ---------------------------------------------------------------------------
// Primitive schemas
// ---------------------------------------------------------------------------

describe("nonEmptyString", () => {
  it("accepts a non-empty string", () => {
    expect(nonEmptyString.safeParse("hello").success).toBe(true);
  });
  it("rejects an empty string", () => {
    expect(nonEmptyString.safeParse("").success).toBe(false);
  });
  it("rejects whitespace-only (trims first)", () => {
    expect(nonEmptyString.safeParse("   ").success).toBe(false);
  });
  it("rejects a number", () => {
    expect(nonEmptyString.safeParse(42).success).toBe(false);
  });
});

describe("optionalString", () => {
  it("accepts a string", () => {
    expect(optionalString.safeParse("hi").success).toBe(true);
  });
  it("accepts undefined", () => {
    expect(optionalString.safeParse(undefined).success).toBe(true);
  });
  it("rejects a number", () => {
    expect(optionalString.safeParse(42).success).toBe(false);
  });
});

describe("envString", () => {
  it("accepts a non-empty string", () => {
    expect(envString.safeParse("secret_key").success).toBe(true);
  });
  it("rejects an empty string", () => {
    expect(envString.safeParse("").success).toBe(false);
  });
});

describe("uuid", () => {
  it("accepts a valid UUID v4", () => {
    expect(uuid.safeParse("550e8400-e29b-41d4-a716-446655440000").success).toBe(true);
  });
  it("rejects an invalid UUID", () => {
    expect(uuid.safeParse("not-a-uuid").success).toBe(false);
  });
  it("rejects a number", () => {
    expect(uuid.safeParse(42).success).toBe(false);
  });
});

describe("positiveInt", () => {
  it("accepts a positive integer", () => {
    expect(positiveInt.safeParse(42).success).toBe(true);
  });
  it("rejects zero", () => {
    expect(positiveInt.safeParse(0).success).toBe(false);
  });
  it("rejects a negative integer", () => {
    expect(positiveInt.safeParse(-1).success).toBe(false);
  });
  it("rejects a float", () => {
    expect(positiveInt.safeParse(3.14).success).toBe(false);
  });
  it("rejects a string", () => {
    expect(positiveInt.safeParse("42").success).toBe(false);
  });
});

describe("isoDateTime", () => {
  it("accepts a valid ISO datetime", () => {
    expect(isoDateTime.safeParse("2024-01-15T10:30:00Z").success).toBe(true);
  });
  it("accepts with milliseconds", () => {
    expect(isoDateTime.safeParse("2024-01-15T10:30:00.123Z").success).toBe(true);
  });
  it("rejects a non-ISO string", () => {
    expect(isoDateTime.safeParse("January 15, 2024").success).toBe(false);
  });
  it("rejects a date-only string", () => {
    expect(isoDateTime.safeParse("2024-01-15").success).toBe(false);
  });
});

describe("httpUrl", () => {
  it("accepts an https URL", () => {
    expect(httpUrl.safeParse("https://example.com").success).toBe(true);
  });
  it("accepts an http URL", () => {
    expect(httpUrl.safeParse("http://localhost:8080").success).toBe(true);
  });
  it("rejects an ftp URL", () => {
    expect(httpUrl.safeParse("ftp://example.com").success).toBe(false);
  });
  it("rejects a non-URL string", () => {
    expect(httpUrl.safeParse("not a url").success).toBe(false);
  });
});

describe("jsonString", () => {
  it("accepts valid JSON object string", () => {
    expect(jsonString.safeParse('{"key":"value"}').success).toBe(true);
  });
  it("accepts valid JSON array string", () => {
    expect(jsonString.safeParse("[1,2,3]").success).toBe(true);
  });
  it("accepts valid JSON primitive string", () => {
    expect(jsonString.safeParse('"hello"').success).toBe(true);
  });
  it("rejects invalid JSON", () => {
    expect(jsonString.safeParse("{key:value}").success).toBe(false);
  });
  it("rejects a number (not a string)", () => {
    expect(jsonString.safeParse(42).success).toBe(false);
  });
});
