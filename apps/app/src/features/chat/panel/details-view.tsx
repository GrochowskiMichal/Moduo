// Details: the right panel's first view (spec §12, prototype round 5 frame 4,
// "As a member"). Top to bottom as frame 4 draws it: About (the topic) ·
// Linked to (the linked item and "Link to…", CV-13) · People (with presence; the
// status line is CV-17's) · Your notifications (Notify me, Pin to sidebar) ·
// Reply chains (CV-12) · Decisions (CV-14) · Pinned · then the quiet History
// of every change (AC15.5) and the conversation's own actions (Leave).
// "As a manager" (CV-15) adds Manager labels and + in People, each person's
// manager / remove actions, and the Channel settings block (the announcement
// switch, Private one way, Name and topic, Archive, Delete). A viewer gets the
// same view without what they can't do.

import { Flag, MoreHorizontal, Pin, Plus } from "lucide-react";
import type * as React from "react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FeedItem } from "@/components/ui/feed";
import { GroupHeader } from "@/components/ui/group-header";
import { PropertyRow, PropertyValue } from "@/components/ui/property-row";
import { Switch } from "@/components/ui/switch";
import type { PresenceState } from "@/lib/statuses/model";
import { formatAge, formatDate, formatStamp } from "@/lib/time-format";
import { cn } from "@/lib/utils";

import { spineActivityLine, spineActorName } from "../../spine/activity";
import type { ChainEntry } from "../chains";
import { messageTree, toBodyText } from "../markup-v2";
import type {
  ChatChannel,
  ChatHistoryEntry,
  ChatMember,
  ChatMessage,
  ChatNotifyLevel,
  ChatPerson,
} from "../model";
import { NOTIFY_LEVEL_COPY } from "../shell/conversation-toolbar";
import { detailsPeople, keyReadersLine } from "./details-model";
import { PresenceAvatar } from "./person-card";
import { DetailsChainRows } from "./reply-chains-view";

/** History shows this many lines until "Show all". */
const HISTORY_FIRST = 6;

export type DetailsViewProps = {
  channel: ChatChannel;
  /** Your membership (null: you read it without being in it). */
  member: ChatMember | null;
  selfId: string;
  personOf: (id: string) => ChatPerson | undefined;
  /** Whether this person's role posts (only they can be made a manager); default: not a viewer. */
  canBeManager?: (id: string) => boolean;
  online: (id: string) => boolean;
  /** The presence shape and the "now" line per person (CV-17). */
  stateOf?: (id: string) => PresenceState;
  statusOf?: (id: string) => string;
  members: readonly ChatMember[] | null;
  pinned: readonly ChatMessage[] | null;
  /** Marked decisions, newest first (CV-14); null while they load. */
  decisions?: readonly ChatMessage[] | null;
  /** CV-21: whose keys read this private channel. */
  keyReaders?: ReadonlyArray<{ userId: string; name: string }> | null;
  history: readonly ChatHistoryEntry[] | null;
  /** Archive and unarchive (a manager or an admin, while the plan allows writing). */
  canArchive: boolean;
  /** The channel's manager rows (null while they load). */
  managers?: readonly string[] | null;
  /** You manage it in effect (a manager or an admin) and may write: the manager's controls. */
  canManage?: boolean;
  /** + in People: managers for a private channel, anyone who posts for a public one. */
  canAddPeople?: boolean;
  onAddPeople?: () => void;
  onRemovePerson?: (userId: string) => void;
  onSetManager?: (userId: string, on: boolean) => void;
  onSetAnnouncement?: (on: boolean) => void;
  /** Opens the one confirm (#33); it never goes back. */
  onMakePrivate?: () => void;
  onEditChannel?: () => void;
  /** Opens the delete confirm (to Recently deleted). */
  onDelete?: () => void;
  onNotify: (level: ChatNotifyLevel) => void;
  onPinToSidebar: (starred: boolean) => void;
  onArchive: (archived: boolean) => void;
  onLeave: () => void;
  onOpenPerson: (userId: string) => void;
  onOpenMessage: (message: ChatMessage) => void;
  /** The conversation's reply chains, open then wrapped (null while they load). */
  chains: { open: ChainEntry[]; wrapped: ChainEntry[] } | null;
  onOpenChain: (root: ChatMessage) => void;
  /** "Linked to"'s body (CV-13's ChannelLinkSection); its empty line without one. */
  linkSection?: React.ReactNode;
};

export function DetailsView({
  channel,
  member,
  selfId,
  personOf,
  canBeManager,
  online,
  stateOf,
  statusOf,
  members,
  pinned,
  decisions = [],
  keyReaders = null,
  history,
  canArchive,
  managers = null,
  canManage = false,
  canAddPeople = false,
  onAddPeople,
  onRemovePerson,
  onSetManager,
  onSetAnnouncement,
  onMakePrivate,
  onEditChannel,
  onDelete,
  onNotify,
  onPinToSidebar,
  onArchive,
  onLeave,
  onOpenPerson,
  onOpenMessage,
  chains,
  onOpenChain,
  linkSection,
}: DetailsViewProps) {
  const isChannel = channel.kind === "channel";
  const people = members ? detailsPeople(members, selfId, personOf, online, stateOf) : null;
  const appLine = keyReadersLine(keyReaders, selfId);
  const canLeave = isChannel && !!member && !channel.isDefault;
  const managerSet = new Set(managers ?? []);
  // Archive sits in Channel settings (frame 4); an archived channel shows no
  // settings, so Unarchive stays in the footer.
  const settingsShown = isChannel && canManage && !channel.archivedAt;

  return (
    <div
      data-slot="chat-details"
      className="pane-scroll flex h-full min-h-0 flex-col gap-5 overflow-auto pb-4"
    >
      {channel.topic.trim() ? (
        <Section title="About">
          <p className="px-2 text-sm leading-relaxed break-words text-muted-foreground">
            {channel.topic}
          </p>
        </Section>
      ) : null}

      {isChannel ? (
        // The linked item, "Link to…" and the team offer (CV-13, link-section.tsx).
        <Section title="Linked to">
          {linkSection ?? (
            <Quiet data-slot="details-link">Not linked to a project, client or team yet.</Quiet>
          )}
        </Section>
      ) : null}

      <Section
        title="People"
        count={people?.length}
        action={
          isChannel && canAddPeople && !channel.archivedAt && onAddPeople ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-(--ctrl-h-xs)"
              aria-label="Add people"
              onClick={onAddPeople}
              data-slot="details-add-people"
            >
              <Plus aria-hidden className="size-icon-sm" />
            </Button>
          ) : null
        }
      >
        {people === null ? (
          <Quiet>Loading…</Quiet>
        ) : (
          <ul className="flex flex-col gap-px" data-slot="details-people">
            {people.map((p) => (
              <li key={p.userId} className="group/person relative">
                <button
                  type="button"
                  onClick={() => onOpenPerson(p.userId)}
                  data-person={p.userId}
                  className={ROW_BUTTON}
                >
                  <PresenceAvatar name={p.name} id={p.userId} src={p.avatarUrl} state={p.state} />
                  <span className="min-w-0 flex-1 truncate text-foreground">{p.name}</span>
                  {isChannel && managerSet.has(p.userId) ? (
                    <span
                      data-slot="person-manager"
                      className="shrink-0 rounded-sm bg-muted px-1.5 text-2xs text-muted-foreground"
                    >
                      Manager
                    </span>
                  ) : null}
                  <span
                    data-slot="person-status"
                    className="min-w-0 max-w-1/2 shrink truncate text-xs text-subtle-foreground"
                  >
                    {p.self ? "you" : p.former ? "former member" : statusOf?.(p.userId) || null}
                  </span>
                  {settingsShown && !p.former ? (
                    <span aria-hidden className="w-5 shrink-0" />
                  ) : null}
                </button>
                {settingsShown && !p.former ? (
                  <PersonActions
                    name={p.name}
                    self={p.self}
                    manager={managerSet.has(p.userId)}
                    // A viewer (or a read-only role) reads and reacts: never a manager (§12).
                    canBeManager={
                      canBeManager ? canBeManager(p.userId) : personOf(p.userId)?.role !== "viewer"
                    }
                    onSetManager={(on) => onSetManager?.(p.userId, on)}
                    onRemove={p.self ? undefined : () => onRemovePerson?.(p.userId)}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {/* CV-21: a key with "Include private channels I'm in" reads this channel. */}
        {isChannel && channel.isPrivate && appLine ? (
          <Quiet data-slot="details-key-readers">{appLine}</Quiet>
        ) : null}
      </Section>

      {member ? (
        <Section title="Your notifications">
          <div className="flex flex-col px-2">
            <PropertyRow label="Notify me">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <PropertyValue aria-label={`Notify me: ${NOTIFY_LEVEL_COPY[member.notifyLevel]}`}>
                    {NOTIFY_LEVEL_COPY[member.notifyLevel]}
                  </PropertyValue>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-52">
                  <DropdownMenuRadioGroup
                    value={member.notifyLevel}
                    onValueChange={(v) => onNotify(v as ChatNotifyLevel)}
                  >
                    {(Object.keys(NOTIFY_LEVEL_COPY) as ChatNotifyLevel[]).map((key) => (
                      <DropdownMenuRadioItem key={key} value={key}>
                        {NOTIFY_LEVEL_COPY[key]}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </PropertyRow>
            <PropertyRow label="Pin to sidebar" htmlFor={`pin-${channel.id}`}>
              <Switch
                id={`pin-${channel.id}`}
                size="sm"
                checked={member.starred}
                onCheckedChange={(on) => onPinToSidebar(on)}
              />
            </PropertyRow>
          </div>
        </Section>
      ) : null}

      {settingsShown ? (
        <Section title="Channel settings" note="managers">
          <div className="flex flex-col px-2" data-slot="details-channel-settings">
            <SettingRow
              id={`announce-${channel.id}`}
              label="Only managers can post"
              hint="For announcements; everyone else reads and reacts"
            >
              <Switch
                id={`announce-${channel.id}`}
                size="sm"
                checked={!!channel.managersOnly}
                onCheckedChange={(on) => onSetAnnouncement?.(on)}
              />
            </SettingRow>
            <SettingRow
              id={`private-${channel.id}`}
              label="Private"
              hint="Can only go from public to private, never back"
            >
              <Switch
                id={`private-${channel.id}`}
                size="sm"
                checked={channel.isPrivate}
                // One way: on stays on; General stays public.
                disabled={channel.isPrivate || !!channel.isDefault}
                onCheckedChange={(on) => {
                  if (on) onMakePrivate?.();
                }}
              />
            </SettingRow>
            <PropertyRow label="Name and topic">
              <Button variant="outline" size="sm" onClick={onEditChannel}>
                Edit
              </Button>
            </PropertyRow>
            {!channel.isDefault ? (
              <div className="flex flex-wrap gap-2 pt-1.5" data-slot="details-danger">
                <Button variant="outline" size="sm" onClick={() => onArchive(true)}>
                  Archive channel
                </Button>
                {onDelete ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={onDelete}
                    className="text-destructive"
                  >
                    Delete channel
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        </Section>
      ) : null}

      {/* Open chains, then wrapped ones (CV-12): the Reply chains view's read. */}
      <Section
        title="Reply chains"
        count={chains ? chains.open.length + chains.wrapped.length || undefined : undefined}
      >
        {chains && chains.open.length + chains.wrapped.length > 0 ? (
          <DetailsChainRows
            groups={chains}
            selfId={selfId}
            personOf={personOf}
            onOpen={onOpenChain}
            rowClassName={ROW_BUTTON}
          />
        ) : (
          <Quiet data-slot="details-chains">{chains ? "No reply chains yet." : "Loading…"}</Quiet>
        )}
      </Section>

      {/* Marked decisions (CV-14; round 5 frame 4): the flag, the words, the day it was marked. */}
      <Section title="Decisions" count={decisions?.length || undefined}>
        {decisions === null ? (
          <Quiet>Loading…</Quiet>
        ) : decisions.length === 0 ? (
          <Quiet data-slot="details-decisions">Nothing marked as a decision yet.</Quiet>
        ) : (
          <ul className="flex flex-col gap-px" data-slot="details-decisions">
            {decisions.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => onOpenMessage(m)}
                  data-message={m.id}
                  className={ROW_BUTTON}
                >
                  <Flag className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-foreground">{excerpt(m)}</span>
                  <span className="shrink-0 text-xs text-subtle-foreground tabular-nums">
                    {formatDate(m.decisionAt ?? m.createdAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Pinned" count={pinned?.length || undefined}>
        {pinned === null ? (
          <Quiet>Loading…</Quiet>
        ) : pinned.length === 0 ? (
          <Quiet>Pin a message to keep it here.</Quiet>
        ) : (
          <ul className="flex flex-col gap-px" data-slot="details-pinned">
            {pinned.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => onOpenMessage(m)}
                  data-message={m.id}
                  className={ROW_BUTTON}
                >
                  <Pin className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-foreground">{excerpt(m)}</span>
                  <span className="shrink-0 text-xs text-subtle-foreground tabular-nums">
                    {formatDate(m.pinnedAt ?? m.createdAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <HistorySection history={history} selfId={selfId} personOf={personOf} />

      {(canArchive && !settingsShown) || canLeave ? (
        <div className="flex flex-wrap gap-2 px-2">
          {canArchive && !settingsShown ? (
            <Button variant="outline" size="sm" onClick={() => onArchive(!channel.archivedAt)}>
              {channel.archivedAt ? "Unarchive channel" : "Archive channel"}
            </Button>
          ) : null}
          {canLeave ? (
            <Button variant="outline" size="sm" onClick={onLeave}>
              Leave channel
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

const ROW_BUTTON = cn(
  "flex h-(--row-h-sm) w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-sm outline-none",
  "transition-colors duration-(--motion-fade) ease-(--ease-out)",
  "hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring/50",
);

function excerpt(m: ChatMessage): string {
  return (
    toBodyText(messageTree(m.id, m.updatedAt, m.body))
      .replace(/\s+/g, " ")
      .trim() || "Message"
  );
}

function Section({
  title,
  count,
  note,
  action,
  children,
}: {
  title: string;
  count?: number;
  /** A quiet word after the title (frame 4: "Channel settings · managers"). */
  note?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-0.5" aria-label={title}>
      <GroupHeader as="h3" label={title} count={count} sub={note} persistentActions={action} />
      {children}
    </section>
  );
}

/** A switch row with its explanation under the label (frame 4's setrow). */
function SettingRow({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-(--row-h) items-center justify-between gap-2.5 py-1">
      <label htmlFor={id} className="flex min-w-0 flex-col text-sm text-foreground">
        {label}
        <span className="text-xs text-subtle-foreground">{hint}</span>
      </label>
      {children}
    </div>
  );
}

/** A person's actions for a manager: make or unmake a manager, remove them. */
function PersonActions({
  name,
  self,
  manager,
  canBeManager,
  onSetManager,
  onRemove,
}: {
  name: string;
  self: boolean;
  manager: boolean;
  canBeManager: boolean;
  onSetManager: (on: boolean) => void;
  onRemove?: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${name}: options`}
          className={cn(
            "absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground opacity-0 outline-none",
            "transition-opacity duration-(--motion-fade) ease-(--ease-out)",
            "group-hover/person:opacity-100 hover:bg-state-active hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 aria-expanded:opacity-100",
          )}
        >
          <MoreHorizontal className="size-icon-sm" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {manager || canBeManager ? (
          <DropdownMenuItem onSelect={() => onSetManager(!manager)}>
            {manager ? (self ? "Stop managing" : "Remove as manager") : "Make manager"}
          </DropdownMenuItem>
        ) : null}
        {onRemove ? (
          <DropdownMenuItem variant="destructive" onSelect={onRemove}>
            Remove from channel
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Quiet({ children, ...props }: React.ComponentProps<"p">) {
  return (
    <p className="px-2 text-sm text-subtle-foreground" {...props}>
      {children}
    </p>
  );
}

function HistorySection({
  history,
  selfId,
  personOf,
}: {
  history: readonly ChatHistoryEntry[] | null;
  selfId: string;
  personOf: (id: string) => ChatPerson | undefined;
}) {
  const [all, setAll] = useState(false);
  const shown = history && !all ? history.slice(0, HISTORY_FIRST) : history;
  return (
    <Section title="History">
      {history === null ? (
        <Quiet>Loading…</Quiet>
      ) : history.length === 0 ? (
        <Quiet>No changes yet.</Quiet>
      ) : (
        <div className="flex flex-col gap-1.5 px-2" data-slot="details-history">
          {shown?.map((entry) => {
            const name = spineActorName(
              {
                ...entry,
                // A person's current name, when they're still here.
                actorLabel:
                  (entry.actorId ? personOf(entry.actorId)?.name : null) ?? entry.actorLabel,
              },
              selfId,
            );
            return (
              <FeedItem
                key={entry.id}
                data-op={entry.op}
                time={formatAge(entry.createdAt)}
                timeTitle={formatStamp(entry.createdAt)}
              >
                <b>{name}</b> {spineActivityLine(entry)}
              </FeedItem>
            );
          })}
          {history.length > HISTORY_FIRST ? (
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2.5 self-start text-muted-foreground"
              onClick={() => setAll((v) => !v)}
            >
              {all ? "Show less" : `Show all ${history.length}`}
            </Button>
          ) : null}
        </div>
      )}
    </Section>
  );
}
