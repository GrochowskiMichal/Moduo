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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { mailViewKey } from "@/lib/runtime.types";
import type { MailCounts, MailTab, MailView } from "@/lib/runtime.types.mail-engine";
import { cn } from "@/lib/utils";

import type { ZeroAge } from "../commands/bulk";
import { useRoving } from "../shell/roving";

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
  // One Tab stop, ← → inside (specs/mail-improve.md §6).
  const strip = useRef<HTMLDivElement>(null);
  const roving = useRoving(strip, { axis: "horizontal", selector: '[role="tab"]' });
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
          ref={strip}
          role="tablist"
          aria-label="Inbox tabs"
          onKeyDown={roving.onKeyDown}
          onFocus={roving.onFocus}
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
          dot={foldedUnread}
          tabs={fold.hidden.map((i) => ({ def: tabs[i]!, index: i })).filter((t) => !!t.def)}
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

/** "+N"'s name and tooltip (specs/mail-improve.md §5, AC23): "3 more tabs · Notifications
 *  has new mail", or "· 2 have new mail". */
export function moreTabsLabel(hidden: readonly { label: string; unread: number }[]): string {
  const n = hidden.length;
  const fresh = hidden.filter((t) => t.unread > 0);
  const head = `${n} more ${n === 1 ? "tab" : "tabs"}`;
  if (fresh.length === 0) return head;
  return fresh.length === 1
    ? `${head} · ${fresh[0]!.label} has new mail`
    : `${head} · ${fresh.length} have new mail`;
}

/** "+N": only the hidden tabs, with their counts, then "Custom tabs… Settings". */
function MoreTabs({
  ref,
  hiddenCount,
  dot,
  tabs,
  selected,
  unreadOf,
  onSelect,
  onCustomTabs,
}: {
  ref: Ref<HTMLButtonElement>;
  hiddenCount: number;
  dot: boolean;
  /** The folded tabs, with their place among all tabs (the radio value). */
  tabs: readonly { def: MailTabDef; index: number }[];
  selected: number;
  unreadOf: (t: MailTabDef) => number;
  onSelect: (tab: MailTab) => void;
  onCustomTabs?: () => void;
}) {
  const off = hiddenCount === 0;
  const label = moreTabsLabel(tabs.map((t) => ({ label: t.def.label, unread: unreadOf(t.def) })));
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              ref={ref}
              type="button"
              data-slot="mail-tabs-more"
              aria-hidden={off || undefined}
              tabIndex={off ? -1 : undefined}
              aria-label={`+${label}`}
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
        </TooltipTrigger>
        {off ? null : <TooltipContent side="bottom">{label}</TooltipContent>}
      </Tooltip>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup value={String(selected)}>
          {tabs.map(({ def: t, index }) => {
            const n = unreadOf(t);
            return (
              <DropdownMenuRadioItem
                key={`${t.tab.kind}:${t.tab.customTabId ?? ""}`}
                value={String(index)}
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
