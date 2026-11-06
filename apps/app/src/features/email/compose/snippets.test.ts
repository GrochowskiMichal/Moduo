import { describe, expect, it } from "@rstest/core";

import {
  fillPlaceholders,
  insertSnippet,
  matchSnippets,
  snippetMissLine,
  snippetPreview,
  snippetRecipient,
} from "./snippets";

const me = { name: "Mike G", email: "mike@x.com" };

describe("snippet placeholders (specs/mail-v3.md §9, AC31)", () => {
  it("first name from display name, local part only without one", () => {
    const body = "Hi {first name}, thanks!";
    expect(
      fillPlaceholders(body, { recipient: { name: "Ana Lima", email: "a.lima@acme.test" }, me }),
    ).toBe("Hi Ana, thanks!");
    expect(fillPlaceholders(body, { recipient: { name: "", email: "dana@acme.test" }, me })).toBe(
      "Hi dana, thanks!",
    );
  });

  it("no recipient: {first name} is empty and the gap closes", () => {
    expect(fillPlaceholders("Thanks {first name} for the deck", { recipient: null, me })).toBe(
      "Thanks for the deck",
    );
    expect(fillPlaceholders("Hi {first name}, thanks", { recipient: null, me })).toBe("Hi, thanks");
    // Unknown placeholders still stay as typed.
    expect(fillPlaceholders("{first name} {unknown}", { recipient: null, me })).toBe("{unknown}");
  });

  it("the recipient's name comes from its own form, then known people", () => {
    expect(snippetRecipient('"Ana Lima" <ana@acme.test>, bo@x.test')).toEqual({
      name: "Ana Lima",
      email: "ana@acme.test",
    });
    expect(
      snippetRecipient("ana@acme.test", [{ name: "Ana Lima", email: "ANA@acme.test" }]),
    ).toEqual({ name: "Ana Lima", email: "ana@acme.test" });
    expect(snippetRecipient("dana@acme.test")).toEqual({ name: "", email: "dana@acme.test" });
    expect(snippetRecipient("")).toBeNull();
  });

  it("insertSnippet fills the first name from the display name", () => {
    const r = insertSnippet(
      "Hey ;;thx",
      9,
      { id: "s", name: "thanks", body: "thanks {first name}!" },
      {
        recipient: snippetRecipient("ana@acme.test", [
          { name: "Ana Lima", email: "ana@acme.test" },
        ]),
        me,
      },
    );
    expect(r?.text).toBe("Hey thanks Ana!");
  });

  it("first name from display name; unknown key line", () => {
    const snippets = [
      { id: "1", name: "thanks", body: "Thanks {first name}, talk soon." },
      { id: "2", name: "intro", body: "Hi {first name}, meet {my first name}." },
    ];
    const ctx = { recipient: snippetRecipient('"Ana Lima" <a.lima@acme.test>'), me };
    // The popup's preview and the inserted text read the display name, not the address.
    expect(snippetPreview(snippets[0]!, ctx)).toBe("Thanks Ana, talk soon.");
    expect(insertSnippet("Hey ;;tha", 9, snippets[0]!, ctx)?.text).toBe(
      "Hey Thanks Ana, talk soon.",
    );
    // Typing filters by key.
    expect(matchSnippets(snippets, "in").map((s) => s.name)).toEqual(["intro"]);
    expect(matchSnippets(snippets, "zzz")).toEqual([]);
    expect(snippetMissLine("zzz")).toBe(
      "No snippet called ;;zzz. Make one in Settings → Mail → Snippets.",
    );
  });
});
