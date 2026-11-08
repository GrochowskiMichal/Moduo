"use no memo";
// TanStack Virtual keeps mutable state the React Compiler would cache; this
// file opts out (rows in mail-row.tsx stay compiled).

// The mail list (AC2, AC14, decision 11; specs/mail-v3.md §3): fixed-height
// items virtualized over the whole folder (no cap), more pages loaded near the
// end, the cursor kept in view on every move. Group headers and newsletter
// senders are items of their own, never sticky. Short lists draw in flow.

import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, ChevronRight } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";

import type { LabelColor } from "@/components/tag-colors";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import type { MailThreadRow } from "@/lib/runtime.types.mail-engine";
import { cn } from "@/lib/utils";

import type { MailLinkedKind } from "../commands/spine";
import { MAIL_GROUP_LABELS, type MailListItem } from "../shell/use-thread-window";
import type { SenderGroup } from "../views/newsletter-groups";
import { type MailDensity, MailRow, type MailRowActions, ROW_HEIGHT } from "./mail-row";
import type { MailRowPlace } from "./mail-row-model";

export const MAIL_VIRTUALIZE_FROM = 80;

/** A group header's height; mirrors `--mail-group-h` (1.75rem) in tokens.css. */
export const GROUP_HEADER_HEIGHT = 28;
/** A folded newsletter sender and the "Show {n} more" line. */
const SENDER_HEIGHT: Record<MailDensity, number> = { comfortable: 40, compact: 32 };

export function itemHeight(item: MailListItem, density: MailDensity): number {
  if (item.kind === "header") return GROUP_HEADER_HEIGHT;
  if (item.kind === "row") return ROW_HEIGHT[density];
  return SENDER_HEIGHT[density];
}

/** The thread an item stands for when the cursor is on it. */
const itemThread = (item: MailListItem) =>
  item.kind === "row"
    ? item.row.threadId
    : item.kind === "sender" && !item.open
      ? item.leadId
      : null;

const EMPTY_SET: ReadonlySet<string> = new Set();
const EMPTY_NAMES: Readonly<Record<string, string>> = {};

/** The rows under the PINNED heading (their pin flag says nothing new, §2). */
function pinnedRows(items: readonly MailListItem[]): ReadonlySet<string> {
  const out = new Set<string>();
  let under = false;
  for (const it of items) {
    if (it.kind === "header") under = it.label === MAIL_GROUP_LABELS.pinned;
    else if (under && it.kind === "row") out.add(it.row.threadId);
  }
  return out;
}
const EMPTY_KINDS: Readonly<Record<string, readonly MailLinkedKind[]>> = {};

export type MailGroupActions = {
  toggleSender(email: string): void;
  doneAll(group: SenderGroup): void;
  showMoreAway(): void;
};

type Props = {
  items: readonly MailListItem[];
  cursor: string | null;
  picked: readonly string[];
  hovered: string | null;
  hues: Readonly<Record<string, LabelColor>>;
  /** Account names by id, for the tick's tooltip and the row's name. */
  accountNames?: Readonly<Record<string, string>>;
  /** More than one account: rows carry the account tick. */
  showHue: boolean;
  density: MailDensity;
  previewLines: 1 | 2;
  place?: MailRowPlace;
  self?: ReadonlySet<string>;
  linkedKinds?: Readonly<Record<string, readonly MailLinkedKind[]>>;
  notSent?: ReadonlySet<string>;
  offlineAccounts?: ReadonlySet<string>;
  nowMs: number;
  actions: MailRowActions;
  groupActions?: MailGroupActions;
  onNearEnd?: () => void;
  virtualizeFrom?: number;
};

function GroupHeader({ label }: { label: string }) {
  return (
    <div role="presentation" data-group-header className="flex h-full items-end px-3 pb-1">
      <Eyebrow>{label}</Eyebrow>
    </div>
  );
}

function SenderItem({
  item,
  cursor,
  actions,
}: {
  item: Extract<MailListItem, { kind: "sender" }>;
  cursor: boolean;
  actions?: MailGroupActions;
}) {
  const g = item.group;
  const name = g.name || g.email;
  const Chevron = item.open ? ChevronDown : ChevronRight;
  return (
    <div
      data-sender-group={g.email}
      data-thread-lead={item.open ? undefined : item.leadId}
      className={cn(
        "group relative flex h-full items-center gap-1 rounded-md pr-2",
        cursor ? "bg-state-selected" : "hover:bg-state-hover",
      )}
    >
      <button
        type="button"
        aria-expanded={item.open}
        onClick={() => actions?.toggleSender(g.email)}
        className={cn(
          "flex h-full min-w-0 flex-1 items-center gap-2 px-3 text-left text-sm",
          g.unread > 0 ? "font-semibold text-foreground" : "text-foreground",
        )}
      >
        <span className="truncate">
          {name} · {g.threadIds.length}
        </span>
        <Chevron aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
      </button>
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Done all from ${name}`}
        onClick={() => actions?.doneAll(g)}
      >
        Done all
      </Button>
    </div>
  );
}

export function MailThreadList({
  items,
  cursor,
  picked,
  hovered,
  hues,
  accountNames = EMPTY_NAMES,
  showHue,
  density,
  previewLines,
  place,
  self,
  linkedKinds = EMPTY_KINDS,
  notSent = EMPTY_SET,
  offlineAccounts = EMPTY_SET,
  nowMs,
  actions,
  groupActions,
  onNearEnd,
  virtualizeFrom = MAIL_VIRTUALIZE_FROM,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtual = items.length >= virtualizeFrom;
  const pickedSet = new Set(picked);
  const underPinned = pinnedRows(items);
  const selecting = picked.length > 0;

  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (items[i] ? itemHeight(items[i], density) : ROW_HEIGHT[density]),
    getItemKey: (i) => items[i]?.key ?? i,
    overscan: 10,
    enabled: virtual,
    useFlushSync: false,
  });

  // Keep the cursor in view on every move (AC14).
  useEffect(() => {
    if (!cursor) return;
    const index = items.findIndex((it) => itemThread(it) === cursor);
    if (index < 0) return;
    if (virtual) {
      virtualizer.scrollToIndex(index, { align: "auto" });
      return;
    }
    const el = scrollRef.current?.querySelector<HTMLElement>(
      `[data-thread-id="${CSS.escape(cursor)}"], [data-thread-lead="${CSS.escape(cursor)}"]`,
    );
    el?.scrollIntoView?.({ block: "nearest" });
  }, [cursor, items, virtual, virtualizer]);

  const shown = virtual ? virtualizer.getVirtualItems() : [];
  const lastShown = virtual ? (shown[shown.length - 1]?.index ?? 0) : items.length - 1;
  useEffect(() => {
    if (onNearEnd && items.length > 0 && lastShown >= items.length - 20) onNearEnd();
  }, [lastShown, items.length, onNearEnd]);

  const renderRow = (row: MailThreadRow) => (
    <MailRow
      row={row}
      cursor={row.threadId === cursor}
      picked={pickedSet.has(row.threadId)}
      selecting={selecting}
      showActions={row.threadId === hovered}
      accountHue={showHue ? (hues[row.accountId] ?? "gray") : null}
      accountName={accountNames[row.accountId]}
      inPinnedGroup={underPinned.has(row.threadId)}
      density={density}
      previewLines={previewLines}
      place={place}
      self={self}
      linked={linkedKinds[row.threadId]}
      notSent={notSent.has(row.threadId)}
      offline={row.outboxState ? offlineAccounts.has(row.accountId) : false}
      nowMs={nowMs}
      actions={actions}
    />
  );

  const renderItem = (item: MailListItem): ReactNode => {
    if (item.kind === "row") return renderRow(item.row);
    if (item.kind === "header") return <GroupHeader label={item.label} />;
    if (item.kind === "sender")
      return (
        <SenderItem
          item={item}
          cursor={!item.open && item.leadId === cursor}
          actions={groupActions}
        />
      );
    return (
      <div className="flex h-full items-center px-3">
        <Button size="sm" variant="ghost" onClick={() => groupActions?.showMoreAway()}>
          Show {item.count} more
        </Button>
      </div>
    );
  };

  return (
    <div
      ref={scrollRef}
      role="listbox"
      aria-label="Conversations"
      aria-multiselectable
      onMouseLeave={() => actions.hover(null)}
      className="pane-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-2"
    >
      {virtual ? (
        <div className="relative w-full shrink-0" style={{ height: virtualizer.getTotalSize() }}>
          {shown.map((v) => {
            const item = items[v.index];
            if (!item) return null;
            return (
              <div
                key={v.key}
                className="absolute inset-x-0 top-0"
                style={{ height: itemHeight(item, density), transform: `translateY(${v.start}px)` }}
              >
                {renderItem(item)}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col">
          {items.map((item) => (
            <div key={item.key} style={{ height: itemHeight(item, density) }}>
              {renderItem(item)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
