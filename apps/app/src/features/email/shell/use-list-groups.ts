// The list pane's grouping state (specs/mail-v3.md §3, AC14, AC15): the items
// the virtual list draws (away, pinned, everything else, or newsletters per
// sender), the ids j/k walk, the row-flag facts (spine kinds, your addresses,
// offline accounts) and the group actions. All from rows already loaded: no
// per-row engine reads (the 150 ms paint budget).

import { useMemo, useState } from "react";

import type { MailAccount, MailTab, MailThreadRow } from "@/lib/runtime.types.mail-engine";

import { type MailStore, type MailStoreState } from "../store/mail-store";
import { useMailStore } from "../store/use-mail-store";
import type { SenderGroup } from "../views/newsletter-groups";
import { type LinkedKindsRead, useLinkedKinds } from "./use-linked-kinds";
import { groupWindow, type MailListItem, navigableIds } from "./use-thread-window";

const selLinkedKinds = (s: MailStoreState) => s.linkedKinds;
const selAway = (s: MailStoreState) => s.awayReturned;

export type MailListGroups = {
  items: MailListItem[];
  ids: string[];
  linkedKinds: MailStoreState["linkedKinds"];
  self: ReadonlySet<string>;
  offlineAccounts: ReadonlySet<string>;
  groupActions: {
    toggleSender(email: string): void;
    doneAll(group: SenderGroup): void;
    showMoreAway(): void;
  };
  /** Enter on a folded newsletter sender expands it; false when the cursor isn't on one. */
  expandAt(cursor: string | null): false | undefined;
};

export function useListGroups(args: {
  store: MailStore;
  rows: readonly MailThreadRow[];
  /** The Inbox tab when the list is tabbed, else null. */
  tab: MailTab | null;
  accounts: readonly MailAccount[];
  linkedKindsFor?: LinkedKindsRead;
  done(threadIds: string[]): void;
}): MailListGroups {
  const { store, rows, tab, accounts, done } = args;
  const awayReturned = useMailStore(selAway, store);
  const [openSenders, setOpenSenders] = useState<ReadonlySet<string>>(() => new Set());
  const [awayShowAll, setAwayShowAll] = useState(false);
  const kind = tab?.kind ?? null;
  const items = useMemo(
    () =>
      groupWindow(rows, {
        awayReturned,
        personal: kind === "personal",
        newsletters: kind === "newsletters",
        openSenders,
        awayShowAll,
      }),
    [rows, awayReturned, kind, openSenders, awayShowAll],
  );
  const ids = useMemo(() => navigableIds(items), [items]);
  const windowIds = useMemo(() => rows.map((r) => r.threadId), [rows]);
  useLinkedKinds(store, args.linkedKindsFor, windowIds);
  const linkedKinds = useMailStore(selLinkedKinds, store);
  const self = useMemo(
    () => new Set(accounts.map((a) => a.address.trim().toLowerCase())),
    [accounts],
  );
  const offlineAccounts = useMemo(
    () => new Set(accounts.filter((a) => a.syncState === "offline").map((a) => a.id)),
    [accounts],
  );
  const groupActions = useMemo(
    () => ({
      toggleSender: (email: string) =>
        setOpenSenders((open) => {
          const next = new Set(open);
          if (!next.delete(email)) next.add(email);
          return next;
        }),
      doneAll: (group: SenderGroup) => done(group.threadIds),
      showMoreAway: () => setAwayShowAll(true),
    }),
    [done],
  );
  const expandAt = (cursor: string | null) => {
    const folded = items.find((it) => it.kind === "sender" && !it.open && it.leadId === cursor);
    if (folded?.kind !== "sender") return false;
    groupActions.toggleSender(folded.group.email);
    return undefined;
  };
  return { items, ids, linkedKinds, self, offlineAccounts, groupActions, expandAt };
}
