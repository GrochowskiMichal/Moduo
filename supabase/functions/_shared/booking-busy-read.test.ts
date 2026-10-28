// How booking availability reads the host's events (CALR-14): with `kind`, so
// focus time can be told apart; without it only on a database that has no such
// column; and never as "no busy time" when the read fails.

import { describe, expect, it } from "@rstest/core";

import { HOST_EVENT_COLUMNS, readHostEvents } from "./booking-busy.ts";

type Answer = { data: unknown; error: { code?: string; message: string } | null };

function fake(answers: Answer[]) {
  const asked: string[] = [];
  return {
    asked,
    select: (columns: string) => {
      asked.push(columns);
      return Promise.resolve(answers.shift() ?? { data: [], error: null });
    },
  };
}

const focusRow = { start_time: "2030-03-05T09:00:00Z", end_time: "2030-03-05T11:00:00Z", kind: "focus" };

describe("readHostEvents", () => {
  it("asks for the kind and hands the rows on", async () => {
    const db = fake([{ data: [focusRow], error: null }]);
    expect(await readHostEvents(db.select)).toEqual([focusRow]);
    expect(db.asked).toEqual([`${HOST_EVENT_COLUMNS}, kind`]);
  });

  it("reads again without the kind only when the column doesn't exist", async () => {
    const db = fake([
      { data: null, error: { code: "42703", message: "column calendar_events.kind does not exist" } },
      { data: [{ start_time: "a", end_time: "b" }], error: null },
    ]);
    expect(await readHostEvents(db.select)).toEqual([{ start_time: "a", end_time: "b" }]);
    expect(db.asked).toEqual([`${HOST_EVENT_COLUMNS}, kind`, HOST_EVENT_COLUMNS]);
  });

  it("throws on any other failure instead of offering busy time as free", async () => {
    const db = fake([{ data: null, error: { code: "57014", message: "statement timeout" } }]);
    await expect(readHostEvents(db.select)).rejects.toThrow("host events: statement timeout");
    expect(db.asked).toHaveLength(1);
  });

  it("throws when the read without the kind fails too", async () => {
    const db = fake([
      { data: null, error: { code: "42703", message: "no kind" } },
      { data: null, error: { message: "down" } },
    ]);
    await expect(readHostEvents(db.select)).rejects.toThrow("host events: down");
  });
});
