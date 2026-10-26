import { expect, test } from "bun:test";

import { formatDuration } from "./duration";

test("whole minutes and seconds", () => {
  expect(formatDuration(0)).toBe("0:00");
  expect(formatDuration(5_000)).toBe("0:05");
  expect(formatDuration(90_000)).toBe("1:30");
  expect(formatDuration(720_000)).toBe("12:00");
});

test("rounds to the nearest second", () => {
  expect(formatDuration(1_400)).toBe("0:01");
  expect(formatDuration(59_600)).toBe("1:00");
});

test("a minute and a half second", () => {
  expect(formatDuration(61_500)).toBe("1:01");
});

test("negative durations", () => {
  expect(formatDuration(-3_000)).toBe("0:00");
});
