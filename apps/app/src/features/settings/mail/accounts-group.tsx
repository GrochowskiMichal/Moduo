// Settings → Mail → Accounts and Storage (MR-15). Accounts: status,
// Reconnect, Disconnect (deletes this Mac's copy, I69) and history depth
// (I67). Storage per account counts mail and attachments apart (S7 / I70),
// with the disk cap and both Clear buttons. Depth, cap and storage are this
// Mac's (AC36): nothing here syncs.

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  EMAIL_HISTORY_DEPTHS,
  type EmailHistoryDepth,
  historyDepthLabel,
} from "@/features/email/history-depth";
import type { MailStorageStats } from "@/lib/runtime.types.mail-settings";

import { PrefGroup, PrefRow } from "../sections/preferences-section";
import { ChoiceSelect } from "./controls";
import { capChoiceGb, DISK_CAP_CHOICES_GB, storageLine } from "./model";

export type SettingsAccount = {
  id: string;
  address: string;
  /** Human status line: "Up to date", "Syncing…", "Needs you to sign in again". */
  status: string;
  needsReconnect: boolean;
  depth: EmailHistoryDepth;
};

export type AccountActions = {
  reconnect: (accountId: string) => void;
  disconnect: (accountId: string) => void;
  setDepth: (accountId: string, depth: EmailHistoryDepth) => void;
};

export type StorageActions = {
  setCap: (accountId: string, gb: number) => void;
  clearAttachments: (accountId: string) => void;
  clearDownloaded: (accountId: string) => void;
};

const DEPTHS = EMAIL_HISTORY_DEPTHS.map((d) => ({ value: d, label: historyDepthLabel(d) }));
const CAPS = DISK_CAP_CHOICES_GB.map((g) => ({ value: String(g), label: `${g} GB` }));

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

export function AccountsGroup({
  accounts,
  actions,
}: {
  accounts: SettingsAccount[];
  actions: AccountActions;
}) {
  return (
    <PrefGroup label="Accounts" description="History depth is this Mac's; each device keeps its own.">
      {accounts.length === 0 ? (
        <PrefRow title="No mail accounts" description="Connect one from Email.">
          <span />
        </PrefRow>
      ) : null}
      {accounts.map((a) => (
        <PrefRow key={a.id} title={a.address} description={a.status}>
          <div className="flex items-center gap-2">
            <ChoiceSelect
              label={`History depth for ${a.address}`}
              className="w-32"
              value={a.depth}
              choices={DEPTHS}
              onChange={(v) => actions.setDepth(a.id, v as EmailHistoryDepth)}
            />
            {a.needsReconnect ? (
              <Button size="sm" onClick={() => actions.reconnect(a.id)}>
                Reconnect
              </Button>
            ) : null}
            <ConfirmButton
              label="Disconnect"
              confirmLabel="Disconnect and delete this Mac's copy"
              onConfirm={() => actions.disconnect(a.id)}
            />
          </div>
        </PrefRow>
      ))}
    </PrefGroup>
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
