// parseContactText proof: a pasted signature blob, a bare email, and junk input
// all map to a forgiving ParsedContactInput — best-effort, never throws.

import { describe, expect, it } from "vitest";

import { channelsFromValues, parseContactText, parsedContactChannels } from "./parse-contact";

describe("parseContactText — signature blob", () => {
  const blob = "Jane Doe\nHead of Ops at Acme\njane@acme.com\n+1 555 123 4567";

  it("extracts name, email, phone, title, and company", () => {
    const parsed = parseContactText(blob);
    expect(parsed.name).toBe("Jane Doe");
    expect(parsed.emails).toEqual(["jane@acme.com"]);
    expect(parsed.phones).toEqual(["+1 555 123 4567"]);
    expect(parsed.title).toBe("Head of Ops");
    expect(parsed.company).toBe("Acme");
  });
});

describe("parseContactText — emails", () => {
  it("lowercases and dedups multiple addresses, order-preserving", () => {
    const parsed = parseContactText("JANE@Acme.com\nalt: Jane@acme.com\nbar@foo.io");
    expect(parsed.emails).toEqual(["jane@acme.com", "bar@foo.io"]);
  });

  it("matches plus-tagged and subdomained addresses", () => {
    const parsed = parseContactText("Contact: jane+sales@mail.acme.co.uk");
    expect(parsed.emails).toEqual(["jane+sales@mail.acme.co.uk"]);
  });

  it("a bare email yields just the email — no name/phone/title/company", () => {
    expect(parseContactText("jane@acme.com")).toEqual({
      name: null,
      emails: ["jane@acme.com"],
      phones: [],
      title: null,
      company: null,
    });
  });
});

describe("parseContactText — phones", () => {
  it("keeps tokens with >= 7 digits and original formatting", () => {
    const parsed = parseContactText("Call (555) 123-4567");
    expect(parsed.phones).toEqual(["(555) 123-4567"]);
  });

  it("ignores short digit runs (< 7 digits)", () => {
    expect(parseContactText("Suite 200, room 12").phones).toEqual([]);
  });

  it("dedups repeated numbers", () => {
    const parsed = parseContactText("+1 555 123 4567\nmobile +1 555 123 4567");
    expect(parsed.phones).toEqual(["+1 555 123 4567"]);
  });
});

describe("parseContactText — name heuristic", () => {
  it("takes the first non-channel, name-shaped line", () => {
    const parsed = parseContactText("jane@acme.com\nJane Doe\n+1 555 123 4567");
    expect(parsed.name).toBe("Jane Doe");
  });

  it("rejects lines longer than 5 words", () => {
    const parsed = parseContactText("this is a very long sentence indeed\nJane Doe");
    expect(parsed.name).toBe("Jane Doe");
  });

  it("never treats a url or phone line as a name", () => {
    const parsed = parseContactText("www.acme.com\n+1 555 123 4567\njane@acme.com");
    expect(parsed.name).toBeNull();
  });
});

describe("parseContactText — title/company splitters", () => {
  it("splits on ' at '", () => {
    const p = parseContactText("Jane Doe\nDesigner at Foo Inc");
    expect(p.title).toBe("Designer");
    expect(p.company).toBe("Foo Inc");
  });

  it("splits on a comma", () => {
    const p = parseContactText("Jane Doe\nProduct Manager, Bar Co");
    expect(p.title).toBe("Product Manager");
    expect(p.company).toBe("Bar Co");
  });

  it("splits on a pipe", () => {
    const p = parseContactText("Jane Doe\nLead Engineer | Baz");
    expect(p.title).toBe("Lead Engineer");
    expect(p.company).toBe("Baz");
  });

  it("splits on an em dash", () => {
    const p = parseContactText("Jane Doe\nCTO — Qux");
    expect(p.title).toBe("CTO");
    expect(p.company).toBe("Qux");
  });

  it("does not split the name line itself", () => {
    const p = parseContactText("Jane, Doe");
    // The first line is consumed as the name; no role line remains.
    expect(p.name).toBe("Jane, Doe");
    expect(p.title).toBeNull();
    expect(p.company).toBeNull();
  });

  it("leaves title/company null when no splitter is present", () => {
    const p = parseContactText("Jane Doe\nFreelancer");
    expect(p.title).toBeNull();
    expect(p.company).toBeNull();
  });
});

describe("parseContactText — defensive edges", () => {
  it("empty string → all empty/null", () => {
    expect(parseContactText("")).toEqual({
      name: null,
      emails: [],
      phones: [],
      title: null,
      company: null,
    });
  });

  it("whitespace-only → all empty/null", () => {
    expect(parseContactText("   \n\t  \n")).toEqual({
      name: null,
      emails: [],
      phones: [],
      title: null,
      company: null,
    });
  });

  it("does not throw on non-string input", () => {
    // The form may hand us a stray non-string; tolerate it.
    expect(() => parseContactText(undefined as unknown as string)).not.toThrow();
    expect(parseContactText(undefined as unknown as string).emails).toEqual([]);
  });

  it("a realistic multi-line signature parses all fields", () => {
    const sig = [
      "Best,",
      "Dana Lee",
      "VP Engineering at Globex",
      "dana.lee@globex.com",
      "Mobile: +44 20 7946 0958",
      "https://globex.com",
    ].join("\n");
    const p = parseContactText(sig);
    expect(p.name).toBe("Dana Lee"); // "Best," is a sign-off (trailing comma), correctly skipped
    expect(p.emails).toEqual(["dana.lee@globex.com"]);
    expect(p.phones).toEqual(["+44 20 7946 0958"]);
    expect(p.title).toBe("VP Engineering");
    expect(p.company).toBe("Globex");
  });
});

describe("parsedContactChannels — multi-value fill (FX-6 AC9)", () => {
  it("carries every parsed email + phone as labelled channels, first primary", () => {
    const parsed = parseContactText("Jane Doe\njane@a.com\njane@b.com\nMobile: +1 555 0100");
    const { emails, phones } = parsedContactChannels(parsed);
    expect(emails.map((e) => e.value)).toEqual(["jane@a.com", "jane@b.com"]);
    expect(emails[0]!.primary).toBe(true);
    expect(emails[1]!.primary).toBe(false);
    expect(phones).toHaveLength(1);
    expect(phones[0]!.value).toBe("+1 555 0100");
    expect(phones[0]!.primary).toBe(true);
  });

  it("channelsFromValues drops blanks and duplicates, marking the first primary", () => {
    const rows = channelsFromValues(["a@x.com", "", "A@X.com", "b@x.com"]);
    expect(rows.map((r) => r.value)).toEqual(["a@x.com", "b@x.com"]);
    expect(rows[0]!.primary).toBe(true);
  });
});
