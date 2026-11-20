import { describe, expect, it } from "@rstest/core";

import { suggestContacts } from "./suggest-contact";
import { msg } from "./testing/intel-fixtures";

const me = new Set(["me@own.test"]);
const sent = (n: number, to: string) =>
  Array.from({ length: n }, (_, i) =>
    msg({ id: `${to}${i}`, threadId: "t", from: "me@own.test", to: [to] }),
  );

describe("suggestContacts (AC30, X23)", () => {
  it("appears only after 3 replies to a non-contact", () => {
    const opts = { ownAddresses: me, contacts: new Set<string>() };
    expect(suggestContacts(sent(2, "ann@x.test"), opts)).toEqual([]);
    expect(suggestContacts(sent(3, "ann@x.test"), opts).map((s) => [s.email, s.replies])).toEqual([
      ["ann@x.test", 3],
    ]);
  });

  it("skips contacts, dismissed people, yourself and mail you received", () => {
    const all = [
      ...sent(4, "Friend@x.test"),
      ...sent(4, "gone@x.test"),
      ...sent(4, "me@own.test"),
      ...Array.from({ length: 4 }, (_, i) =>
        msg({ id: `in${i}`, threadId: "t", from: "bob@x.test", to: ["me@own.test"] }),
      ),
    ];
    const out = suggestContacts(all, {
      ownAddresses: me,
      contacts: new Set(["friend@x.test"]),
      dismissed: new Set(["gone@x.test"]),
    });
    expect(out).toEqual([]);
  });
});
