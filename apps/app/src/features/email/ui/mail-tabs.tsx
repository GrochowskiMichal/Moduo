// Split-inbox tabs (specs/mail-v3.md §2, A2): Personal · up to three custom
// tabs · Notifications · Newsletters, each with its unread count (the counts
// follow the rail's account scope). Tabs that don't fit fold from the right
// into "+N"; the selected tab and Personal never fold. `[` and `]` cycle every
// tab, folded ones included; the ⋯ menu holds "Get me to zero in {Tab}".

import { MoreHorizontal } from "lucide-react";
import { type Ref, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import { mailViewKey } from "@/lib/runtime.types";
import type { MailCounts, MailTab, MailView } from "@/lib/runtime.types.mail-engine";
import { cn } from "@/lib/utils";

import type { ZeroAge } from "../commands/bulk";

export type MailTabDef = { tab: MailTab; label: string };

export function mailTabs(custom: readonly { id: string; label: string }[] = []): MailTabDef[] {
  return [
    { tab: { kind: "personal" }, label: "Personal" },
    ...custom
      .slice(0, 3)
      .map((c) => ({ tab: { kind: "custom" as const, customTabId: c.id }, label: c.label })),
    { tab: { kind: "notifications" }, label: "Notifications" },
    { tab: { kind: "newsletters" }, label: "Newsletters" },
  ];
}

export const sameTab = (a: MailTab, b: MailTab) =>
  a.kind === b.kind && (a.customTabId ?? null) === (b.customTabId ?? null);

const PERSONAL: MailTab = { kind: "personal" };

/** The picked tab while it still exists, else Personal (a deleted custom tab). */
export function liveTab(tabs: readonly MailTabDef[], picked: MailTab): MailTab {
  return tabs.some((t) => sameTab(t.tab, picked)) ? picked : PERSONAL;
}

/** `[` / `]`: the tab `delta` steps away, wrapping. */
export function cycleTab(tabs: readonly MailTabDef[], current: MailTab, delta: number): MailTab {
  const i = tabs.findIndex((t) => sameTab(t.tab, current));
  const n = tabs.length;
  return tabs[((((i < 0 ? 0 : i) + delta) % n) + n) % n]!.tab;
}

/**
 * Which tabs fold into "+N": none when every tab fits; otherwise tabs hide from
 * the right (never the first, Personal, and never the selected one) until the
 * rest fit beside the "+N" button. Indices ascending.
 */
export function foldTabs(
  widths: readonly number[],
  available: number,
  selected: number,
  moreWidth: number,
  gap = 0,
): number[] {
  const total = widths.reduce((a, w) => a + w, 0) + gap * Math.max(0, widths.length - 1);
  if (total <= available + 1) return [];
  const room = available - moreWidth - gap;
  const hidden: number[] = [];
  let used = total;
  for (let i = widths.length - 1; i > 0 && used > room + 1; i--) {
    if (i === selected) continue;
    hidden.unshift(i);
    used -= widths[i]! + gap;
  }
  return hidden;
}

const sameList = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Measures after every render, once fonts load and on resize. Folded tabs stay
 * laid out (invisible, out of flow), so their widths are always measurable and
 * the answer never depends on the previous fold.
 */
function useTabFold(selected: number) {
  const wrap = useRef<HTMLDivElement | null>(null);
  const more = useRef<HTMLButtonElement | null>(null);
  const tabEls = useRef<(HTMLButtonElement | null)[]>([]);
  const [hidden, setHidden] = useState<number[]>([]);
  const [, remeasure] = useReducer((n: number) => n + 1, 0);

  useLayoutEffect(() => {
    const box = wrap.current;
    if (!box) return;
    const list = box.firstElementChild as HTMLElement | null;
    const gap = list ? parseFloat(getComputedStyle(list).columnGap) || 0 : 0;
    const widths = tabEls.current.map((el) => el?.offsetWidth ?? 0);
    const next = foldTabs(widths, box.clientWidth, selected, more.current?.offsetWidth ?? 0, gap);
    setHidden((prev) => (sameList(prev, next) ? prev : next));
  });

  useEffect(() => {
    let gone = false;
    void document.fonts?.ready.then(() => !gone && remeasure());
    const box = wrap.current;
    const observer =
      box && typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => remeasure()) : null;
    if (box) observer?.observe(box);
    return () => {
      gone = true;
      observer?.disconnect();
    };
  }, []);

  return { wrap, more, tabEls, hidden };
}

const OUT_OF_FLOW = "invisible absolute pointer-events-none";

export function MailTabs({
  view,
  tabs,
  current,
  counts,
  onSelect,
  onZero,
  onCustomTabs,
  countView = view,
}: {
  view: MailView;
  /** Where the counts are read: the scoped account's inbox while the rail scopes (spec §1). */
  countView?: MailView;
  tabs: readonly MailTabDef[];
  current: MailTab;
  counts: MailCounts | null;
  onSelect: (tab: MailTab) => void;
  onZero: (age: ZeroAge) => void;
  /** "Custom tabs… Settings" in the "+N" menu. */
  onCustomTabs?: () => void;
}) {
  const currentKey = mailViewKey(view, current);
  const selected = Math.max(
    0,
    tabs.findIndex((t) => mailViewKey(view, t.tab) === currentKey),
  );
  const fold = useTabFold(selected);
  const unreadOf = (t: MailTabDef) => counts?.byViewKey[mailViewKey(countView, t.tab)] ?? 0;
  const folded = fold.hidden.map((i) => tabs[i]).filter((t): t is MailTabDef => !!t);
  const foldedUnread = folded.some((t) => unreadOf(t) > 0);
  const currentLabel = tabs[selected]?.label ?? "Personal";

  return (
    <div className="flex items-center gap-1 border-b border-hairline px-2">
      <div
        ref={fold.wrap}
        data-slot="mail-tabs-fit"
        className="flex min-w-0 flex-1 items-center gap-1"
      >
        <div
          role="tablist"
          aria-label="Inbox tabs"
          className="relative flex min-w-0 items-center gap-1"
        >
          {tabs.map((t, i) => {
            const k = mailViewKey(view, t.tab);
            const unread = unreadOf(t);
            const active = k === currentKey;
            const hide = fold.hidden.includes(i);
            return (
              <button
                key={k}
                ref={(el) => {
                  fold.tabEls.current[i] = el;
                }}
                type="button"
                role="tab"
                aria-selected={active}
                aria-hidden={hide || undefined}
                tabIndex={hide ? -1 : undefined}
                onClick={() => onSelect(t.tab)}
                className={cn(
                  "flex h-(--ctrl-h) shrink-0 items-center gap-1.5 border-b-2 px-2 text-sm whitespace-nowrap",
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                  hide && OUT_OF_FLOW,
                )}
              >
                {t.label}
                {unread ? (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {unread}
                    <span className="sr-only"> unread</span>
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <MoreTabs
          ref={fold.more}
          hiddenCount={folded.length}
          names={folded.map((t) => t.label)}
          dot={foldedUnread}
          tabs={tabs}
          selected={selected}
          unreadOf={unreadOf}
          onSelect={onSelect}
          onCustomTabs={onCustomTabs}
        />
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton icon={MoreHorizontal} label="Tab actions" size="sm" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {/* The tab can be a custom one: people's words stay sentence case. */}
          <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
            Get me to zero in {currentLabel}
          </p>
          <DropdownMenuItem onSelect={() => onZero("day")}>
            Done everything older than a day
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onZero("week")}>
            Done everything older than a week
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onZero("month")}>
            Done everything older than a month
          </DropdownMenuItem>
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            Archives everything here · z undoes
          </p>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** "+N": every tab with its count, then "Custom tabs… Settings". */
function MoreTabs({
  ref,
  hiddenCount,
  names,
  dot,
  tabs,
  selected,
  unreadOf,
  onSelect,
  onCustomTabs,
}: {
  ref: Ref<HTMLButtonElement>;
  hiddenCount: number;
  names: string[];
  dot: boolean;
  tabs: readonly MailTabDef[];
  selected: number;
  unreadOf: (t: MailTabDef) => number;
  onSelect: (tab: MailTab) => void;
  onCustomTabs?: () => void;
}) {
  const off = hiddenCount === 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          ref={ref}
          type="button"
          data-slot="mail-tabs-more"
          aria-hidden={off || undefined}
          tabIndex={off ? -1 : undefined}
          aria-label={`${hiddenCount} more tabs: ${names.join(", ")}`}
          className={cn(
            "flex h-(--ctrl-h) shrink-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium tabular-nums text-muted-foreground hover:bg-state-hover hover:text-foreground",
            off && OUT_OF_FLOW,
          )}
        >
          +{hiddenCount}
          {dot ? (
            <span
              data-slot="mail-tabs-more-dot"
              aria-hidden
              className="size-1.5 rounded-full bg-primary"
            />
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={String(selected)}>
          {tabs.map((t, i) => {
            const n = unreadOf(t);
            return (
              <DropdownMenuRadioItem
                key={`${t.tab.kind}:${t.tab.customTabId ?? ""}`}
                value={String(i)}
                onSelect={() => onSelect(t.tab)}
              >
                {t.label}
                {n ? (
                  <DropdownMenuShortcut>
                    {n}
                    <span className="sr-only"> unread</span>
                  </DropdownMenuShortcut>
                ) : null}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onCustomTabs?.()}>
          Custom tabs…
          <DropdownMenuShortcut>Settings</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
