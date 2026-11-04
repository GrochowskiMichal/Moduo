import { describe, expect, it } from "@rstest/core";

import type { MailEngine, MailUnsubscribeOutcome } from "@/lib/runtime.types.mail-engine";

import {
  engineInviteLoader,
  engineRsvp,
  runEngineUnsubscribe,
  toCardInvite,
  unsubscribeNotice,
} from "./engine-reader";

const info = {
  uid: "u",
  method: "REQUEST" as const,
  summary: "Sync",
  startMs: 1,
  endMs: 2,
  location: null,
  organizer: { name: "Anna", email: "anna@y.test" },
  myStatus: null,
  canRsvp: true,
};

describe("engine reader adapters", () => {
  it("hides RSVP for a non-RSVP-able invite and maps answers", async () => {
    expect(toCardInvite(info).organizer?.email).toBe("anna@y.test");
    expect(toCardInvite({ ...info, canRsvp: false }).organizer).toBeNull();
    const calls: unknown[] = [];
    const engine = {
      getInvite: async (t: string, m: string) => (calls.push(["inv", t, m]), info),
      rsvp: async (t: string, m: string, a: string) => void calls.push(["rsvp", t, m, a]),
    } as unknown as MailEngine;
    expect((await engineInviteLoader(engine, "t1")!("m1"))?.summary).toBe("Sync");
    await engineRsvp(engine, "t1")!("m1", "TENTATIVE");
    expect(calls).toEqual([
      ["inv", "t1", "m1"],
      ["rsvp", "t1", "m1", "maybe"],
    ]);
    expect(engineInviteLoader({} as MailEngine, "t")).toBeUndefined();
    expect(engineRsvp(null, "t")).toBeUndefined();
  });

  it("unsubscribes one-click first, confirms a mailto, opens the web page last", async () => {
    const run = async (
      plan: { kind: string }[],
      answers: MailUnsubscribeOutcome[],
      confirm: boolean,
    ) => {
      const sent: boolean[] = [];
      const opened: string[] = [];
      let asked = 0;
      const engine = {
        unsubscribePlan: async () => plan,
        unsubscribe: async (_t: string, _m: string, o: { allowMailto: boolean }) => {
          sent.push(o.allowMailto);
          return answers.shift()!;
        },
      } as unknown as MailEngine;
      const notice = await runEngineUnsubscribe(engine, "t", "m", {
        confirmMailto: async () => (asked++, confirm),
        openUrl: (u) => opened.push(u),
      });
      return { notice, sent, opened, asked };
    };
    const out = (method: MailUnsubscribeOutcome["method"], fellBack = false) => ({
      method,
      done: method !== "web",
      url: method === "web" ? "https://u.test" : null,
      fellBack,
      error: null,
    });
    let r = await run([{ kind: "oneClick" }, { kind: "mailto" }], [out("one_click")], true);
    expect(r).toMatchObject({ notice: "Unsubscribed.", sent: [false], asked: 0 });
    r = await run([{ kind: "mailto" }, { kind: "web" }], [out("mailto")], true);
    expect(r).toMatchObject({ sent: [true], asked: 1 });
    r = await run([{ kind: "mailto" }, { kind: "web" }], [out("web", true)], false);
    expect(r.opened).toEqual(["https://u.test"]);
    r = await run(
      [{ kind: "oneClick" }, { kind: "mailto" }],
      [out("web", true), out("mailto", true)],
      true,
    );
    expect(r.sent).toEqual([false, true]);
    expect(r.notice).toContain("unsubscribe email was sent");
    expect(unsubscribeNotice(out("web", true))).toContain("didn't work");
  });
});
