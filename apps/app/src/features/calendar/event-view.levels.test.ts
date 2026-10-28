// The who-sees-it line ranks every grant level the contracts allow (CALR-10
// validator): a calendar shared at "full" is seen in full, never "Only you".

import { describe, expect, it } from "@rstest/core";

import { whoSeesLine } from "./event-view";

const me = "u-me";
const members = [
  { userId: me, name: "Robin Hale" },
  { userId: "u-kai", name: "Kai Ito" },
];

describe("whoSeesLine levels", () => {
  it("counts full like edit", () => {
    expect(whoSeesLine({ workspaceLevel: "full", people: [] }, members, me)).toBe(
      "Everyone here sees it all",
    );
    expect(
      whoSeesLine(
        { workspaceLevel: null, people: [{ userId: "u-kai", level: "full" }] },
        members,
        me,
      ),
    ).toBe("Everyone here sees it all");
  });

  it("treats an unknown level as nothing", () => {
    expect(whoSeesLine({ workspaceLevel: "owner", people: [] }, members, me)).toBe(
      "Only you see it",
    );
  });
});
