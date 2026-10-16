// Details: the right panel's first view (spec §12, prototype round 5 frame 4,
// "As a member"). Top to bottom as frame 4 draws it: About (the topic) ·
// Linked to (CV-13's chip; empty until then) · People (with presence; the
// status line is CV-17's) · Your notifications (Notify me, Pin to sidebar) ·
// Reply chains (CV-12) · Decisions (CV-14) · Pinned · then the quiet History
// of every change (AC15.5) and the conversation's own actions (Archive for
// managers, Leave). A viewer gets the same view without what they can't do.

import { Pin } from "lucide-react";
import type * as React from "react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FeedItem } from "@/components/ui/feed";
import { GroupHeader } from "@/components/ui/group-header";
import { PropertyRow, PropertyValue } from "@/components/ui/property-row";
import { Switch } from "@/components/ui/switch";
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
import { detailsPeople } from "./details-model";
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
  online: (id: string) => boolean;
  members: readonly ChatMember[] | null;
  pinned: readonly ChatMessage[] | null;
  history: readonly ChatHistoryEntry[] | null;
  /** Archive and unarchive (a manager or an admin, while the plan allows writing). */
  canArchive: boolean;
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
  online,
  members,
  pinned,
  history,
  canArchive,
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
  const people = members ? detailsPeople(members, selfId, personOf, online) : null;
  const canLeave = isChannel && !!member && !channel.isDefault;

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

      <Section title="People" count={people?.length}>
        {people === null ? (
          <Quiet>Loading…</Quiet>
        ) : (
          <ul className="flex flex-col gap-px" data-slot="details-people">
            {people.map((p) => (
              <li key={p.userId}>
                <button
                  type="button"
                  onClick={() => onOpenPerson(p.userId)}
                  data-person={p.userId}
                  className={ROW_BUTTON}
                >
                  <PresenceAvatar
                    name={p.name}
                    id={p.userId}
                    src={p.avatarUrl}
                    online={p.online && !p.former}
                  />
                  <span className="min-w-0 flex-1 truncate text-foreground">{p.name}</span>
                  {/* The status line (presets, "clear after") arrives with CV-17. */}
                  <span
                    data-slot="person-status"
                    className="shrink-0 text-xs text-subtle-foreground"
                  >
                    {p.self ? "you" : p.former ? "former member" : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
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

      {/* Marked decisions: CV-14 fills this. */}
      <Section title="Decisions">
        <Quiet data-slot="details-decisions">Nothing marked as a decision yet.</Quiet>
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

      {canArchive || canLeave ? (
        <div className="flex flex-wrap gap-2 px-2">
          {canArchive ? (
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
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-0.5" aria-label={title}>
      <GroupHeader as="h3" label={title} count={count} />
      {children}
    </section>
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
