// The mail rail (specs/mail-v3.md §1): the header with Sync and Settings, New
// message, the places (Outbox only while it holds a message), the smart views
// with their counts, Accounts, Saved searches, and Connect account at the foot.
// specs/mail-improve.md §1, §6: the upper part scrolls above the pinned footer, a
// fade shows at its bottom edge while more is below, and it is one Tab stop with
// arrow keys inside. With no account yet, places and views are dimmed, not hidden.
// Rows take `--mail-rail-row`; at 780 px of height or less it drops to
// `--row-h-sm` and the gaps tighten (tokens.css), so three accounts fit at 700.

import {
  Archive,
  ArrowUpFromLine,
  Clock,
  FileText,
  Hourglass,
  Inbox,
  type LucideIcon,
  MailOpen,
  OctagonAlert,
  Paperclip,
  PenLine,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  Trash2,
  UserPlus,
} from "lucide-react";
import { memo, type ReactNode, useCallback, useLayoutEffect, useRef, useState } from "react";

import type { LabelColor } from "@/components/tag-colors";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { IconButton } from "@/components/ui/icon-button";
import { Kbd } from "@/components/ui/kbd";
import { mailViewKey } from "@/lib/runtime.types";
import type {
  MailAccount,
  MailCounts,
  MailMailbox,
  MailView,
} from "@/lib/runtime.types.mail-engine";
import { cn } from "@/lib/utils";

import type { SavedSearch } from "../search/palette";
import { useRoving } from "../shell/roving";
import { AccountsSection, type AccountsSectionProps, RAIL_ROW } from "./mail-rail-accounts";
import { railCount, type RailViewCounts, syncTooltip } from "./rail-counts";

export const UNIFIED_FOLDERS = [
  { role: "inbox", label: "Inbox" },
  { role: "sent", label: "Sent" },
  { role: "drafts", label: "Drafts" },
  { role: "archive", label: "Archive" },
  { role: "trash", label: "Trash" },
  { role: "spam", label: "Spam" },
] as const;

const FOLDER_ICON: Record<(typeof UNIFIED_FOLDERS)[number]["role"], LucideIcon> = {
  inbox: Inbox,
  sent: Send,
  drafts: FileText,
  archive: Archive,
  trash: Trash2,
  spam: OctagonAlert,
};

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
  /** Opens the Attachments view (AC30) the page renders in the reader slot. */
  onOpenAttachments?: () => void;
  attachmentsActive?: boolean;
  /** The smart views' counts. */
  viewCounts?: RailViewCounts;
  /** Sync now across accounts. */
  onSync?: () => void;
  /** Settings → Mail. */
  onOpenSettings?: () => void;
  /** New message (`c`). */
  onCompose?: () => void;
  /** The store is still loading: Saved searches stay hidden. */
  loading?: boolean;
  /** The account the list is scoped to (a click on its row), else null. */
  scope?: string | null;
  onScope?: (accountId: string) => void;
  nowMs?: number;
};

const RailItem = memo(function RailItem({
  label,
  icon: Icon,
  count,
  countLabel,
  dot,
  active,
  onClick,
  dimmed = false,
}: {
  label: string;
  icon: LucideIcon;
  count?: number;
  /** What a screen reader hears after the number ("unread", "waiting to send"). */
  countLabel?: string;
  /** The amber due dot (Follow-ups). */
  dot?: string;
  active: boolean;
  onClick: () => void;
  /** First run: shown but inert until an account is connected (AC25). */
  dimmed?: boolean;
}) {
  const shown = railCount(count);
  return (
    <button
      type="button"
      aria-current={active && !dimmed ? "page" : undefined}
      aria-disabled={dimmed || undefined}
      title={dimmed ? "Connect an account first" : undefined}
      onClick={dimmed ? undefined : onClick}
      className={cn(
        RAIL_ROW,
        dimmed
          ? "cursor-default text-muted-foreground"
          : active
            ? "bg-state-active text-foreground hover:bg-state-active-hover"
            : "text-muted-foreground hover:bg-state-hover",
      )}
    >
      <Icon className="size-icon-sm shrink-0" aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {dot ? (
        <span
          data-slot="rail-due-dot"
          title={dot}
          className="size-1.5 shrink-0 rounded-full bg-warning"
          aria-hidden
        />
      ) : null}
      {shown ? (
        <span aria-hidden className="text-xs tabular-nums">
          {shown}
        </span>
      ) : null}
      {shown || dot ? (
        <span className="sr-only">
          {[shown && (countLabel ? `${shown} ${countLabel}` : shown), dot]
            .filter(Boolean)
            .map((part) => `, ${part}`)
            .join("")}
        </span>
      ) : null}
    </button>
  );
});

function RailHeader({
  accounts,
  nowMs,
  onSync,
  onOpenSettings,
}: Pick<Props, "accounts" | "onSync" | "onOpenSettings"> & { nowMs: number }) {
  return (
    <div className="flex h-(--mail-rail-row) items-center gap-1 pl-2">
      <h1 className="min-w-0 flex-1 truncate text-md font-semibold text-foreground">Mail</h1>
      {accounts.length > 0 ? (
        <IconButton
          icon={RefreshCw}
          label="Sync now"
          tooltip={syncTooltip(accounts, nowMs)}
          onClick={onSync}
          disabled={!onSync}
        />
      ) : null}
      <IconButton
        icon={Settings}
        label="Mail settings"
        tooltip="Mail settings ⌘,"
        aria-keyshortcuts="Meta+Comma"
        onClick={onOpenSettings}
      />
    </div>
  );
}

/** New message, with its `c` key cap outside the button (it is not part of the name). */
function NewMessage({ onCompose }: { onCompose?: () => void }) {
  return (
    <div className="relative grid">
      <Button
        size="sm"
        className="w-full justify-start pr-8"
        aria-keyshortcuts="c"
        onClick={onCompose}
      >
        <PenLine className="size-icon-sm" aria-hidden />
        New message
      </Button>
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-2 flex items-center"
      >
        <Kbd>c</Kbd>
      </span>
    </div>
  );
}

function drafts(counts: Props["counts"], mailboxes: Props["mailboxes"]): number {
  const total = Object.values(mailboxes)
    .flat()
    .filter((b) => b.role === "drafts")
    .reduce((n, b) => n + b.total, 0);
  return total || (counts?.byViewKey[mailViewKey({ kind: "unified", role: "drafts" })] ?? 0);
}

function Places({
  currentKey,
  counts,
  mailboxes,
  outboxCount,
  onSelect,
  dimmed,
}: Pick<Props, "counts" | "mailboxes" | "outboxCount" | "onSelect"> & {
  currentKey: string;
  dimmed: boolean;
}) {
  const inbox = counts?.byViewKey[mailViewKey({ kind: "unified", role: "inbox" })] ?? 0;
  const draftCount = drafts(counts, mailboxes);
  const row = (f: (typeof UNIFIED_FOLDERS)[number]) => {
    const v: MailView = { kind: "unified", role: f.role };
    return (
      <RailItem
        key={f.role}
        label={f.label}
        icon={FOLDER_ICON[f.role]}
        count={f.role === "inbox" ? inbox : f.role === "drafts" ? draftCount : undefined}
        countLabel={f.role === "inbox" ? "unread" : undefined}
        active={currentKey === mailViewKey(v)}
        onClick={() => onSelect(v)}
        dimmed={dimmed}
      />
    );
  };
  return (
    <div role="group" aria-label="Places" className="flex flex-col gap-0.5">
      {UNIFIED_FOLDERS.slice(0, 3).map(row)}
      {/* Shown while it holds a message; it stays while you're on it (spec edge cases). */}
      {outboxCount > 0 || currentKey === "outbox" ? (
        <RailItem
          label="Outbox"
          icon={ArrowUpFromLine}
          count={outboxCount}
          countLabel="waiting to send"
          active={currentKey === "outbox"}
          onClick={() => onSelect({ kind: "outbox" })}
        />
      ) : null}
      {UNIFIED_FOLDERS.slice(3).map(row)}
    </div>
  );
}

function SmartViews({
  currentKey,
  viewCounts: c = {},
  screenerOn,
  onSelect,
  onOpenSubscriptions,
  subscriptionsActive = false,
  onOpenAttachments,
  attachmentsActive = false,
  dimmed,
}: Pick<
  Props,
  | "viewCounts"
  | "screenerOn"
  | "onSelect"
  | "onOpenSubscriptions"
  | "subscriptionsActive"
  | "onOpenAttachments"
  | "attachmentsActive"
> & { currentKey: string; dimmed: boolean }) {
  const special = subscriptionsActive || attachmentsActive;
  const view = (v: MailView, label: string, icon: LucideIcon, count?: number, dot?: string) => (
    <RailItem
      label={label}
      icon={icon}
      count={count}
      dot={dot}
      active={!special && currentKey === mailViewKey(v)}
      onClick={() => onSelect(v)}
      dimmed={dimmed}
    />
  );
  const due = c.followupsDue ?? 0;
  return (
    <div role="group" aria-label="Views" className="flex flex-col gap-0.5">
      {view({ kind: "snoozed" }, "Snoozed", Clock, c.snoozed)}
      {view(
        { kind: "followups" },
        "Follow-ups",
        Hourglass,
        c.followups,
        due > 0 ? `${due} due` : undefined,
      )}
      {screenerOn ? view({ kind: "new_senders" }, "New senders", UserPlus, c.newSenders) : null}
      {onOpenSubscriptions ? (
        <RailItem
          label="Subscriptions"
          icon={MailOpen}
          count={c.subscriptions}
          active={subscriptionsActive}
          onClick={onOpenSubscriptions}
          dimmed={dimmed}
        />
      ) : null}
      {onOpenAttachments ? (
        <RailItem
          label="Attachments"
          icon={Paperclip}
          count={c.attachments}
          active={attachmentsActive}
          onClick={onOpenAttachments}
          dimmed={dimmed}
        />
      ) : null}
    </div>
  );
}

function SavedSearches({
  savedSearches,
  onOpenSearch,
}: {
  savedSearches: readonly SavedSearch[];
  onOpenSearch?: (query: string) => void;
}) {
  if (savedSearches.length === 0) return null;
  return (
    <section aria-labelledby="mail-rail-saved" className="flex flex-col gap-0.5">
      <Eyebrow as="h2" id="mail-rail-saved" className="px-2 pb-1">
        Saved searches
      </Eyebrow>
      {savedSearches.map((s) => (
        <RailItem
          key={s.id}
          label={s.name}
          icon={Search}
          active={false}
          onClick={() => onOpenSearch?.(s.query)}
        />
      ))}
    </section>
  );
}

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
  onSync,
  onOpenSettings,
  onCompose,
  loading = false,
  scope = null,
  onScope,
  nowMs = Date.now(),
  ...views
}: Props) {
  const currentKey = mailViewKey(current);
  const accountProps: Omit<AccountsSectionProps, "accounts"> = {
    mailboxes,
    hues,
    currentKey,
    scope,
    onScope,
    onSelect,
    onCancelBackfill,
    onLoadHistory,
  };
  const dimmed = accounts.length === 0;
  return (
    <nav aria-label="Mail folders" className="flex h-full min-h-0 flex-col">
      <div className="px-2 pt-2">
        <RailHeader
          accounts={accounts}
          nowMs={nowMs}
          onSync={onSync}
          onOpenSettings={onOpenSettings}
        />
      </div>
      <RailBody>
        {accounts.length > 0 ? <NewMessage onCompose={onCompose} /> : null}
        <Places
          currentKey={currentKey}
          counts={counts}
          mailboxes={mailboxes}
          outboxCount={outboxCount}
          onSelect={onSelect}
          dimmed={dimmed}
        />
        <SmartViews
          currentKey={currentKey}
          screenerOn={screenerOn}
          onSelect={onSelect}
          dimmed={dimmed}
          {...views}
        />
        <AccountsSection accounts={accounts} {...accountProps} />
        {loading ? null : (
          <SavedSearches savedSearches={savedSearches} onOpenSearch={onOpenSearch} />
        )}
      </RailBody>
      <div data-rail-footer className="border-t border-hairline p-2">
        <Button variant="ghost" size="sm" className="w-full justify-start" onClick={onConnect}>
          <Plus className="size-icon-sm" aria-hidden />
          Connect account
        </Button>
      </div>
    </nav>
  );
}

/** The rail's scrolling part: one Tab stop (arrows inside), a fade while more is below. */
function RailBody({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const roving = useRoving(ref, { axis: "vertical" });
  const [fade, setFade] = useState(false);
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setFade(el.scrollTop + el.clientHeight < el.scrollHeight - 1);
  }, []);
  useLayoutEffect(() => {
    measure();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const child of el.children) ro.observe(child);
    return () => ro.disconnect();
  }, [measure]);
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={ref}
        data-rail-body
        data-fade={fade ? "bottom" : undefined}
        onScroll={measure}
        onKeyDown={roving.onKeyDown}
        onFocus={roving.onFocus}
        className="pane-scroll flex min-h-0 flex-1 flex-col gap-(--mail-rail-gap) overflow-y-auto px-2 pb-2"
      >
        {children}
      </div>
      {fade ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-(--mail-rail-row) bg-linear-to-t from-background to-transparent"
        />
      ) : null}
    </div>
  );
}
