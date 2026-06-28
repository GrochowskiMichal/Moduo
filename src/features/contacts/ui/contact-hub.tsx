// The ContactHub — "the great moment" (block CO-2, AC2). The center pane for a
// selected contact: an editable header (name + status), the quiet LastTouchLine,
// the spine EntityHub roll-up (variant="page", grouped by relation_kind), and the
// contact's activity trail. It is a pure READ over the spine — there is NO "log
// activity" affordance anywhere. Presentational + controlled (data from
// useContactHub); tokens only, status as color+label (AC12).

import { useEffect, useState } from "react";
import { Pencil } from "lucide-react";

import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type { EntityLink, EntityRef, RelationKind } from "@/lib/entity-links";
import { EntityHub } from "../../spine/ui/entity-hub";
import type { HubStatus } from "../../spine/hooks/use-entity-hub";
import { spineActivityLine, spineActorName } from "../../spine/activity";
import type { ActivityEntry } from "../../tasks/model";
import type { Contact } from "../model";
import { contactStatusMeta, DEFAULT_CONTACT_STATUSES } from "../status";
import { lastTouchLine, timeAgo, type ContactRollup } from "../rollup";
import { initials } from "./contact-directory";
import { ContactStatusDot } from "./contact-status-badge";

export type ContactHubProps = {
  contact: Contact;
  rollup: ContactRollup;
  /** The EntityHub roll-up read status (drives skeleton/error on the history). */
  hubStatus: HubStatus;
  activity: ActivityEntry[];
  canEdit?: boolean;
  currentUserId?: string | null;
  /** Injected for deterministic stories/tests; defaults to now. */
  now?: Date;
  onRename?: (name: string) => void;
  onStatusChange?: (status: string) => void;
  /** Open the full edit dialog (name / email / phone / title / status). */
  onEdit?: () => void;
  onOpenEntity?: (ref: EntityRef) => void;
  onChangeKind?: (link: EntityLink, kind: RelationKind) => void;
  onUnlink?: (link: EntityLink) => void;
  onRetry?: () => void;
};

function LastTouchLine({ rollup, now }: { rollup: ContactRollup; now: Date }) {
  return (
    <p className="text-sm text-muted-foreground">{lastTouchLine(rollup, now)}</p>
  );
}

function ContactHeader({
  contact,
  canEdit,
  onRename,
  onStatusChange,
  onEdit,
}: Pick<ContactHubProps, "contact" | "canEdit" | "onRename" | "onStatusChange" | "onEdit">) {
  const [name, setName] = useState(contact.name);
  useEffect(() => setName(contact.name), [contact.id, contact.name]);

  // A renamed/custom status keeps its option in the list so the Select shows it.
  const statusMeta = contactStatusMeta(contact.status);
  const known = DEFAULT_CONTACT_STATUSES.some((s) => s.id === statusMeta.id);
  const options = known ? DEFAULT_CONTACT_STATUSES : [...DEFAULT_CONTACT_STATUSES, statusMeta];

  return (
    <div className="flex items-start gap-3">
      <Avatar size="lg">
        {contact.avatarUrl ? <AvatarImage src={contact.avatarUrl} alt="" /> : null}
        <AvatarFallback>{initials(contact.name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1 space-y-1">
        {canEdit ? (
          <Input
            variant="bare"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name !== contact.name && onRename?.(name)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            aria-label="Contact name"
            // Override the primitive's fixed control-rung height so the 2xl title
            // input matches the read-only <h2> height (bare drops the chrome).
            style={{ height: "auto" }}
            className="font-display text-2xl focus-visible:ring-0"
          />
        ) : (
          <h2 className="font-display text-2xl text-foreground">{contact.name || "Unnamed"}</h2>
        )}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {contact.title ? <span className="truncate">{contact.title}</span> : null}
          {contact.email ? <span className="truncate">{contact.email}</span> : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
      {canEdit && onEdit ? (
        <IconButton icon={Pencil} label="Edit contact" size="sm" variant="ghost" onClick={onEdit} />
      ) : null}
      {canEdit ? (
        <Select value={statusMeta.id} onValueChange={(v) => onStatusChange?.(v)}>
          <SelectTrigger size="sm" aria-label="Status" className="w-36">
            {/* SelectValue mirrors the chosen item (dot + label) — no extra dot here. */}
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                <span className="flex items-center gap-1.5">
                  <ContactStatusDot status={s.id} />
                  {s.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <ContactStatusDot status={statusMeta.id} />
          {statusMeta.label}
        </span>
      )}
      </div>
    </div>
  );
}

function ActivitySection({
  activity,
  currentUserId,
  now,
}: {
  activity: ActivityEntry[];
  currentUserId: string | null;
  now: Date;
}) {
  if (activity.length === 0) return null;
  return (
    <section className="space-y-1">
      <h3 className="font-sans text-2xs font-medium uppercase tracking-wide text-muted-foreground">Activity</h3>
      <ul className="space-y-1">
        {activity.map((entry) => (
          <li key={entry.id} className="flex items-baseline gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              <span className="text-foreground">{spineActorName(entry, currentUserId)}</span>{" "}
              {spineActivityLine(entry)}
            </span>
            <span className="shrink-0 text-2xs text-muted-foreground/70">{timeAgo(entry.createdAt, now)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ContactHub({
  contact,
  rollup,
  hubStatus,
  activity,
  canEdit = false,
  currentUserId = null,
  now = new Date(),
  onRename,
  onStatusChange,
  onEdit,
  onOpenEntity,
  onChangeKind,
  onUnlink,
  onRetry,
}: ContactHubProps) {
  return (
    <div className={cn("mx-auto flex h-full min-h-0 max-w-2xl flex-col gap-5 overflow-y-auto p-6")}>
      <ContactHeader
        contact={contact}
        canEdit={canEdit}
        onRename={onRename}
        onStatusChange={onStatusChange}
        onEdit={onEdit}
      />
      <LastTouchLine rollup={rollup} now={now} />
      <Separator />
      <EntityHub
        variant="page"
        status={hubStatus}
        sections={rollup.sections}
        canEdit={canEdit}
        onOpen={onOpenEntity}
        onChangeKind={onChangeKind}
        onUnlink={onUnlink}
        onRetry={onRetry}
      />
      <ActivitySection activity={activity} currentUserId={currentUserId} now={now} />
    </div>
  );
}
