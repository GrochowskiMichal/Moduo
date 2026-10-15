// MOD-38 — a sidebar drop writes this person's own order at once; a drop
// into another area that the server refuses takes the order back, unless a
// newer drop has replaced it since.

import { beforeEach, describe, expect, it } from "@rstest/core";

import { currentPreferences, updatePreferences } from "../../lib/preferences";
import { commitProjectDrop } from "./project-order";

const WS = "w1";
const order = () => currentPreferences().tasksSidebar.projectOrder[WS];

/** A move the test settles by hand. */
function pendingMove() {
  let settle: (moved: boolean) => void = () => {};
  const promise = new Promise<boolean>((resolve) => {
    settle = resolve;
  });
  return { move: () => promise, settle };
}

beforeEach(() => {
  const now = currentPreferences().tasksSidebar;
  updatePreferences({ tasksSidebar: { ...now, projectOrder: { [WS]: ["a", "b", "c"] } } });
});

describe("commitProjectDrop (MOD-38)", () => {
  it("a drop inside an area writes the new order and moves nothing", async () => {
    let asked = false;
    const stood = await commitProjectDrop(
      WS,
      { order: ["b", "a", "c"], areaId: null, areaChanged: false },
      async () => {
        asked = true;
        return true;
      },
    );
    expect(stood).toBe(true);
    expect(asked).toBe(false);
    expect(order()).toEqual(["b", "a", "c"]);
  });

  it("a drop into another area shows at once and stays once the move lands", async () => {
    const { move, settle } = pendingMove();
    const done = commitProjectDrop(
      WS,
      { order: ["c", "a", "b"], areaId: "area-1", areaChanged: true },
      move,
    );
    expect(order()).toEqual(["c", "a", "b"]);
    settle(true);
    expect(await done).toBe(true);
    expect(order()).toEqual(["c", "a", "b"]);
  });

  it("a refused move puts the order from before back", async () => {
    const { move, settle } = pendingMove();
    const done = commitProjectDrop(
      WS,
      { order: ["c", "a", "b"], areaId: "area-1", areaChanged: true },
      move,
    );
    settle(false);
    expect(await done).toBe(false);
    expect(order()).toEqual(["a", "b", "c"]);
  });

  it("…and with no order of your own before, none again", async () => {
    const now = currentPreferences().tasksSidebar;
    updatePreferences({ tasksSidebar: { ...now, projectOrder: {} } });
    const stood = await commitProjectDrop(
      WS,
      { order: ["c", "a", "b"], areaId: "area-1", areaChanged: true },
      async () => {
        throw new Error("offline");
      },
    );
    expect(stood).toBe(false);
    expect(order()).toBeUndefined();
  });

  it("a newer drop made while the move was pending is kept", async () => {
    const first = pendingMove();
    const done = commitProjectDrop(
      WS,
      { order: ["c", "a", "b"], areaId: "area-1", areaChanged: true },
      first.move,
    );
    await commitProjectDrop(
      WS,
      { order: ["a", "c", "b"], areaId: null, areaChanged: false },
      async () => true,
    );
    first.settle(false);
    await done;
    expect(order()).toEqual(["a", "c", "b"]);
  });
});
