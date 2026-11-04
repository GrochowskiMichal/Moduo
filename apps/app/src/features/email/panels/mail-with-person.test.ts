import { describe, expect, it } from "@rstest/core";

import { createFakeMailEngine } from "../testing/fake-engine";
import { generateFixture } from "../testing/fixture";
import { loadMailWithPerson } from "./mail-with-person";

describe("loadMailWithPerson (AC30)", () => {
  it("finds every synced thread the person sent, through the engine search", async () => {
    const fixture = generateFixture({ messages: 2000 });
    const engine = createFakeMailEngine({ fixture });
    // The sender with the most threads across all accounts.
    const counts = new Map<string, Set<string>>();
    for (const m of fixture.messages) {
      const e = m.fromEmail.toLowerCase();
      if (!counts.has(e)) counts.set(e, new Set());
      counts.get(e)!.add(m.threadId);
    }
    const [email, threadIds] = [...counts].sort((a, b) => b[1].size - a[1].size)[0]!;
    expect(threadIds.size).toBeGreaterThan(1);

    const res = await loadMailWithPerson(engine, email.toUpperCase(), { limit: 500 });
    const found = new Set(res.rows.map((r) => r.threadId));
    for (const id of threadIds) expect(found.has(id)).toBe(true);
    const dates = res.rows.map((r) => r.lastDateMs);
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
    // Messages come from the found threads, tagged with their thread.
    expect(res.messages.length).toBeGreaterThan(0);
    for (const m of res.messages) expect(found.has(m.threadId)).toBe(true);
  });

  it("asks the engine for sender and recipient matches across all accounts", async () => {
    const calls: unknown[] = [];
    const row = (threadId: string, lastDateMs: number) =>
      ({
        threadId,
        lastDateMs,
      }) as unknown as import("@/lib/runtime.types.mail-engine").MailThreadRow;
    const res = await loadMailWithPerson(
      {
        async search(input) {
          calls.push(input);
          return input.query.from.length ? [row("a", 1), row("b", 3)] : [row("b", 3), row("c", 2)];
        },
        async getThread() {
          return null;
        },
      },
      "Ann@X.test",
    );
    expect(res.rows.map((r) => r.threadId)).toEqual(["b", "c", "a"]);
    expect(calls).toHaveLength(2);
    expect((calls[0] as { query: { from: string[] } }).query.from).toEqual(["ann@x.test"]);
    expect((calls[1] as { query: { to: string[] } }).query.to).toEqual(["ann@x.test"]);
  });
});
