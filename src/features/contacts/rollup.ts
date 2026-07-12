// Contacts auto-rollup — the hub's derived read (block CO-2, AC2: "the great
// moment"). A contact's page is a READ over the spine, never stored: its history
// is `entity_links` grouped by section (reusing the spine `rollupSections`), and
// its `LastTouchLine` is derived from `module_activity` + the link timestamps.
// There is no "log activity" anywhere — the record is current by construction.
//
// Pure + runtime-free so it unit-tests in rollup.test.ts. The live reads (links,
// registry records, activity, open-task statuses) live in the useContactHub hook;
// this reducer just folds them. Open-items needs each linked task's *status*,
// which the registry doesn't carry — so the hook passes the set of still-open
// linked task/payment keys, keeping this reducer a pure count.

import type { EntityLink, EntityRecord, EntityRef } from "../../lib/entity-links";
import type { ActivityEntry } from "../tasks/model";
import { entityRefKey, otherEndpoint, rollupSections, type HubSection } from "../spine/rollup";
import type { HubSnippetMeta } from "../spine/snippet-projectors";

export type ContactRollupInput = {
  focus: EntityRef;
  /** Live links touching the contact (newest-first), from one indexed read. */
  links: EntityLink[];
  /** Registry projection for the other endpoints, keyed by `type:id`. */
  records: Map<string, EntityRecord>;
  /** The contact's own activity trail (module_activity for this entity). */
  activity: ActivityEntry[];
  /** `entityRefKey`s of linked tasks that are still open (status ≠ done/archived). */
  openTaskKeys: Set<string>;
  /** `entityRefKey`s of linked payments that are unpaid (none until Finance ships). */
  unpaidPaymentKeys?: Set<string>;
  /** Live per-entity meta for row snippets (task status/due, note touched-at…). */
  snippetMeta?: Map<string, HubSnippetMeta>;
  /** Reference "now" for relative snippet phrasing (deterministic in tests). */
  now?: Date;
};

export type ContactRollup = {
  /** The history, grouped by relation_kind into the fixed hub sections. */
  sections: HubSection[];
  /** Most-recent activity/link timestamp (ISO), or null when nothing has happened. */
  lastTouchAt: string | null;
  /** The activity row behind the last touch (for a verb), or null if a bare link. */
  lastTouchActivity: ActivityEntry | null;
  openTaskCount: number;
  unpaidPaymentCount: number;
};

/** A compact verb for the last-touch line, from an intent-op name. */
function shortVerb(op: string): string {
  switch (op) {
    case "contacts.create":
    case "companies.create":
      return "added";
    case "contacts.update":
    case "companies.update":
      return "updated";
    case "contacts.set_status":
      return "set status";
    case "links.create":
    case "contacts.link":
      return "linked";
    case "links.delete":
    case "contacts.unlink":
      return "unlinked";
    case "comments.add":
      return "commented";
    default:
      return "touched";
  }
}

/**
 * Ops that are a *record edit* (someone changed the card), not a real
 * *interaction* (a link/email/task/meeting/comment). Last-touch prefers
 * interactions and only surfaces a record edit when nothing else exists (FX-4 AC7).
 */
const RECORD_EDIT_OPS = new Set([
  "contacts.create",
  "companies.create",
  "contacts.update",
  "companies.update",
  "contacts.set_status",
  "contacts.set_details",
  "contacts.set_favorite",
  "contacts.restore",
]);

/** One instant that counts as a "touch": an activity op, or a bare link. */
type TouchStamp = { at: string; activity: ActivityEntry | null };

/**
 * The most-recent touch across activity rows AND link creations (linking is a
 * touch, and a link made from the *other* side never lands in this entity's own
 * activity). Prefers the most-recent real *interaction* (a link, or any
 * non-record-edit op) over a bare record edit — "updated" only surfaces when
 * nothing else has happened (FX-4 AC7). Shared by the contact + company hubs.
 */
export function computeLastTouch(
  activity: ActivityEntry[],
  linkCreatedAts: string[],
): { lastTouchAt: string | null; lastTouchActivity: ActivityEntry | null } {
  const stamps: TouchStamp[] = [
    ...activity.map((a) => ({ at: a.createdAt, activity: a })),
    ...linkCreatedAts.map((at) => ({ at, activity: null as ActivityEntry | null })),
  ];
  // Lexical compare is correct here: every timestamp is the same Postgres
  // timestamptz serialization (uniform ISO/UTC), so string order == time order.
  stamps.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const interaction = stamps.find((s) => s.activity === null || !RECORD_EDIT_OPS.has(s.activity.op)) ?? null;
  const latest = interaction ?? stamps[0] ?? null;
  return { lastTouchAt: latest?.at ?? null, lastTouchActivity: latest?.activity ?? null };
}

/**
 * The bare last-touch phrase: "Last touch: linked 3 days ago" / "…updated 2 days
 * ago" / "No activity yet". Shared by contact + company hubs (the contact line
 * appends open-items counts on top).
 */
export function lastTouchPhrase(
  lastTouchAt: string | null,
  lastTouchActivity: ActivityEntry | null,
  now: Date,
): string {
  if (!lastTouchAt) return "No activity yet";
  // A bare link (no activity row behind it) reads "linked"; an op carries its verb.
  const verb = lastTouchActivity ? shortVerb(lastTouchActivity.op) : "linked";
  return `Last touch: ${verb} ${timeAgo(lastTouchAt, now)}`;
}

const DAY_MS = 86_400_000;

/** A quiet relative-time phrase ("just now" · "3 days ago" · an ISO date for old). */
export function timeAgo(iso: string, now: Date): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const ms = now.getTime() - then;
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) {
    const m = Math.floor(ms / 60_000);
    return `${m} ${m === 1 ? "minute" : "minutes"} ago`;
  }
  if (ms < DAY_MS) {
    const h = Math.floor(ms / 3_600_000);
    return `${h} ${h === 1 ? "hour" : "hours"} ago`;
  }
  if (ms < 30 * DAY_MS) {
    const d = Math.floor(ms / DAY_MS);
    return `${d} ${d === 1 ? "day" : "days"} ago`;
  }
  return `on ${iso.slice(0, 10)}`;
}

/**
 * Fold the live reads into the contact's derived hub state. Last-touch is the
 * most recent of every activity row AND every link creation (linking is a touch,
 * and a link made from the *other* side never lands in this contact's own
 * activity); open-items count the linked tasks/payments the hook flagged open.
 */
export function buildContactRollup(input: ContactRollupInput): ContactRollup {
  const { focus, links, records, activity, openTaskKeys, snippetMeta, now } = input;
  const unpaidPaymentKeys = input.unpaidPaymentKeys ?? new Set<string>();

  const sections = rollupSections(focus, links, records, { snippetMeta, now });

  const { lastTouchAt, lastTouchActivity } = computeLastTouch(
    activity,
    links.map((l) => l.createdAt),
  );

  let openTaskCount = 0;
  let unpaidPaymentCount = 0;
  for (const link of links) {
    const other = otherEndpoint(focus, link);
    if (!other) continue;
    const key = entityRefKey(other);
    if (other.type === "task" && openTaskKeys.has(key)) openTaskCount += 1;
    if ((other.type === "payment" || other.type === "invoice") && unpaidPaymentKeys.has(key)) {
      unpaidPaymentCount += 1;
    }
  }

  return {
    sections,
    lastTouchAt,
    lastTouchActivity,
    openTaskCount,
    unpaidPaymentCount,
  };
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * The quiet one-liner under the contact header: "Last touch: linked 3 days ago ·
 * 2 open tasks · 1 unpaid". Clauses with a zero count are omitted; a brand-new
 * contact reads "No activity yet" (never an error tone). Always icon-or-text
 * paired in the UI — this is the text half (AC2, AC12: color never the only signal).
 */
export function lastTouchLine(rollup: ContactRollup, now: Date): string {
  const parts: string[] = [lastTouchPhrase(rollup.lastTouchAt, rollup.lastTouchActivity, now)];
  if (rollup.openTaskCount > 0) parts.push(`${plural(rollup.openTaskCount, "open task")}`);
  if (rollup.unpaidPaymentCount > 0) parts.push(`${rollup.unpaidPaymentCount} unpaid`);
  return parts.join(" · ");
}
