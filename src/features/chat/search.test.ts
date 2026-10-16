import { describe, expect, it } from "@rstest/core";
import { validateChatSearch } from "./search";

const ID = "11111111-1111-4111-8111-111111111111";

describe("validateChatSearch", () => {
  it("keeps well-formed ids", () => {
    expect(validateChatSearch({ c: ID, t: ID, m: ID })).toEqual({ c: ID, t: ID, m: ID });
  });
  it("drops junk and orphaned thread/message ids", () => {
    expect(validateChatSearch({ c: "x", t: ID })).toEqual({});
    expect(validateChatSearch({ t: ID, m: ID })).toEqual({});
  });
  it("keeps Browse channels as a view, with or without a conversation (CV-8b)", () => {
    expect(validateChatSearch({ view: "browse" })).toEqual({ view: "browse" });
    expect(validateChatSearch({ c: ID, view: "browse" })).toEqual({ c: ID, view: "browse" });
    expect(validateChatSearch({ view: "other" })).toEqual({});
  });
  it("keeps Chat's Search with its words and filters (CV-19)", () => {
    expect(
      validateChatSearch({ view: "search", q: "żółw", from: ID, in: ID, file: "1", date: "7d" }),
    ).toEqual({ view: "search", q: "żółw", from: ID, in: ID, file: "1", date: "7d" });
    expect(validateChatSearch({ view: "search", q: "x".repeat(300) }).q).toHaveLength(256);
    expect(
      validateChatSearch({ view: "search", from: "nope", date: "forever", file: "0" }),
    ).toEqual({
      view: "search",
    });
    expect(validateChatSearch({ q: "zolw", from: ID })).toEqual({});
  });

  it("keeps Catch up as a view, with or without a conversation (CV-11)", () => {
    expect(validateChatSearch({ view: "catchup" })).toEqual({ view: "catchup" });
    expect(validateChatSearch({ c: ID, view: "catchup" })).toEqual({ c: ID, view: "catchup" });
  });
});
