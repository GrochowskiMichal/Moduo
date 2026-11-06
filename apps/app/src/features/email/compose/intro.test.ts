import { describe, expect, it } from "@rstest/core";

import { detectIntroducer } from "./intro";

const p = (name: string, email: string) => ({ name, email });
const me = "mike@x.test";

describe("detectIntroducer (specs/mail-v3.md §9 Instant intro)", () => {
  it("names the sender who added someone new in Cc", () => {
    const msg = {
      from: p("Priya Shah", "priya@a.test"),
      to: [p("", me)],
      cc: [p("Ana", "ana@b.test")],
    };
    expect(detectIntroducer([msg], [me])).toBe("Priya Shah <priya@a.test>");
  });

  it("two new people still name the sender; your own message is no intro", () => {
    const msg = {
      from: p("Priya", "priya@a.test"),
      to: [p("", me)],
      cc: [p("Ana", "ana@b.test"), p("Bo", "bo@c.test")],
    };
    expect(detectIntroducer([msg], [me])).toBe("Priya <priya@a.test>");
    expect(detectIntroducer([{ ...msg, from: p("Mike", me) }], [me])).toBeNull();
  });

  it("someone already on the thread is not new", () => {
    const first = { from: p("Ana", "ana@b.test"), to: [p("", me)], cc: [] };
    const reply = {
      from: p("Priya", "priya@a.test"),
      to: [p("", me)],
      cc: [p("Ana", "ana@b.test")],
    };
    expect(detectIntroducer([first, reply], [me])).toBeNull();
  });
});
