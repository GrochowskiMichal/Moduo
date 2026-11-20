// What the rail shows beside its rows (specs/mail-v3.md §1): the Sync button's
// tooltip, the smart views' counts and which accounts the first sync lists.

import { useEffect, useState } from "react";

import type {
  MailAccount,
  MailEngine,
  MailThreadRow,
  MailView,
} from "@/lib/runtime.types.mail-engine";

import { emptyMailQuery } from "../search/query";
import { groupBySender } from "../views/newsletter-groups";

/** The smart views' counts; an absent one shows no number. */
export type RailViewCounts = {
  snoozed?: number;
  followups?: number;
  /** Follow-ups that came due: the amber dot beside Follow-ups. */
  followupsDue?: number;
  newSenders?: number;
  subscriptions?: number;
  attachments?: number;
};

/** Each count reads at most this many rows; more shows as "99+". */
export const RAIL_COUNT_READ = 100;

export function railCount(n: number | undefined): string | null {
  if (!n || n <= 0) return null;
  return n >= RAIL_COUNT_READ ? `${RAIL_COUNT_READ - 1}+` : String(n);
}

const SYNCING = new Set<MailAccount["syncState"]>(["syncing", "first_sync"]);

/** "Syncing…" while any account syncs, else "Synced 2 min ago" from the newest round. */
export function syncTooltip(accounts: readonly MailAccount[], nowMs: number): string {
  if (accounts.some((a) => SYNCING.has(a.syncState))) return "Syncing…";
  const last = Math.max(0, ...accounts.map((a) => a.lastSyncedMs ?? 0));
  if (last <= 0) return "Sync now";
  const min = Math.floor(Math.max(0, nowMs - last) / 60_000);
  if (min < 1) return "Synced just now";
  if (min < 60) return `Synced ${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `Synced ${h} h ago`;
  return `Synced ${Math.floor(h / 24)} d ago`;
}

/**
 * The first sync of the whole store: some account is getting its newest mail
 * and none has finished a round yet. The rail then lists only the syncing
 * account(s). `lastSyncedMs === null` means the engine knows it never synced;
 * an engine that doesn't report it (undefined) never hides an account.
 */
export function railAccounts(accounts: readonly MailAccount[]): readonly MailAccount[] {
  const syncing = accounts.filter((a) => a.syncState === "first_sync");
  if (syncing.length === 0) return accounts;
  const allFirst = accounts.every((a) => a.syncState === "first_sync" || a.lastSyncedMs === null);
  return allFirst ? syncing : accounts;
}

const SNOOZED: MailView = { kind: "snoozed" };
const FOLLOWUPS: MailView = { kind: "followups" };
const NEW_SENDERS: MailView = { kind: "new_senders" };
const INBOX: MailView = { kind: "unified", role: "inbox" };

async function rows(engine: MailEngine, view: MailView, tab?: MailThreadRow["tab"]) {
  const page = await engine.listThreads({
    view,
    tab: tab ? { kind: tab } : null,
    limit: RAIL_COUNT_READ,
  });
  return page.rows;
}

async function readCounts(
  engine: MailEngine,
  screenerOn: boolean,
  nowMs: number,
): Promise<RailViewCounts> {
  const [snoozed, followups, newSenders, newsletters, files] = await Promise.all([
    rows(engine, SNOOZED),
    rows(engine, FOLLOWUPS),
    screenerOn ? rows(engine, NEW_SENDERS) : Promise.resolve([]),
    rows(engine, INBOX, "newsletters"),
    engine
      .search({ query: { ...emptyMailQuery(), hasAttachment: true }, limit: RAIL_COUNT_READ })
      .catch(() => [] as MailThreadRow[]),
  ]);
  return {
    snoozed: snoozed.length,
    followups: followups.length,
    followupsDue: followups.filter((r) => r.followUpAtMs != null && r.followUpAtMs <= nowMs).length,
    newSenders: newSenders.length,
    subscriptions: groupBySender(newsletters).length,
    attachments: files.length,
  };
}

/** Re-read shortly after each change so the list paints first. */
const COUNT_DELAY_MS = 60;

/**
 * The smart views' counts, read from the engine's own lists (the counts
 * channel carries unread per mailbox and role only). `dueNow` adds the
 * follow-ups the controller found due at launch.
 */
export function useRailViewCounts(
  engine: MailEngine | null,
  version: number,
  opts: { screenerOn: boolean; nowMs: number; dueNow: number },
): RailViewCounts {
  const [read, setRead] = useState<RailViewCounts>({});
  const { screenerOn, nowMs } = opts;
  useEffect(() => {
    if (!engine) return;
    let gone = false;
    const t = setTimeout(() => {
      void readCounts(engine, screenerOn, nowMs).then(
        (c) => !gone && setRead(c),
        () => {},
      );
    }, COUNT_DELAY_MS);
    return () => {
      gone = true;
      clearTimeout(t);
    };
    // `nowMs` moves every render; the lists only change with `version`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, version, screenerOn]);
  return {
    ...read,
    followupsDue: Math.max(read.followupsDue ?? 0, opts.dueNow),
  };
}
