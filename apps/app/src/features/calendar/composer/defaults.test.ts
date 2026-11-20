// CALR-9 contract: Meet only with guests; outside guests to Google (AC18).

process.env.TZ = "Europe/Warsaw";

import { describe, expect, it } from "@rstest/core";

import { type ComposerAccount, mainGoogleAccount, planComposer } from "./defaults";
import { type ComposerContext, parseComposer } from "./parse";

const NOW = new Date(2026, 9, 28, 10, 7).getTime();
const PEOPLE = [
  { id: "u-kai", name: "Kai Ito", email: null, member: true },
  { id: "c-priya", name: "Priya Shah", email: "priya@acme.com", member: false },
  { id: "c-lee", name: "Lee Park", email: null, member: false },
];
const GOOGLE: ComposerAccount[] = [
  {
    id: "acc-family",
    provider: "google",
    externalId: "google:robin@gmail.com:family123@group.calendar.google.com",
    label: "Family",
    isDefaultTarget: false,
  },
  {
    id: "acc-main",
    provider: "google",
    externalId: "google:robin@gmail.com:robin@gmail.com",
    label: "robin@gmail.com",
    isDefaultTarget: false,
  },
];
const ICS: ComposerAccount[] = [
  { id: "acc-ics", provider: "ics", externalId: "x", label: "Holidays", isDefaultTarget: false },
];

function parse(text: string, accounts: ComposerAccount[]) {
  const c: ComposerContext = {
    nowMs: NOW,
    base: { dayStartMs: new Date(2026, 9, 28).getTime(), startMinute: 11 * 60 },
    workStartMinute: 9 * 60,
    workEndMinute: 18 * 60,
    busyOn: () => [],
    calendars: [
      { id: "moduo", name: "Your calendar", google: false },
      ...accounts
        .filter((a) => a.provider === "google")
        .map((a) => ({ id: a.id, name: a.label, google: true })),
    ],
    people: PEOPLE,
  };
  return parseComposer(text, c);
}

const plan = (text: string, accounts: ComposerAccount[] = GOOGLE) =>
  planComposer(parse(text, accounts), { accounts });

describe("Meet only with guests; outside guests to Google", () => {
  it("an event with nobody stays on Your calendar, with no link and no invite", () => {
    const p = plan("Deep think");
    expect(p.target).toEqual({ kind: "moduo", calendarId: null });
    expect(p.meet).toBe(false);
    expect(p.invites).toBe(false);
    expect(p.linkLine).toBeNull();
    expect(p.inviteLine).toBeNull();
  });

  it("outside guests go to the main Google calendar, with a Meet link, and Google invites them", () => {
    const p = plan("Intro with Priya");
    expect(p.target).toEqual({ kind: "google", accountId: "acc-main" });
    expect(p.meet).toBe(true);
    expect(p.invites).toBe(true);
    expect(p.attendees).toEqual([{ email: "priya@acme.com", name: "Priya Shah" }]);
    expect(p.linkLine).toBe("Google Meet link, added because there are guests");
    expect(p.inviteLine).toBe("Saves to Google Calendar and invites Priya from there");
  });

  it("meals get no link", () => {
    const p = plan("Lunch with Priya");
    expect(p.target).toEqual({ kind: "google", accountId: "acc-main" });
    expect(p.meet).toBe(false);
    expect(p.linkLine).toBeNull();
    for (const meal of ["dinner", "coffee", "drinks", "brunch", "breakfast"]) {
      expect(plan(`${meal} with Priya`).meet).toBe(false);
    }
  });

  it("a place means in person: no default link", () => {
    expect(plan("Intro with Priya at Charlotte").meet).toBe(false);
  });

  it("without Google, outside guests save on Your calendar without invites, and the box says so", () => {
    const p = plan("Intro with Priya", ICS);
    expect(p.target).toEqual({ kind: "moduo", calendarId: null });
    expect(p.invites).toBe(false);
    expect(p.meet).toBe(false);
    expect(p.attendees).toEqual([{ email: "priya@acme.com", name: "Priya Shah" }]);
    expect(p.inviteLine).toBe("No invite sent: connect Google to invite Priya");
  });

  it("teammates only stay on Your calendar", () => {
    const p = plan("Sync with Kai");
    expect(p.target).toEqual({ kind: "moduo", calendarId: null });
    expect(p.invites).toBe(false);
    expect(p.meet).toBe(false);
  });

  it("an outside guest without an email is named but not invited", () => {
    const p = plan("Intro with Lee");
    expect(p.target).toEqual({ kind: "moduo", calendarId: null });
    expect(p.inviteLine).toBe("No invite sent: there's no email for Lee");
  });

  it("asking for Meet saves to Google so Google can make it; without Google the box says why", () => {
    const p = plan("Demo on meet");
    expect(p.target).toEqual({ kind: "google", accountId: "acc-main" });
    expect(p.meet).toBe(true);
    expect(p.linkLine).toBe("Google Meet link, made when you add it");
    const off = plan("Demo on meet", ICS);
    expect(off.meet).toBe(false);
    expect(off.linkLine).toBe("No Meet link: connect Google to make one");
  });

  it("a Zoom or Teams call is read, and the box says the link isn't made here", () => {
    const p = plan("Demo on zoom with Priya");
    expect(p.meet).toBe(false);
    expect(p.linkLine).toBe("Zoom call: paste its link into the event");
  });

  it("#calendar wins over the routing", () => {
    const p = plan("Intro with Priya #your");
    expect(p.target).toEqual({ kind: "moduo", calendarId: null });
    expect(p.invites).toBe(false);
    expect(p.inviteLine).toBe("No invite sent: Your calendar doesn't send invites");
    const fam = plan("Intro with Priya #family");
    expect(fam.target).toEqual({ kind: "google", accountId: "acc-family" });
    expect(fam.invites).toBe(true);
  });

  it("the 'New events go to' calendar wins when it's a Google one", () => {
    const accounts = GOOGLE.map((a) => ({ ...a, isDefaultTarget: a.id === "acc-family" }));
    expect(mainGoogleAccount(accounts)?.id).toBe("acc-family");
    expect(mainGoogleAccount(GOOGLE)?.id).toBe("acc-main");
    expect(mainGoogleAccount(ICS)).toBeNull();
  });

  it("focus time stays yours: no people, link or invites", () => {
    const p = plan("focus Spec with Priya");
    expect(p.target).toEqual({ kind: "moduo", calendarId: null });
    expect(p.meet).toBe(false);
    expect(p.invites).toBe(false);
  });
});
