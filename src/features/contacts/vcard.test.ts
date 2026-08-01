// vCard 4.0 export proof — a full contact round-trips the expected lines, an
// empty contact yields a minimal valid card, escaping is correct, and the bulk
// serializer resolves ORG via the companyId → name map.

import { describe, expect, it } from "vitest";

import type { Contact } from "./model";
import { contactsToVCard, contactToVCard } from "./vcard";

const CRLF = "\r\n";

function contact(over: Partial<Contact>): Contact {
  return {
    id: "c0",
    workspaceId: "w",
    ownerId: "u",
    name: "",
    email: null,
    emails: [],
    phone: null,
    phones: [],
    addresses: [],
    urls: [],
    dates: [],
    title: null,
    companyId: null,
    status: "",
    custom: {},
    isFavorite: false,
    notesInline: "",
    avatarUrl: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    deletedAt: null,
    ...over,
  };
}

/** Split a card body into its lines for order-independent assertions. */
function lines(card: string): string[] {
  return card.split(CRLF);
}

describe("contactToVCard", () => {
  it("wraps every card in a valid 4.0 envelope", () => {
    const card = contactToVCard(contact({ name: "Dana Lee" }));
    const ls = lines(card);
    expect(ls[0]).toBe("BEGIN:VCARD");
    expect(ls[1]).toBe("VERSION:4.0");
    expect(ls.at(-1)).toBe("END:VCARD");
  });

  it("joins lines with CRLF", () => {
    const card = contactToVCard(contact({ name: "Dana Lee" }));
    expect(card).toContain(CRLF);
    expect(card.startsWith(`BEGIN:VCARD${CRLF}VERSION:4.0${CRLF}`)).toBe(true);
  });

  it("round-trips a full contact to the expected lines", () => {
    const card = contactToVCard(
      contact({
        name: "Dana Lee",
        title: "Head of Design",
        emails: [
          { label: "work", value: "dana@acme.com", primary: true },
          { label: "home", value: "dana@home.example" },
        ],
        phones: [{ label: "mobile", value: "+1-555-0100" }],
        addresses: [{ label: "work", value: "1 Market St, San Francisco" }],
        urls: [{ label: "portfolio", value: "https://dana.example" }],
        dates: [{ label: "birthday", value: "1990-04-05" }],
      }),
      { companyName: "Acme Inc" },
    );
    const ls = lines(card);

    expect(ls).toEqual([
      "BEGIN:VCARD",
      "VERSION:4.0",
      "FN:Dana Lee",
      "N:Lee;Dana;;;",
      "ORG:Acme Inc",
      "TITLE:Head of Design",
      'EMAIL;TYPE="work":dana@acme.com',
      'EMAIL;TYPE="home":dana@home.example',
      'TEL;TYPE="mobile":+1-555-0100',
      'ADR;TYPE="work":;;1 Market St\\, San Francisco;;;;',
      'URL;TYPE="portfolio":https://dana.example',
      "BDAY:19900405",
      "END:VCARD",
    ]);
  });

  it("yields a minimal valid card for an empty contact", () => {
    const card = contactToVCard(contact({}));
    expect(lines(card)).toEqual(["BEGIN:VCARD", "VERSION:4.0", "FN:", "END:VCARD"]);
  });

  it("splits N on the LAST space (multi-token given name)", () => {
    const card = contactToVCard(contact({ name: "Mary Anne Smith" }));
    expect(card).toContain(`${CRLF}N:Smith;Mary Anne;;;${CRLF}`);
  });

  it("treats a single-token name as the given name (no family)", () => {
    const card = contactToVCard(contact({ name: "Cher" }));
    expect(card).toContain(`${CRLF}N:;Cher;;;${CRLF}`);
  });

  it("skips empty channel values but keeps populated siblings", () => {
    const card = contactToVCard(
      contact({
        name: "Dana Lee",
        emails: [
          { label: "work", value: "" },
          { label: "home", value: "dana@home.example" },
        ],
        phones: [{ label: "mobile", value: "   " }],
      }),
    );
    expect(card).not.toContain('EMAIL;TYPE="work"');
    expect(card).toContain('EMAIL;TYPE="home":dana@home.example');
    expect(card).not.toContain("TEL");
  });

  it("omits ORG when no company name is supplied", () => {
    const card = contactToVCard(contact({ name: "Dana Lee" }));
    expect(card).not.toContain("ORG:");
  });

  it("omits ORG for a blank/whitespace company name", () => {
    const card = contactToVCard(contact({ name: "Dana Lee" }), { companyName: "   " });
    expect(card).not.toContain("ORG:");
  });

  it("omits TITLE when title is null or blank", () => {
    expect(contactToVCard(contact({ name: "Dana Lee", title: null }))).not.toContain("TITLE:");
    expect(contactToVCard(contact({ name: "Dana Lee", title: "  " }))).not.toContain("TITLE:");
  });

  it("only treats the 'birthday' label as BDAY", () => {
    const card = contactToVCard(
      contact({
        name: "Dana Lee",
        dates: [
          { label: "anniversary", value: "2015-06-01" },
          { label: "birthday", value: "1990-04-05" },
        ],
      }),
    );
    expect(card).toContain(`${CRLF}BDAY:19900405${CRLF}`);
    expect(card).not.toContain("20150601");
  });

  it("omits BDAY when there is no birthday entry", () => {
    const card = contactToVCard(
      contact({ name: "Dana Lee", dates: [{ label: "anniversary", value: "2015-06-01" }] }),
    );
    expect(card).not.toContain("BDAY:");
  });

  describe("escaping (RFC 6350 §3.4)", () => {
    it("escapes commas, semicolons and newlines in text values", () => {
      const card = contactToVCard(contact({ name: "Smith, John;Jr\nesq" }));
      expect(card).toContain(`${CRLF}FN:Smith\\, John\\;Jr\\nesq${CRLF}`);
    });

    it("escapes backslashes first (no double-escaping)", () => {
      const card = contactToVCard(contact({ name: "a\\b" }));
      // Single backslash → "\\", and crucially not "\\\\,".
      expect(card).toContain(`${CRLF}FN:a\\\\b${CRLF}`);
    });

    it("escapes special chars inside the N components", () => {
      const card = contactToVCard(contact({ name: "Anne O'Brien-Smith, III" }));
      // Given "Anne O'Brien-Smith", family "III" (split on last space).
      expect(card).toContain(`${CRLF}N:III;Anne O'Brien-Smith\\,;;;${CRLF}`);
    });

    it("strips double quotes from TYPE parameter labels", () => {
      const card = contactToVCard(
        contact({ name: "Dana Lee", emails: [{ label: 'we"ird', value: "x@y.com" }] }),
      );
      expect(card).toContain('EMAIL;TYPE="weird":x@y.com');
    });

    it("escapes the freeform ADR street component", () => {
      const card = contactToVCard(
        contact({ name: "Dana Lee", addresses: [{ label: "work", value: "1 Main; Apt 2" }] }),
      );
      expect(card).toContain('ADR;TYPE="work":;;1 Main\\; Apt 2;;;;');
    });
  });
});

describe("contactsToVCard", () => {
  it("concatenates each card joined with CRLF", () => {
    const a = contact({ id: "a", name: "Ann" });
    const b = contact({ id: "b", name: "Bob" });
    const doc = contactsToVCard([a, b]);
    expect(doc).toBe(contactToVCard(a) + CRLF + contactToVCard(b));
    expect(doc.split("BEGIN:VCARD").length - 1).toBe(2);
  });

  it("resolves ORG per contact via the companyId → name map", () => {
    const a = contact({ id: "a", name: "Ann", companyId: "co1" });
    const b = contact({ id: "b", name: "Bob", companyId: "co2" });
    const names = new Map([
      ["co1", "Acme"],
      ["co2", "Globex"],
    ]);
    const doc = contactsToVCard([a, b], names);
    expect(doc).toContain(`${CRLF}ORG:Acme${CRLF}`);
    expect(doc).toContain(`${CRLF}ORG:Globex${CRLF}`);
  });

  it("emits no ORG when a contact's companyId is missing from the map", () => {
    const a = contact({ id: "a", name: "Ann", companyId: "ghost" });
    const doc = contactsToVCard([a], new Map());
    expect(doc).not.toContain("ORG:");
  });

  it("emits no ORG for a contact with a null companyId", () => {
    const a = contact({ id: "a", name: "Ann", companyId: null });
    const doc = contactsToVCard([a], new Map([["co1", "Acme"]]));
    expect(doc).not.toContain("ORG:");
  });

  it("returns an empty string for an empty list", () => {
    expect(contactsToVCard([])).toBe("");
  });
});
