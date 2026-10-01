import { describe, expect, test } from "vitest";
import { parseGuestEmails } from "./guests";

describe("parseGuestEmails", () => {
  test("keeps distinct guest emails and ignores blanks", () => {
    const parsed = parseGuestEmails(
      ["  Ada@Example.com ", "", "bob@example.com"],
      "me@example.com",
    );
    expect(parsed).toEqual({ ok: true, emails: ["ada@example.com", "bob@example.com"] });
  });

  test("rejects the booker's own email, duplicates, and bad addresses", () => {
    expect(parseGuestEmails(["me@example.com"], "me@example.com").ok).toBe(false);
    expect(parseGuestEmails(["a@b.co", "a@b.co"], "me@example.com").ok).toBe(false);
    expect(parseGuestEmails(["not-an-email"], "me@example.com").ok).toBe(false);
  });

  test("rejects more than ten guests", () => {
    const many = Array.from({ length: 11 }, (_, i) => `g${i}@example.com`);
    expect(parseGuestEmails(many, "me@example.com").ok).toBe(false);
  });
});
