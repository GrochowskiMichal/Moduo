// TV-D11b: a hard-delete table's delta reads two streams (rows stamped since,
// and tombstones); where the next read starts when one or both were cut.

import { describe, expect, it } from "@rstest/core";

import { deltaCursor } from "./delta-cursor";

const at = (minute: number) => `2026-10-11T10:${String(minute).padStart(2, "0")}:00.000000+00:00`;

describe("deltaCursor (TV-D11b)", () => {
  it("nothing cut: the newest stamp of either stream", () => {
    expect(
      deltaCursor({ stamps: [at(1), at(5)], cut: false }, { stamps: [at(7)], cut: false }),
    ).toBe(at(7));
    expect(deltaCursor({ stamps: [], cut: false }, { stamps: [], cut: false })).toBeNull();
  });

  it("rows cut at 3 while the tombstones run to 9: the next read starts at 3, so 3–9's rows are read", () => {
    expect(
      deltaCursor(
        { stamps: [at(1), at(2), at(3)], cut: true },
        { stamps: [at(4), at(9)], cut: false },
      ),
    ).toBe(at(3));
  });

  it("tombstones cut: their last stamp", () => {
    expect(
      deltaCursor({ stamps: [at(8)], cut: false }, { stamps: [at(2), at(4)], cut: true }),
    ).toBe(at(4));
  });

  it("both cut: the earlier of the two", () => {
    expect(
      deltaCursor({ stamps: [at(1), at(6)], cut: true }, { stamps: [at(2), at(4)], cut: true }),
    ).toBe(at(4));
  });
});
