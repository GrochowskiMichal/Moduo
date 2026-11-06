import { describe, expect, it } from "@rstest/core";

import { splitEntries } from "./address-list";
import {
  detectIntroducer,
  instantIntro,
  introducerFirstName,
  introducerName,
  undoInstantIntro,
} from "./intro";

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

  it("a name with a comma stays one recipient entry", () => {
    const msg = {
      from: p("Shah, Priya", "priya@a.test"),
      to: [p("", me)],
      cc: [p("Ana", "ana@b.test")],
    };
    const introducer = detectIntroducer([msg], [me])!;
    expect(splitEntries(introducer)).toEqual(["Shah Priya <priya@a.test>"]);
    const undone = undoInstantIntro(
      { to: "Ana <ana@b.test>", cc: "", bcc: "priya@a.test", bodyHtml: "" },
      introducer,
    );
    expect(splitEntries(undone.to)).toEqual(["Shah Priya <priya@a.test>", "Ana <ana@b.test>"]);
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

describe("instant intro (specs/mail-v3.md §9, AC33)", () => {
  it("detects introducer, moves to Bcc, undo", () => {
    const intro = {
      from: p("Priya Shah", "priya@a.test"),
      to: [p("", me)],
      cc: [p("Ana Lima", "ana@b.test")],
    };
    const introducer = detectIntroducer([intro], [me])!;
    expect(introducerName(introducer)).toBe("Priya Shah");
    expect(introducerFirstName(introducer)).toBe("Priya");

    const reply = {
      to: "Priya Shah <priya@a.test>",
      cc: "Ana Lima <ana@b.test>",
      bcc: "",
      bodyHtml: "<p>Hi Ana</p>",
    };
    const moved = instantIntro(reply, introducer);
    expect(moved).toEqual({
      to: "",
      cc: "Ana Lima <ana@b.test>",
      bcc: "priya@a.test",
      bodyHtml: "<p>Thanks Priya (moving you to Bcc).</p><p>Hi Ana</p>",
    });
    // Undo returns her to To and takes the line back out.
    expect(undoInstantIntro(moved, introducer)).toEqual(reply);
  });
});
