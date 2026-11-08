// The rail's Accounts section (specs/mail-v3.md §1, A1): each account's hue
// dot, label, unread count and the warning glyph when it needs you. The twist
// shows its folder tree (with "Load more history" inside); the row scopes the
// list and tab counts to that account, and a second click unscopes.

import { AlertTriangle, ChevronRight, Download, Folder } from "lucide-react";
import { useState } from "react";

import type { LabelColor } from "@/components/tag-colors";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Progress } from "@/components/ui/progress";
import { mailViewKey } from "@/lib/runtime.types";
import type { MailAccount, MailMailbox, MailView } from "@/lib/runtime.types.mail-engine";
import { cn } from "@/lib/utils";

import { AccountTick } from "./account-tick";
import { railAccounts } from "./rail-counts";

/** One rail row's box: the short-window media query swaps the height token. */
export const RAIL_ROW =
  "flex h-(--mail-rail-row) w-full items-center gap-2 rounded-md px-2 text-left text-sm";

export type AccountsSectionProps = {
  accounts: readonly MailAccount[];
  mailboxes: Readonly<Record<string, readonly MailMailbox[]>>;
  hues: Readonly<Record<string, LabelColor>>;
  currentKey: string;
  /** The account the list is scoped to, else null. */
  scope: string | null;
  onScope?: (accountId: string) => void;
  onSelect: (view: MailView) => void;
  onCancelBackfill?: (accountId: string) => void;
  /** "Load more history": walk below the synced floor (AC6). */
  onLoadHistory?: (accountId: string) => void;
};

export function AccountsSection({ accounts, ...rest }: AccountsSectionProps) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const shown = railAccounts(accounts);
  return (
    <section aria-labelledby="mail-rail-accounts" className="flex flex-col gap-0.5">
      <Eyebrow as="h2" id="mail-rail-accounts" className="px-2 pb-1">
        Accounts
      </Eyebrow>
      {shown.length === 0 ? (
        <p className="px-2 text-xs text-muted-foreground">None yet.</p>
      ) : (
        shown.map((a) => (
          <AccountRow
            key={a.id}
            account={a}
            expanded={open[a.id] ?? false}
            onToggle={() => setOpen((o) => ({ ...o, [a.id]: !(o[a.id] ?? false) }))}
            multi={shown.length > 1}
            {...rest}
          />
        ))
      )}
    </section>
  );
}

function AccountRow({
  account: a,
  expanded,
  onToggle,
  mailboxes,
  hues,
  currentKey,
  scope,
  onScope,
  onSelect,
  onCancelBackfill,
  onLoadHistory,
  multi,
}: Omit<AccountsSectionProps, "accounts"> & {
  account: MailAccount;
  expanded: boolean;
  onToggle: () => void;
  /** More than one account: the tick marks each (one account needs none). */
  multi: boolean;
}) {
  const boxes = mailboxes[a.id] ?? [];
  const unread = boxes.find((b) => b.role === "inbox")?.unread ?? 0;
  const bad = a.syncState === "reconnect" || a.syncState === "error";
  const label = a.displayName || a.address;
  const scoped = scope === a.id;
  return (
    <div className="flex flex-col gap-0.5">
      <div
        data-account-row={a.id}
        className={cn(
          "flex items-center rounded-md",
          scoped ? "bg-state-active text-foreground" : "text-muted-foreground hover:bg-state-hover",
        )}
      >
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`${expanded ? "Hide" : "Show"} folders for ${label}`}
          onClick={onToggle}
          className="flex size-(--hit-min) shrink-0 items-center justify-center rounded-sm hover:bg-state-hover"
        >
          <ChevronRight
            className={cn(
              "size-3.5 transition-transform duration-(--motion-fast)",
              expanded && "rotate-90",
            )}
            aria-hidden
          />
        </button>
        <button
          type="button"
          aria-pressed={scoped}
          onClick={() => onScope?.(a.id)}
          className={cn(RAIL_ROW, "min-w-0 flex-1 pl-1")}
        >
          {multi ? <AccountTick hue={hues[a.id] ?? "gray"} name={label} /> : null}
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {unread ? (
            <span aria-hidden className="text-xs tabular-nums">
              {unread}
            </span>
          ) : null}
          {unread ? <span className="sr-only">, {unread} unread</span> : null}
          {bad ? (
            <AlertTriangle
              className="size-3.5 shrink-0 text-warning"
              role="img"
              aria-label={
                a.syncState === "reconnect" ? ", needs you to sign in again" : ", couldn't sync"
              }
            />
          ) : null}
        </button>
      </div>
      <BackfillRow account={a} onCancelBackfill={onCancelBackfill} />
      {expanded ? (
        <FolderTree
          account={a}
          label={label}
          boxes={boxes}
          currentKey={currentKey}
          onSelect={onSelect}
          onLoadHistory={onLoadHistory}
        />
      ) : null}
    </div>
  );
}

/** The account's folders, then "Load more history" (spec §1). */
function FolderTree({
  account: a,
  label,
  boxes,
  currentKey,
  onSelect,
  onLoadHistory,
}: Pick<AccountsSectionProps, "currentKey" | "onSelect" | "onLoadHistory"> & {
  account: MailAccount;
  label: string;
  boxes: readonly MailMailbox[];
}) {
  return (
    <div role="group" aria-label={`Folders in ${label}`} className="flex flex-col gap-0.5">
      {boxes.map((b) => {
        const v: MailView = { kind: "mailbox", mailboxId: b.id };
        const active = currentKey === mailViewKey(v);
        return (
          <button
            key={b.id}
            type="button"
            aria-current={active ? "page" : undefined}
            onClick={() => onSelect(v)}
            className={cn(
              RAIL_ROW,
              "pl-7 text-xs",
              active
                ? "bg-state-active text-foreground"
                : "text-muted-foreground hover:bg-state-hover",
            )}
          >
            <Folder className="size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{b.name}</span>
            {b.unread ? <span className="tabular-nums">{b.unread}</span> : null}
          </button>
        );
      })}
      {onLoadHistory && a.syncState !== "backfilling" ? (
        <button
          type="button"
          onClick={() => onLoadHistory(a.id)}
          className={cn(RAIL_ROW, "pl-7 text-xs text-muted-foreground hover:bg-state-hover")}
        >
          <Download className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">Load more history</span>
        </button>
      ) : null}
    </div>
  );
}

/** "Syncing history · 40%" with Cancel, as shipped (MR-14). */
function BackfillRow({
  account: a,
  onCancelBackfill,
}: {
  account: MailAccount;
  onCancelBackfill?: (accountId: string) => void;
}) {
  if (a.syncState !== "backfilling" || a.backfillProgress === null) return null;
  return (
    <div role="status" className="flex items-center gap-2 pl-7 pr-2 text-xs text-muted-foreground">
      <span className="shrink-0">Syncing history · {Math.round(a.backfillProgress * 100)}%</span>
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
  );
}
