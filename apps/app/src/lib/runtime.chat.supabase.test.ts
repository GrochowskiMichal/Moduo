import { describe, expect, it } from "@rstest/core";

import { q } from "./runtime.chat.supabase";

describe("q, a quoted key in a PostgREST logic tree", () => {
  it("keeps `:` and `.` inside the quotes", () => {
    expect(q("2026-10-19T09:00:00.000Z")).toBe('"2026-10-19T09:00:00.000Z"');
  });

  it("escapes quotes and backslashes, backslashes first", () => {
    expect(q('a"b')).toBe('"a\\"b"');
    // A trailing backslash must not escape the closing quote.
    expect(q("a\\")).toBe('"a\\\\"');
    expect(q('\\"),id.gt.0')).toBe('"\\\\\\"),id.gt.0"');
  });
});
