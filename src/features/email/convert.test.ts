import { describe, expect, it } from "vitest";

import {
  buildConvertDescription,
  cleanTaskTitle,
  resolveContactIdByAddress,
  spawnedFromLinkArgs,
} from "./convert";

describe("cleanTaskTitle", () => {
  it("strips Re:/Fwd: runs", () => {
    expect(cleanTaskTitle("Re: Fwd: Ship it")).toBe("Ship it");
    expect(cleanTaskTitle("Plain subject")).toBe("Plain subject");
  });
  it("falls back for an empty subject", () => {
    expect(cleanTaskTitle("")).toBe("(no subject)");
    expect(cleanTaskTitle("Re: ")).toBe("(no subject)");
  });
});

describe("buildConvertDescription", () => {
  it("carries the snippet + a back-reference to the email", () => {
    const d = buildConvertDescription({
      snippet: "Can you review the doc?",
      subject: "Re: Doc review",
      refId: "ref-1",
    });
    expect(d).toContain("Can you review the doc?");
    expect(d).toContain("Doc review");
    expect(d).toContain("moduo://email_thread/ref-1");
  });
  it("omits the moduo link when there is no ref id yet", () => {
    const d = buildConvertDescription({ snippet: "", subject: "Hi", refId: null });
    expect(d).toContain("Hi");
    expect(d).not.toContain("moduo://");
  });
});

describe("resolveContactIdByAddress", () => {
  const contacts = [
    { id: "c1", emails: ["boss@corp.com", "b.oss@corp.com"] },
    { id: "c2", emails: ["client@acme.io"] },
  ];
  it("matches on any of a contact's addresses, case-insensitively", () => {
    expect(resolveContactIdByAddress("BOSS@corp.com", contacts)).toBe("c1");
    expect(resolveContactIdByAddress("b.oss@corp.com", contacts)).toBe("c1");
    expect(resolveContactIdByAddress("client@acme.io", contacts)).toBe("c2");
  });
  it("returns null for an unknown or empty address (never auto-creates)", () => {
    expect(resolveContactIdByAddress("stranger@nowhere.com", contacts)).toBeNull();
    expect(resolveContactIdByAddress("", contacts)).toBeNull();
    expect(resolveContactIdByAddress(null, contacts)).toBeNull();
  });
});

describe("spawnedFromLinkArgs", () => {
  it("links task → email_thread as spawned-from", () => {
    const args = spawnedFromLinkArgs({
      taskId: "t1",
      taskTitle: "Ship it",
      refId: "ref-1",
      subject: "Ship it",
    });
    expect(args.source).toEqual({ type: "task", id: "t1" });
    expect(args.target).toEqual({ type: "email_thread", id: "ref-1" });
    expect(args.relationKind).toBe("spawned-from");
  });
});
