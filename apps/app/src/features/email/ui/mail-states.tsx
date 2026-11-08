// Every list state renders deliberately (specs/mail-v3.md §4, AC17): no
// account (a connect card with four providers), first sync (a line and
// skeleton rows, no spinner), an empty place (its own copy and Back to Inbox)
// and a clear tab ("{Tab} is clear", with a button per other tab that has
// unread). The lines above the list live in `system-lines.tsx`.

import {
  Archive,
  CircleCheck,
  Clock,
  CloudOff,
  CornerUpLeft,
  Inbox,
  Mail,
  RefreshCw,
  Send,
  UserPlus,
} from "lucide-react";
import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import type { MailAccount, MailTab, MailView } from "@/lib/runtime.types.mail-engine";
import { cn } from "@/lib/utils";

import type { MailboxProvider } from "../model/email-types";

/** The provider a first-run card picks; the connect dialog opens on it. */
export type MailConnectProvider = MailboxProvider;

/** The places with their own empty copy; everything else names the folder. */
export type MailEmptyPlace =
  "followups" | "snoozed" | "archive" | "new_senders" | "outbox" | "other";

/** Another tab with unread mail, offered from a clear tab ("Notifications · 4"). */
export type MailTabUnread = { tab: MailTab; label: string; unread: number };

export type MailListState =
  | { kind: "no_accounts" }
  | { kind: "first_sync" }
  | { kind: "empty_place"; place: MailEmptyPlace; name: string }
  | { kind: "tab_clear"; tabLabel: string; clearedToday: number; others: MailTabUnread[] }
  | { kind: "rows" };

/** Which empty copy a view gets. */
export function emptyPlace(view: MailView): MailEmptyPlace {
  if (view.kind === "unified") return view.role === "archive" ? "archive" : "other";
  if (view.kind === "mailbox") return "other";
  return view.kind;
}

/** Which state the list pane shows. */
export function mailListState(input: {
  accounts: readonly MailAccount[];
  loading: boolean;
  rowCount: number;
  view: MailView;
  /** On Inbox, with its tabs. */
  isInbox: boolean;
  folderName: string;
  tabLabel?: string;
  clearedToday: number;
  /** The other tabs with unread mail. */
  others?: MailTabUnread[];
}): MailListState {
  if (input.accounts.length === 0) return { kind: "no_accounts" };
  if (input.rowCount > 0) return { kind: "rows" };
  if (input.loading || input.accounts.every((a) => a.syncState === "first_sync"))
    return { kind: "first_sync" };
  if (input.isInbox)
    return {
      kind: "tab_clear",
      tabLabel: input.tabLabel ?? "Personal",
      clearedToday: input.clearedToday,
      others: input.others ?? [],
    };
  return { kind: "empty_place", place: emptyPlace(input.view), name: input.folderName };
}

type Icon = ComponentProps<typeof EmptyState>["icon"];

/** Per-place empty copy (the prototype's `emptyCopy`). */
export function emptyCopy(
  place: MailEmptyPlace,
  name: string,
): { icon: Icon; title: string; body?: string } {
  switch (place) {
    case "followups":
      return {
        icon: CornerUpLeft,
        title: "No follow-ups",
        body: "Set “Remind me if no reply” when you send, or press w on a sent thread.",
      };
    case "snoozed":
      return {
        icon: Clock,
        title: "Nothing snoozed",
        body: "s hides a thread until you want it back.",
      };
    case "archive":
      return {
        icon: Archive,
        title: "Nothing in Archive",
        body: "e marks a thread done and files it here. A reply brings it back.",
      };
    case "new_senders":
      return {
        icon: UserPlus,
        title: "No new senders",
        body: "First-time senders wait here while the Screener is on.",
      };
    case "outbox":
      return { icon: Send, title: "Outbox is empty", body: "Messages you send offline wait here." };
    default:
      return { icon: Inbox, title: `Nothing in ${name}` };
  }
}

const PROVIDERS: { id: MailConnectProvider; label: string; note: string }[] = [
  { id: "gmail", label: "Google", note: "Google sign-in" },
  { id: "outlook", label: "Microsoft", note: "Outlook, 365" },
  { id: "icloud", label: "iCloud", note: "App password" },
  { id: "custom", label: "Other (IMAP)", note: "Any server" },
];

/** No account yet: the connect card with the four providers. */
function ConnectCard({ onConnect }: { onConnect?: (provider: MailConnectProvider) => void }) {
  return (
    <div className="grid max-w-sm justify-items-center gap-2 text-center">
      <Mail className="size-icon-lg text-subtle-foreground" aria-hidden />
      <p className="text-sm text-foreground">Connect your mail</p>
      <p className="text-xs text-muted-foreground">
        Mail stays on this Mac. Pick your provider to start; the newest mail is readable in about
        ten seconds and older mail fills in behind it.
      </p>
      <div
        role="group"
        aria-label="Choose a provider"
        className="mt-1 grid w-full grid-cols-2 gap-2"
      >
        {PROVIDERS.map((p) => (
          <Button
            key={p.id}
            variant="outline"
            size="sm"
            aria-label={p.label}
            className="h-auto flex-col items-start gap-0 py-2"
            onClick={() => onConnect?.(p.id)}
          >
            <span className="text-sm">{p.label}</span>
            <span className="text-2xs font-normal text-muted-foreground">{p.note}</span>
          </Button>
        ))}
      </div>
    </div>
  );
}

const SKELETON_WIDTHS = [
  ["w-1/3", "w-2/3", "w-5/6"],
  ["w-1/2", "w-3/4", "w-full"],
  ["w-2/5", "w-3/5", "w-11/12"],
];

/** First sync: one line, then skeleton rows (no centred spinner). */
export function MailFirstSync() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p
        role="status"
        className="flex items-center gap-2 px-3 pt-3 pb-1 text-xs text-muted-foreground"
      >
        <RefreshCw className="size-3.5 shrink-0" aria-hidden />
        Getting your newest mail. History follows in the background.
      </p>
      <div data-slot="mail-skeleton" aria-hidden className="flex flex-col">
        {Array.from({ length: 7 }, (_, i) => {
          const w = SKELETON_WIDTHS[i % SKELETON_WIDTHS.length]!;
          return (
            <div key={i} data-slot="mail-skeleton-row" className="flex gap-2.5 px-3 py-2.5">
              <Skeleton className="size-8 shrink-0 rounded-full" />
              <div className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5">
                {w.map((c) => (
                  <Skeleton key={c} className={cn("h-2.5", c)} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function MailListStateView({
  state,
  onConnect,
  onBackToInbox,
}: {
  state: Exclude<MailListState, { kind: "rows" } | { kind: "first_sync" }>;
  onConnect?: (provider: MailConnectProvider) => void;
  /** Unused since the next tabs moved to the reader (`MailNextTabs`); kept for callers. */
  onTab?: (tab: MailTab) => void;
  onBackToInbox?: () => void;
}) {
  switch (state.kind) {
    case "no_accounts":
      return <ConnectCard onConnect={onConnect} />;
    case "tab_clear":
      return (
        <EmptyState
          icon={CircleCheck}
          title={`${state.tabLabel} is clear`}
          description={
            state.clearedToday > 0
              ? `You cleared ${state.clearedToday} today.`
              : "Nothing waiting on you here."
          }
        />
      );
    case "empty_place": {
      const copy = emptyCopy(state.place, state.name);
      return (
        <EmptyState
          icon={copy.icon}
          title={copy.title}
          description={copy.body}
          action={
            <Button variant="ghost" size="sm" aria-keyshortcuts="g i" onClick={onBackToInbox}>
              Back to Inbox
              <span aria-hidden>
                <Kbd>gi</Kbd>
              </span>
            </Button>
          }
        />
      );
    }
  }
}

/** The `g` chord each tab answers to (specs/mail-improve.md §6). */
const TAB_CHORD: Record<MailTab["kind"], string> = {
  personal: "g p",
  custom: "g v",
  notifications: "g n",
  newsletters: "g l",
};

/** Inbox zero in the reader (specs/mail-improve.md §5, AC22): a small "Next" and the tabs
 *  still waiting, with their counts and `g` keys. No second heading; nothing waiting,
 *  nothing at all. */
export function MailNextTabs({
  others,
  onTab,
}: {
  others: readonly MailTabUnread[];
  onTab: (tab: MailTab) => void;
}) {
  if (others.length === 0) return null;
  return (
    <div
      data-slot="mail-next-tabs"
      className="motion-key flex flex-1 flex-col items-center justify-center gap-2 p-4"
    >
      <p className="text-xs text-muted-foreground">Next</p>
      <div className="flex flex-wrap justify-center gap-2">
        {others.map((o) => {
          const chord = TAB_CHORD[o.tab.kind];
          return (
            <Button
              key={`${o.tab.kind}:${o.tab.customTabId ?? ""}`}
              variant="secondary"
              size="sm"
              aria-keyshortcuts={chord}
              onClick={() => onTab(o.tab)}
            >
              {o.label} · {o.unread}
              <span aria-hidden>
                <Kbd>{chord.replace(" ", "")}</Kbd>
              </span>
            </Button>
          );
        })}
      </div>
    </div>
  );
}

/** The reader's "Available when you're back online" (AC40). */
export function MailBodyUnavailable() {
  return <EmptyState icon={CloudOff} size="inline" title="Available when you're back online" />;
}
