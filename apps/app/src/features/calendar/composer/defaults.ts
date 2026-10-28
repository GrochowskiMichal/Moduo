// What the composer does with what it read (CALR-9, AC18): which calendar the
// event lands on, whether Google makes a Meet link, who Google invites, and
// the lines the box says about it.
//
// - New events go to Your calendar. Outside guests with an email route it to
//   your main Google calendar (the "New events go to" one when that's a Google
//   calendar), so Google sends the invites. Without Google it saves on Your
//   calendar without invites, and the box says so.
// - A Meet link is added by default only when there are guests, it isn't a
//   meal and no place says it's in person; only Google can make one, so it
//   needs the event on Google. Asking for Meet ("on meet") routes there too.
// - Zoom and Teams are read, but their links aren't made here yet.
// - #calendar always wins. Teammates stay on Your calendar (CALR-16 puts them
//   on theirs); focus time is yours alone.

import type { ComposerParse } from "./parse";

export type ComposerAccount = {
  id: string;
  provider: string;
  externalId: string;
  label: string;
  isDefaultTarget: boolean;
};

export type ComposerTarget =
  | { kind: "moduo"; calendarId: string | null }
  | { kind: "google"; accountId: string };

export type ComposerPlan = {
  target: ComposerTarget;
  /** Ask Google for a Meet link. */
  meet: boolean;
  /** Outside guests with an email: Google invites them, or they're kept on the event. */
  attendees: { email: string; name: string }[];
  /** Google sends the invites. */
  invites: boolean;
  linkLine: string | null;
  inviteLine: string | null;
};

const PROVIDER_NAME = { zoom: "Zoom", teams: "Teams", meet: "Google Meet" } as const;

function first(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}

function andList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** The Google calendar "#calendar"-less events with outside guests go to. */
export function mainGoogleAccount(accounts: ComposerAccount[]): ComposerAccount | null {
  const google = accounts.filter((a) => a.provider === "google");
  const chosen = google.find((a) => a.isDefaultTarget);
  if (chosen) return chosen;
  // `google:<email>:<calendar>` — the primary calendar's id is the login's email.
  const primary = google.find((a) => {
    const [, email, calendar] = a.externalId.split(":");
    return calendar === undefined || calendar === "primary" || calendar === email;
  });
  return primary ?? google[0] ?? null;
}

function targetOf(
  p: ComposerParse,
  accounts: ComposerAccount[],
  wantsGoogle: boolean,
): ComposerTarget {
  if (p.calendarId) {
    const account = accounts.find((a) => a.id === p.calendarId && a.provider === "google");
    if (account) return { kind: "google", accountId: account.id };
    return { kind: "moduo", calendarId: p.calendarId === "moduo" ? null : p.calendarId };
  }
  const main = wantsGoogle ? mainGoogleAccount(accounts) : null;
  return main ? { kind: "google", accountId: main.id } : { kind: "moduo", calendarId: null };
}

function inviteLineFor(
  p: ComposerParse,
  target: ComposerTarget,
  invitees: { name: string }[],
  hasGoogle: boolean,
): string | null {
  const outside = p.people.filter((x) => !x.member);
  if (outside.length === 0) return null;
  if (invitees.length === 0) {
    return `No invite sent: there's no email for ${andList(outside.map((x) => first(x.name)))}`;
  }
  const names = andList(invitees.map((x) => first(x.name)));
  if (target.kind === "google") return `Saves to Google Calendar and invites ${names} from there`;
  if (p.calendarId || hasGoogle) return "No invite sent: Your calendar doesn't send invites";
  return `No invite sent: connect Google to invite ${names}`;
}

function linkLineFor(p: ComposerParse, meet: boolean, defaulted: boolean, hasGoogle: boolean) {
  if (p.online === "zoom" || p.online === "teams") {
    return `${PROVIDER_NAME[p.online]} call: paste its link into the event`;
  }
  if (meet) {
    return defaulted
      ? "Google Meet link, added because there are guests"
      : "Google Meet link, made when you add it";
  }
  if (p.online === "meet") {
    return hasGoogle
      ? "No Meet link: Meet links come from a Google calendar"
      : "No Meet link: connect Google to make one";
  }
  return null;
}

export function planComposer(
  p: ComposerParse,
  ctx: { accounts: ComposerAccount[] },
): ComposerPlan {
  if (p.kind === "focus") {
    return {
      target: { kind: "moduo", calendarId: null },
      meet: false,
      attendees: [],
      invites: false,
      linkLine: null,
      inviteLine: null,
    };
  }
  const hasGoogle = mainGoogleAccount(ctx.accounts) !== null;
  const invitees = p.people
    .filter((x) => !x.member && x.email)
    .map((x) => ({ email: x.email as string, name: x.name }));
  const target = targetOf(p, ctx.accounts, invitees.length > 0 || p.online === "meet");
  const onGoogle = target.kind === "google";
  const defaulted =
    p.online === null && p.people.length > 0 && !p.meal && p.place === null && onGoogle;
  const meet = onGoogle && (p.online === "meet" || defaulted);
  return {
    target,
    meet,
    attendees: invitees,
    invites: onGoogle && invitees.length > 0,
    linkLine: linkLineFor(p, meet, defaulted, hasGoogle),
    inviteLine: inviteLineFor(p, target, invitees, hasGoogle),
  };
}
