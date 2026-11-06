// Settings → Mail → Behavior (MR-15): every scalar toggle that follows you
// (synced in `user_preferences.email.behavior`).

import { Switch } from "@/components/ui/switch";
import {
  MAIL_UNDO_SEND_SECONDS,
  type MailBadgeMode,
  type MailBehavior,
  type MailRemoteImages,
  type MailUndoSendSeconds,
} from "@/features/email/engine/behavior";

import { PrefGroup, PrefRow } from "../sections/preferences-section";
import { ChoiceSelect } from "./controls";
import { DENSITY_CHOICES, densityChoice, densityPatch } from "./density";

const BADGE = [
  { value: "personal", label: "Unread Personal" },
  { value: "all", label: "Unread in Inbox" },
  { value: "off", label: "Off" },
] as const;
const IMAGES = [
  { value: "block", label: "Block" },
  { value: "contacts", label: "Contacts only" },
  { value: "always", label: "Always" },
] as const;
const UNDO = MAIL_UNDO_SEND_SECONDS.map((s) => ({ value: String(s), label: `${s} seconds` }));

type Toggle = { key: keyof MailBehavior; title: string; description?: string };

const TOGGLES: Toggle[] = [
  {
    key: "notifyPersonal",
    title: "Notify for Personal mail",
    description: "Off: new mail only updates the badge.",
  },
  { key: "notifyPriority", title: "Always notify for Priority people" },
  {
    key: "trackerBlocking",
    title: "Block trackers",
    description: "Removes tracking pixels before anything loads.",
  },
  { key: "spellCheck", title: "Spell check" },
  {
    key: "doneOnSend",
    title: "Done on send",
    description: "Replying from the inbox marks the thread Done.",
  },
  { key: "shortcutHints", title: "Shortcut hints" },
  {
    key: "senderLogos",
    title: "Sender logos",
    description: "Fetched from the sender's own domain, never a third party.",
  },
];

export function BehaviorGroup({
  behavior,
  onChange,
}: {
  behavior: MailBehavior;
  onChange: (patch: Partial<MailBehavior>) => void;
}) {
  return (
    <PrefGroup label="Behavior" description="These follow you to every device.">
      <PrefRow title="Badge" description="What the sidebar and Dock badge count.">
        <ChoiceSelect
          label="Badge"
          value={behavior.badge}
          choices={BADGE}
          onChange={(v) => onChange({ badge: v as MailBadgeMode })}
        />
      </PrefRow>
      <PrefRow title="Remote images">
        <ChoiceSelect
          label="Remote images"
          value={behavior.remoteImages}
          choices={IMAGES}
          onChange={(v) => onChange({ remoteImages: v as MailRemoteImages })}
        />
      </PrefRow>
      <PrefRow title="Undo send" description="How long Undo stays on after you send.">
        <ChoiceSelect
          label="Undo send"
          value={String(behavior.undoSendSeconds)}
          choices={UNDO}
          onChange={(v) => onChange({ undoSendSeconds: Number(v) as MailUndoSendSeconds })}
        />
      </PrefRow>
      <PrefRow title="Density">
        <ChoiceSelect
          label="Density"
          className="w-56"
          value={densityChoice(behavior)}
          choices={DENSITY_CHOICES}
          onChange={(v) => onChange(densityPatch(v))}
        />
      </PrefRow>
      {TOGGLES.map((t) => (
        <PrefRow key={t.key} title={t.title} description={t.description}>
          <Switch
            aria-label={t.title}
            checked={behavior[t.key] === true}
            onCheckedChange={(v) => onChange({ [t.key]: v } as Partial<MailBehavior>)}
          />
        </PrefRow>
      ))}
    </PrefGroup>
  );
}
