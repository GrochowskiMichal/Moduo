import { describe, expect, test } from "@rstest/core";
import { isEmailAddress, parseGuestEmails } from "./guests";

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

describe("isEmailAddress", () => {
  test("accepts a plain address", () => {
    expect(isEmailAddress("ana@example.com")).toBe(true);
    expect(isEmailAddress("ana.lopez+book@mail.example.co")).toBe(true);
  });

  test("rejects display names, lists and brackets that a mail API would reinterpret", () => {
    for (const value of [
      "Ana <ana@example.com>",
      "<ana@example.com>",
      "x<ana@example.com>",
      '"Your account" <ana@example.com>',
      "ana@example.com, bo@example.com",
      "ana@example.com;bo@example.com",
      "ana@example.com bo@example.com",
      "ana@localhost",
      "ana",
      "",
    ]) {
      expect(isEmailAddress(value)).toBe(false);
    }
  });
});
