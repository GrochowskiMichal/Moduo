// The mail rail (spec §Layout): Unified folders, the views, then each account
// with its hue, unread count, status and collapsed folder tree, a backfill
// progress line with Cancel, and Connect account at the bottom.

import { AlertCircle, ChevronRight, Plus } from "lucide-react";
import { memo, useState } from "react";

import type { LabelColor } from "@/components/tag-colors";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { mailViewKey } from "@/lib/runtime.types";
import type {
  MailAccount,
  MailCounts,
  MailMailbox,
  MailView,
} from "@/lib/runtime.types.mail-engine";
import { cn } from "@/lib/utils";

import type { SavedSearch } from "../search/palette";

export const UNIFIED_FOLDERS = [
  { role: "inbox", label: "Inbox" },
  { role: "sent", label: "Sent" },
  { role: "drafts", label: "Drafts" },
  { role: "archive", label: "Archive" },
  { role: "trash", label: "Trash" },
  { role: "spam", label: "Spam" },
] as const;

export const RAIL_VIEWS: { view: MailView; label: string; screenerOnly?: boolean }[] = [
  { view: { kind: "snoozed" }, label: "Snoozed" },
  { view: { kind: "followups" }, label: "Follow-ups" },
  { view: { kind: "new_senders" }, label: "New senders", screenerOnly: true },
];

type Props = {
  current: MailView;
  counts: MailCounts | null;
  accounts: readonly MailAccount[];
  mailboxes: Readonly<Record<string, readonly MailMailbox[]>>;
  hues: Readonly<Record<string, LabelColor>>;
  outboxCount: number;
  screenerOn: boolean;
  onSelect: (view: MailView) => void;
  onConnect: () => void;
  onCancelBackfill?: (accountId: string) => void;
  /** "Load more history": walk below the synced floor (AC6). */
  onLoadHistory?: (accountId: string) => void;
  /** Saved searches pinned to the rail (MR-13); each opens ⌘K on its query. */
  savedSearches?: readonly SavedSearch[];
  onOpenSearch?: (query: string) => void;
  /** Opens the Subscriptions view (X6, AC29) the page renders in the reader slot. */
  onOpenSubscriptions?: () => void;
  subscriptionsActive?: boolean;
};

const RailItem = memo(function RailItem({
  label,
  count,
  active,
  onClick,
  indent,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  indent?: boolean;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={cn(
        "flex h-(--row-h-sm) w-full items-center gap-2 rounded-md px-2 text-left text-sm",
        indent && "pl-7",
        active ? "bg-state-active text-foreground" : "text-muted-foreground hover:bg-state-hover",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count ? <span className="text-xs tabular-nums">{count}</span> : null}
    </button>
  );
});

export function MailRail({
  current,
  counts,
  accounts,
  mailboxes,
  hues,
  outboxCount,
  screenerOn,
  onSelect,
  onConnect,
  onCancelBackfill,
  onLoadHistory,
  savedSearches = [],
  onOpenSearch,
  onOpenSubscriptions,
  subscriptionsActive = false,
}: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const key = mailViewKey(current);
  const count = (v: MailView) => counts?.byViewKey[mailViewKey(v)] ?? 0;

  return (
    <nav
      aria-label="Mail folders"
      className="pane-scroll flex h-full flex-col gap-3 overflow-y-auto p-2"
    >
      <div className="flex flex-col gap-0.5">
        {UNIFIED_FOLDERS.map((f) => {
          const v: MailView = { kind: "unified", role: f.role };
          return (
            <RailItem
              key={f.role}
              label={f.label}
              count={f.role === "inbox" || f.role === "drafts" ? count(v) : undefined}
              active={key === mailViewKey(v)}
              onClick={() => onSelect(v)}
            />
          );
        })}
        {outboxCount > 0 ? (
          <RailItem
            label="Outbox"
            count={outboxCount}
            active={key === "outbox"}
            onClick={() => onSelect({ kind: "outbox" })}
          />
        ) : null}
      </div>
      <div className="flex flex-col gap-0.5">
        {RAIL_VIEWS.filter((r) => !r.screenerOnly || screenerOn).map((r) => (
          <RailItem
            key={r.label}
            label={r.label}
            active={key === mailViewKey(r.view)}
            onClick={() => onSelect(r.view)}
          />
        ))}
        {onOpenSubscriptions ? (
          <RailItem
            label="Subscriptions"
            active={subscriptionsActive}
            onClick={onOpenSubscriptions}
          />
        ) : null}
      </div>
      {savedSearches.length > 0 ? (
        <div className="flex flex-col gap-0.5" aria-label="Saved searches" role="group">
          {savedSearches.map((s) => (
            <RailItem
              key={s.id}
              label={s.name}
              active={false}
              onClick={() => onOpenSearch?.(s.query)}
            />
          ))}
        </div>
      ) : null}
      <div className="flex flex-col gap-0.5">
        {accounts.map((a) => {
          const expanded = open[a.id] ?? false;
          const boxes = mailboxes[a.id] ?? [];
          const unread = boxes.find((b) => b.role === "inbox")?.unread ?? 0;
          const bad = a.syncState === "reconnect" || a.syncState === "error";
          return (
            <div key={a.id} className="flex flex-col gap-0.5">
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() => setOpen((o) => ({ ...o, [a.id]: !expanded }))}
                className="flex h-(--row-h-sm) w-full items-center gap-2 rounded-md px-2 text-left text-sm text-muted-foreground hover:bg-state-hover"
              >
                <ChevronRight
                  className={cn(
                    "size-3.5 shrink-0 transition-transform duration-(--motion-fade)",
                    expanded && "rotate-90",
                  )}
                  aria-hidden
                />
                <span
                  data-label={hues[a.id] ?? "gray"}
                  className="tag-dot size-2 shrink-0 rounded-full"
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate">{a.displayName || a.address}</span>
                {bad ? (
                  <AlertCircle className="size-3.5 text-destructive" aria-label="Needs attention" />
                ) : null}
                {unread ? <span className="text-xs tabular-nums">{unread}</span> : null}
              </button>
              {a.syncState === "backfilling" && a.backfillProgress !== null ? (
                <div className="flex items-center gap-2 pl-7 pr-2 text-xs text-muted-foreground">
                  <span className="shrink-0">
                    Syncing history · {Math.round(a.backfillProgress * 100)}%
                  </span>
                  <Progress
                    value={a.backfillProgress * 100}
                    max={100}
                    label="History sync"
                    className="flex-1"
                  />
                  {onCancelBackfill ? (
                    <Button size="sm" variant="ghost" onClick={() => onCancelBackfill(a.id)}>
                      Cancel
                    </Button>
                  ) : null}
                </div>
              ) : onLoadHistory && a.syncState !== "backfilling" ? (
                <div className="flex pl-5 pr-2">
                  <Button size="sm" variant="ghost" onClick={() => onLoadHistory(a.id)}>
                    Load more history
                  </Button>
                </div>
              ) : null}
              {expanded
                ? boxes.map((b) => {
                    const v: MailView = { kind: "mailbox", mailboxId: b.id };
                    return (
                      <RailItem
                        key={b.id}
                        indent
                        label={b.name}
                        count={b.unread || undefined}
                        active={key === mailViewKey(v)}
                        onClick={() => onSelect(v)}
                      />
                    );
                  })
                : null}
            </div>
          );
        })}
      </div>
      <div className="mt-auto">
        <Button variant="ghost" size="sm" className="w-full justify-start" onClick={onConnect}>
          <Plus className="size-4" aria-hidden />
          Connect account
        </Button>
      </div>
    </nav>
  );
}
