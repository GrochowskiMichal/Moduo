// The email left rail (EM-4, DESIGN_BRIEF §3): a "Unified" row (total unread)
// selected by default, then one row per connected account — hue dot (CAL-6
// attribution pattern), address, unread count, and a status glyph. A
// `reauth_required` account shows a "Reconnect" affordance; an `error` account
// shows a quiet warning with its lastError as a tooltip. Below the accounts:
// Snoozed + Follow-ups counts (wired for real in EM-6). Bottom: Connect account.
// Presentational — the page lifts `selectedAccountId` and passes it back down.

import { AlertTriangle, Clock3, CornerUpLeft, Inbox, Plus } from "lucide-react";
import type { LabelColor } from "../../../components/tag-colors";
import { Button } from "../../../components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { providerLabel } from "../accounts";
import type { SavedAccount } from "../model/email-types";

/** `null` = the Unified scope; a string = one account's id. */
export type EmailScope = string | null;

/** Which center surface is showing: the inbox, or a tissue destination. */
export type EmailView = "inbox" | "snoozed" | "followups";

type Props = {
  accounts: SavedAccount[];
  /** Account id → bounded hue name (from resolveAccountHues). */
  accountHues: Record<string, LabelColor>;
  /** Total unread across every account (Unified row). */
  unifiedUnread: number;
  /** Per-account unread counts, keyed by account id. */
  unreadByAccount: Record<string, number>;
  selectedAccountId: EmailScope;
  onSelectScope: (scope: EmailScope) => void;
  /** The active center view — the inbox scope rows highlight only in "inbox". */
  activeView: EmailView;
  onSelectView: (view: EmailView) => void;
  snoozedCount: number;
  followUpCount: number;
  /** Opens the connect dialog in fresh mode. */
  onConnect: () => void;
  /** Opens the connect dialog in reconnect mode for a reauth/errored account. */
  onReconnect: (account: SavedAccount) => void;
};

/** A count pill shown at the trailing edge of a rail row. */
function CountPill({ count, muted }: { count: number; muted?: boolean }) {
  if (count <= 0) return null;
  return (
    <span
      className={
        "shrink-0 text-2xs tabular-nums " +
        (muted ? "text-muted-foreground/70" : "text-muted-foreground")
      }
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function EmailRail({
  accounts,
  accountHues,
  unifiedUnread,
  unreadByAccount,
  selectedAccountId,
  onSelectScope,
  activeView,
  onSelectView,
  snoozedCount,
  followUpCount,
  onConnect,
  onReconnect,
}: Props) {
  const rowBase =
    "group flex w-full items-center gap-2 rounded-md px-2 text-left transition-colors";
  const rowIdle = "hover:bg-accent";
  const rowActive = "bg-accent";
  // Inbox scope rows only read as "active" while the inbox itself is showing.
  const inboxView = activeView === "inbox";

  return (
    <div className="scrollbar-thin flex h-full min-h-0 flex-col gap-3 overflow-y-auto">
      {/* Unified — the default scope. */}
      <div className="flex flex-col gap-0.5">
        <button
          type="button"
          aria-current={inboxView && selectedAccountId === null ? "true" : undefined}
          onClick={() => onSelectScope(null)}
          className={`${rowBase} ${inboxView && selectedAccountId === null ? rowActive : rowIdle}`}
          style={{ minHeight: "var(--row-h)" }}
        >
          <Inbox className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />
          <span
            className={
              "min-w-0 flex-1 truncate text-sm " +
              (inboxView && selectedAccountId === null
                ? "font-medium text-foreground"
                : "text-foreground")
            }
          >
            All inboxes
          </span>
          <CountPill count={unifiedUnread} />
        </button>
      </div>

      {/* Per-account rows. */}
      {accounts.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          <div className="px-2 text-2xs font-medium uppercase tracking-wide text-muted-foreground">
            Accounts
          </div>
          {accounts.map((account) => {
            const active = inboxView && selectedAccountId === account.id;
            const label = account.email || providerLabel(account.provider);
            const unread = unreadByAccount[account.id] ?? 0;
            return (
              <button
                key={account.id}
                type="button"
                aria-current={active ? "true" : undefined}
                onClick={() => onSelectScope(account.id)}
                className={`${rowBase} ${active ? rowActive : rowIdle}`}
                style={{ minHeight: "var(--row-h)" }}
                title={`${label} — ${providerLabel(account.provider)}`}
              >
                <span
                  data-label={accountHues[account.id] ?? "gray"}
                  className="tag-dot size-2.5 shrink-0 rounded-full"
                  aria-hidden
                />
                <span
                  className={
                    "min-w-0 flex-1 truncate text-sm " +
                    (active ? "font-medium text-foreground" : "text-foreground")
                  }
                >
                  {label}
                </span>

                {account.status === "reauth_required" ? (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      onReconnect(account);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        onReconnect(account);
                      }
                    }}
                    className="inline-flex shrink-0 items-center gap-1 text-2xs text-warning hover:underline"
                  >
                    <AlertTriangle className="size-icon-xs" aria-hidden />
                    Reconnect
                  </span>
                ) : account.status === "error" ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex shrink-0 items-center gap-1 text-2xs text-warning">
                        <AlertTriangle className="size-icon-xs" aria-hidden />
                        Sync error
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>
                      {account.lastError?.trim() || "Couldn't sync this account."}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <CountPill count={unread} />
                )}
              </button>
            );
          })}
        </div>
      ) : null}

      {/* Destinations — Snoozed + Follow-ups (click to view the tissue refs). */}
      <div className="flex flex-col gap-0.5">
        <button
          type="button"
          aria-current={activeView === "snoozed" ? "true" : undefined}
          onClick={() => onSelectView("snoozed")}
          className={`${rowBase} ${activeView === "snoozed" ? rowActive : rowIdle}`}
          style={{ minHeight: "var(--row-h-sm)" }}
        >
          <Clock3 className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />
          <span
            className={
              "min-w-0 flex-1 truncate text-sm " +
              (activeView === "snoozed" ? "font-medium text-foreground" : "text-foreground")
            }
          >
            Snoozed
          </span>
          <CountPill count={snoozedCount} muted={activeView !== "snoozed"} />
        </button>
        <button
          type="button"
          aria-current={activeView === "followups" ? "true" : undefined}
          onClick={() => onSelectView("followups")}
          className={`${rowBase} ${activeView === "followups" ? rowActive : rowIdle}`}
          style={{ minHeight: "var(--row-h-sm)" }}
        >
          <CornerUpLeft className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />
          <span
            className={
              "min-w-0 flex-1 truncate text-sm " +
              (activeView === "followups" ? "font-medium text-foreground" : "text-foreground")
            }
          >
            Follow-ups
          </span>
          <CountPill count={followUpCount} muted={activeView !== "followups"} />
        </button>
      </div>

      <div className="mt-auto pt-1">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground"
          onClick={onConnect}
        >
          <Plus aria-hidden />
          Connect account
        </Button>
      </div>
    </div>
  );
}
