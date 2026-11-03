// Settings → Mail, prop-driven (MR-15, AC36): every control in the spec's
// §Settings → Mail. `MailSection` connects it to the runtime.

import { MAIL_BLOCK_DESTINATIONS, type MailBlockDestination } from "@contracts/mail";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { MailBehavior } from "@/features/email/engine/behavior";
import type { EmailSettingsItem } from "@/lib/runtime.types.email";
import type { MailStorageStats } from "@/lib/runtime.types.mail-settings";

import { PrefGroup, PrefRow } from "../sections/preferences-section";
import {
  type AccountActions,
  AccountsGroup,
  type SettingsAccount,
  type StorageActions,
  StorageGroup,
} from "./accounts-group";
import { BehaviorGroup } from "./behavior-group";
import { ChoiceSelect } from "./controls";
import { type ItemActions, ItemsGroups } from "./items-groups";

const BLOCK_LABEL: Record<MailBlockDestination, string> = {
  trash: "Trash",
  spam: "Spam",
  archive: "Archive",
  folder: "A folder…",
};
const BLOCK_CHOICES = MAIL_BLOCK_DESTINATIONS.map((d) => ({ value: d, label: BLOCK_LABEL[d] }));

export type MailSettingsViewProps = {
  behavior: MailBehavior;
  onBehavior: (patch: Partial<MailBehavior>) => void;
  items: EmailSettingsItem[];
  itemActions: ItemActions;
  accounts: SettingsAccount[];
  accountActions: AccountActions;
  /** Null on the web: storage, cap and Clear are this Mac's. */
  storage: { stats: MailStorageStats[]; actions: StorageActions } | null;
  /** Null on the web. */
  defaultApp: { isDefault: boolean; make: () => void } | null;
};

export function MailSettingsView(p: MailSettingsViewProps) {
  const { behavior, onBehavior } = p;
  return (
    <div className="flex flex-col gap-8">
      <AccountsGroup accounts={p.accounts} actions={p.accountActions} />
      <ItemsGroups items={p.items} actions={p.itemActions} accounts={p.accounts} />
      <PrefGroup label="Screening">
        <PrefRow title="Screener" description="New senders wait for you to let them in.">
          <Switch
            aria-label="Screener"
            checked={behavior.screener}
            onCheckedChange={(v) => onBehavior({ screener: v })}
          />
        </PrefRow>
        <PrefRow title="Blocked mail goes to">
          <div className="flex items-center gap-2">
            <ChoiceSelect
              label="Blocked mail goes to"
              className="w-32"
              value={behavior.blockDestination}
              choices={BLOCK_CHOICES}
              onChange={(v) => onBehavior({ blockDestination: v as MailBlockDestination })}
            />
            {behavior.blockDestination === "folder" ? (
              <Input
                aria-label="Blocked mail folder"
                className="w-32"
                defaultValue={behavior.blockFolder ?? ""}
                onBlur={(e) => onBehavior({ blockFolder: e.target.value.trim() || null })}
              />
            ) : null}
          </div>
        </PrefRow>
      </PrefGroup>
      <BehaviorGroup behavior={behavior} onChange={onBehavior} />
      {p.storage ? (
        <StorageGroup accounts={p.accounts} stats={p.storage.stats} actions={p.storage.actions} />
      ) : null}
      {p.defaultApp ? (
        <PrefGroup label="Default mail app">
          <PrefRow
            title="Make Moduo the default mail app"
            description={
              p.defaultApp.isDefault
                ? "Moduo opens mailto: links."
                : "mailto: links on this Mac open a Moduo message."
            }
          >
            <Button size="sm" variant="outline" disabled={p.defaultApp.isDefault} onClick={p.defaultApp.make}>
              {p.defaultApp.isDefault ? "Moduo is the default" : "Make default"}
            </Button>
          </PrefRow>
        </PrefGroup>
      ) : null}
    </div>
  );
}
