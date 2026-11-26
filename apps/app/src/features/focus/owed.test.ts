import { beforeEach, describe, expect, it } from "@rstest/core";

import { forgetOwed, oweEnd, oweGiveBack, paidEnd, paidGiveBack, readOwed } from "./owed";

const back = (key: string) => ({ workspaceId: "w1", taskId: "t1", seconds: 10, key, runId: "r1" });

beforeEach(() => localStorage.clear());

describe("owed Focus writes on the device", () => {
  it("keeps each give-back once, per person, until it's paid", () => {
    oweGiveBack("u1", back("gb-1"));
    oweGiveBack("u1", back("gb-1"));
    oweGiveBack("u1", back("gb-2"));
    expect(readOwed("u1").giveBacks.map((b) => b.key)).toEqual(["gb-1", "gb-2"]);
    expect(readOwed("u2").giveBacks).toEqual([]);
    paidGiveBack("u1", "gb-1");
    expect(readOwed("u1").giveBacks.map((b) => b.key)).toEqual(["gb-2"]);
  });

  it("keeps one end per run, the latest numbers", () => {
    oweEnd("u1", { runId: "r1", state: { focusedSeconds: 60 } });
    oweEnd("u1", { runId: "r1", state: { focusedSeconds: 90 } });
    expect(readOwed("u1").ends).toEqual([{ runId: "r1", state: { focusedSeconds: 90 } }]);
    paidEnd("u1", "r1");
    expect(localStorage.getItem("moduo.focus.owed.u1")).toBeNull();
  });

  it("reads a damaged record as nothing owed, and forgets on request", () => {
    localStorage.setItem("moduo.focus.owed.u1", "{not json");
    expect(readOwed("u1")).toEqual({ giveBacks: [], ends: [] });
    oweGiveBack("u1", back("gb-1"));
    forgetOwed("u1");
    expect(readOwed("u1").giveBacks).toEqual([]);
  });
});
