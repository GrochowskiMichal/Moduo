// How quick capture's pills name you (call #27, MOD-137): a sentence says
// "you" ("Waiting on you"), a people list says "Alex Rivera (you)" or "You"
// while you have no name (never "You (you)"), and the reminder reads
// "Reminder at…", never "Remind me".

import { afterEach, describe, expect, it } from "@rstest/core";
import { cleanup, render, screen } from "@testing-library/react";

import { CapturePills, type OpenPill, type PillPerson, type PillValues } from "./capture-pills";

const ME = "u-me";
const SAM = "u-sam";

const values = (patch: Partial<PillValues> = {}): PillValues => ({
  assigneeId: undefined,
  teamId: null,
  dueDay: null,
  scheduledAt: null,
  recurrence: null,
  priority: null,
  estimateMinutes: null,
  remindAt: null,
  tags: [],
  waitingOn: [],
  ...patch,
});

const person = (userId: string, name: string, fullName: string, isMe = false): PillPerson => ({
  userId,
  name,
  fullName,
  avatarUrl: null,
  isMe,
  canTakeTasks: true,
});

function pills(people: PillPerson[], patch: Partial<PillValues> = {}, open: OpenPill = null) {
  return render(
    <CapturePills
      values={values(patch)}
      people={people}
      teams={[]}
      tags={[]}
      me={ME}
      onChange={() => {}}
      open={open}
      onOpenChange={() => {}}
    />,
  );
}

afterEach(cleanup);

describe("capture's pills name you as the app does (call #27)", () => {
  it("a Waiting on chip says you, never your full name", () => {
    pills([person(ME, "Alex Rivera", "Alex Rivera", true), person(SAM, "Sam Ortiz", "Sam Ortiz")], {
      waitingOn: [ME, SAM],
    });
    expect(screen.getByText("Waiting on you")).toBeTruthy();
    expect(screen.getByText("Waiting on Sam Ortiz")).toBeTruthy();
    expect(document.body.textContent).not.toContain("Waiting on Alex Rivera");
  });

  it("the assignee list reads your name with (you), or You while you have none, never You (you)", () => {
    pills(
      [person(ME, "Alex Rivera", "Alex Rivera", true), person(SAM, "Sam Ortiz", "Sam Ortiz")],
      {},
      "assign",
    );
    expect(screen.getByText("Alex Rivera (you)")).toBeTruthy();
    cleanup();
    pills([person(ME, "You", "", true), person(SAM, "Sam Ortiz", "Sam Ortiz")], {}, "assign");
    expect(screen.getAllByText("You").length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toContain("You (you)");
  });

  it("the reminder field reads Reminder at…, never Remind me", () => {
    pills([person(ME, "Alex Rivera", "Alex Rivera", true)], {}, "more");
    expect(document.body.innerHTML).toContain("Reminder at…");
    expect(document.body.innerHTML).not.toContain("Remind me");
  });

  it("a set reminder's chip reads Reminder <when>, as the / menu does", () => {
    pills([person(ME, "Alex Rivera", "Alex Rivera", true)], {
      remindAt: new Date(2030, 0, 8, 9).toISOString(),
    });
    expect(screen.getByText(/^Reminder \S/)).toBeTruthy();
  });
});
