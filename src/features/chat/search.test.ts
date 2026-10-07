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
});
