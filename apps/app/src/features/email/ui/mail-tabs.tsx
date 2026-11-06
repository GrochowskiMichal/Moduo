// Split-inbox tabs (spec §Layout): Personal · custom tabs · Notifications ·
// Newsletters, each with its unread count. `[` and `]` cycle them; the ⋯
// menu holds "Get me to zero".

import { MoreHorizontal } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
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

const sameTab = (a: MailTab, b: MailTab) =>
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

export function MailTabs({
  view,
  tabs,
  current,
  counts,
  onSelect,
  onZero,
}: {
  view: MailView;
  tabs: readonly MailTabDef[];
  current: MailTab;
  counts: MailCounts | null;
  onSelect: (tab: MailTab) => void;
  onZero: (age: ZeroAge) => void;
}) {
  const currentKey = mailViewKey(view, current);
  return (
    <div className="flex items-center gap-1 border-b border-hairline px-2">
      <div
        role="tablist"
        aria-label="Inbox tabs"
        className="flex min-w-0 flex-1 items-center gap-1"
      >
        {tabs.map((t) => {
          const k = mailViewKey(view, t.tab);
          const unread = counts?.byViewKey[k] ?? 0;
          const active = k === currentKey;
          return (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(t.tab)}
              className={cn(
                "flex h-(--ctrl-h) items-center gap-1.5 border-b-2 px-2 text-sm",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              {unread ? (
                <span className="text-xs tabular-nums text-muted-foreground">{unread}</span>
              ) : null}
            </button>
          );
        })}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton icon={MoreHorizontal} label="Tab actions" size="sm" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Get me to zero</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => onZero("day")}>
            Done everything older than a day
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onZero("week")}>
            Done everything older than a week
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onZero("month")}>
            Done everything older than a month
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
