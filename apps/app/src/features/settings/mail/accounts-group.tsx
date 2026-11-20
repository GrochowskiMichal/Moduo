// Settings → Mail → Accounts and Storage (MR-15, specs/mail-v3.md §12, A1).
// Accounts: one card each, with its hue dot and label, its state ("Up to
// date" … "Can't sync: {reason}"), push or polling, when it last synced, the
// history depth on this Mac (I67), and Sync now, Sign in again (only when it
// needs it) and Disconnect (deletes this Mac's copy, I69). Storage per account
// counts mail and attachments apart (S7 / I70), with the disk cap and both
// Clear buttons. Depth, cap and storage are this Mac's (AC36): nothing here syncs.

import { RefreshCw } from "lucide-react";
import { useState } from "react";

import { LABEL_COLORS, type LabelColor } from "@/components/tag-colors";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import {
  asHistoryDepth,
  EMAIL_HISTORY_DEPTHS,
  type EmailHistoryDepth,
  historyDepthLabel,
} from "@/features/email/history-depth";
import { relativeTimeAgo } from "@/features/spine/snippet-format";
import type { MailStorageStats } from "@/lib/runtime.types.mail-settings";

import { PrefGroup } from "../sections/preferences-section";
import { ChoiceSelect } from "./controls";
import { capChoiceGb, DISK_CAP_CHOICES_GB, storageLine } from "./model";

export type SettingsAccount = {
  id: string;
  address: string;
  /** The account's name ("Work"), else its address. */
  label: string;
  /** The rail's hue for this account. */
  hue: LabelColor;
  /** The engine's sync state (`idle`, `syncing`, `backfilling`, `offline`, `reconnect`, `error`). */
  state: string;
  /** The state line: "Up to date", "Syncing…", "Getting history · 40%", … */
  status: string;
  /** Only `reconnect` asks you to sign in again. */
  needsReconnect: boolean;
  /** True: pushed; false: checked every minute; null when the engine doesn't say. */
  push: boolean | null;
  lastSyncedMs: number | null;
  depth: EmailHistoryDepth;
};

export type AccountActions = {
  /** Opens the connect dialog in reconnect mode for the account. */
  reconnect: (accountId: string) => void;
  disconnect: (accountId: string) => void;
  setDepth: (accountId: string, depth: EmailHistoryDepth) => void;
  syncNow?: (accountId: string) => void;
};

export type StorageActions = {
  setCap: (accountId: string, gb: number) => void;
  clearAttachments: (accountId: string) => void;
  clearDownloaded: (accountId: string) => void;
};

const DEPTHS = EMAIL_HISTORY_DEPTHS.map((d) => ({ value: d, label: historyDepthLabel(d) }));
const CAPS = DISK_CAP_CHOICES_GB.map((g) => ({ value: String(g), label: `${g} GB` }));

/** An account's state line (§12). */
export function accountStatus(
  state: string,
  progress: number | null,
  reason: string | null,
): string {
  if (state === "reconnect") return "Needs you to sign in again";
  if (state === "error") return `Can't sync: ${reason?.trim() || "the server refused"}`;
  if (state === "offline") return "Offline";
  if (state === "backfilling") {
    return progress === null
      ? "Getting history"
      : `Getting history · ${Math.round(progress * 100)}%`;
  }
  if (state === "idle") return "Up to date";
  return "Syncing…";
}

/** "New mail arrives instantly" (push) or "Checks for new mail every minute". */
export function pushLine(push: boolean | null): string | null {
  if (push === null) return null;
  return push ? "New mail arrives instantly" : "Checks for new mail every minute";
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" ? v : null);

/** An engine (or legacy) account row → its card. `index` picks the rail's hue. */
export function toSettingsAccount(raw: Record<string, unknown>, index = 0): SettingsAccount {
  const reconnect = raw.syncState === "reconnect" || raw.needsReauth === true;
  const state = reconnect ? "reconnect" : String(raw.syncState ?? raw.status ?? "idle");
  const address = String(raw.address ?? raw.email ?? raw.username ?? "");
  return {
    id: String(raw.id ?? raw.accountId ?? ""),
    address,
    label: str(raw.displayName) ?? address,
    hue: LABEL_COLORS[index % LABEL_COLORS.length]!,
    state,
    status: accountStatus(state, num(raw.backfillProgress), str(raw.lastError)),
    needsReconnect: reconnect,
    push: typeof raw.push === "boolean" ? raw.push : null,
    lastSyncedMs: num(raw.lastSyncedMs),
    depth: asHistoryDepth(raw.historyDepth),
  };
}

/** A destructive button that asks once, inline. */
function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
}: {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button variant="outline" size="sm" onClick={() => setAsking(true)}>
        {label}
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="sm" onClick={() => setAsking(false)}>
        Cancel
      </Button>
      <Button
        variant="destructive"
        size="sm"
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </Button>
    </div>
  );
}

function AccountCard({
  account: a,
  actions,
  nowMs,
}: {
  account: SettingsAccount;
  actions: AccountActions;
  nowMs: number;
}) {
  const facts = [
    pushLine(a.push),
    a.lastSyncedMs === null
      ? null
      : `Last synced ${relativeTimeAgo(new Date(a.lastSyncedMs).toISOString(), new Date(nowMs))}`,
  ].filter((f): f is string => f !== null);
  const warn = a.state === "reconnect" || a.state === "error";
  return (
    <article
      aria-label={a.label}
      data-account-card={a.id}
      className="flex flex-col gap-4 rounded-lg border border-border bg-card px-6 py-4"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span data-label={a.hue} className="tag-dot size-2 shrink-0 rounded-full" aria-hidden />
        <span className="truncate text-sm font-medium text-foreground">{a.label}</span>
        {a.label !== a.address ? (
          <span className="truncate text-xs text-muted-foreground">{a.address}</span>
        ) : null}
      </div>
      <div className="flex flex-col gap-0.5">
        <output
          className={warn ? "text-sm text-warning" : "text-sm text-foreground"}
          data-account-state={a.state}
        >
          {a.status}
        </output>
        {facts.length ? (
          <span className="text-xs text-muted-foreground">{facts.join(" · ")}</span>
        ) : null}
      </div>
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm text-foreground">History on this Mac</span>
          <span className="text-xs text-muted-foreground">Each device keeps its own.</span>
        </div>
        <ChoiceSelect
          label={`History depth for ${a.address}`}
          className="w-32"
          value={a.depth}
          choices={DEPTHS}
          onChange={(v) => actions.setDepth(a.id, v as EmailHistoryDepth)}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {actions.syncNow ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={a.state === "offline" || a.needsReconnect}
            onClick={() => actions.syncNow?.(a.id)}
          >
            <RefreshCw aria-hidden />
            Sync now
          </Button>
        ) : null}
        {a.needsReconnect ? (
          <Button size="sm" onClick={() => actions.reconnect(a.id)}>
            Sign in again
          </Button>
        ) : null}
        <span className="flex-1" />
        <ConfirmButton
          label="Disconnect"
          confirmLabel="Disconnect and delete this Mac's copy"
          onConfirm={() => actions.disconnect(a.id)}
        />
      </div>
    </article>
  );
}

export function AccountsGroup({
  accounts,
  actions,
  nowMs,
}: {
  accounts: SettingsAccount[];
  actions: AccountActions;
  nowMs?: number;
}) {
  const [openedAt] = useState(() => Date.now());
  const now = nowMs ?? openedAt;
  return (
    <section aria-label="Accounts" className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5 px-1">
        <Eyebrow>Accounts</Eyebrow>
        <span className="text-xs text-muted-foreground">Mail stays on this Mac.</span>
      </div>
      {accounts.length === 0 ? (
        <div className="rounded-lg border border-border bg-card px-6 py-4">
          <span className="text-sm font-medium text-foreground">No mail accounts</span>
          <p className="text-xs text-muted-foreground">Connect one from Email.</p>
        </div>
      ) : null}
      {accounts.map((a) => (
        <AccountCard key={a.id} account={a} actions={actions} nowMs={now} />
      ))}
    </section>
  );
}

export function StorageGroup({
  accounts,
  stats,
  actions,
}: {
  accounts: SettingsAccount[];
  stats: MailStorageStats[];
  actions: StorageActions;
}) {
  const byId = new Map(stats.map((s) => [s.accountId, s]));
  return (
    <PrefGroup
      label="Storage on this Mac"
      description="Clearing keeps headers and subjects searchable; mail downloads again when you open it."
    >
      {accounts.map((a) => {
        const s = byId.get(a.id);
        if (!s) return null;
        return (
          <div
            key={a.id}
            className="flex flex-col gap-3 border-b border-border py-4 first:pt-2 last:border-b-0 last:pb-2"
          >
            <div className="flex items-center justify-between gap-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-foreground">{a.address}</span>
                <span className="text-xs text-muted-foreground">{storageLine(s)}</span>
              </div>
              <ChoiceSelect
                label={`Disk cap for ${a.address}`}
                className="w-28"
                value={String(capChoiceGb(s.diskCapBytes))}
                choices={CAPS}
                onChange={(v) => actions.setCap(a.id, Number(v))}
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <ConfirmButton
                label="Clear attachments"
                confirmLabel="Clear attachments"
                onConfirm={() => actions.clearAttachments(a.id)}
              />
              <ConfirmButton
                label="Clear all downloaded mail"
                confirmLabel="Clear all downloaded mail"
                onConfirm={() => actions.clearDownloaded(a.id)}
              />
            </div>
          </div>
        );
      })}
    </PrefGroup>
  );
}
