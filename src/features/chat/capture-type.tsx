// Chat's capture type, Message (chat-v2 §8, CH65, #10, #33; CV-10): ⌘7 inside
// the capture. It has no default destination: the picker opens focused, recent
// conversations and people first; a person starts (or reopens) a direct
// message. What the page has open ("From: …") goes into the message as a
// reference card. ⏎ sends and says "Sent to Acme · Open · Undo"; Undo deletes
// the message within 8 seconds.

import { MessageSquare } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Chip } from "@/components/ui/chip";
import { Kbd } from "@/components/ui/kbd";
import type { CaptureBodyProps, CaptureTypeDef } from "@/lib/capture-registry";
import type { EntityRef } from "@/lib/entity-links";
import { ENTITY_OPEN_EVENT } from "@/lib/entity-open";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";
import { useWorkspace } from "@/providers/workspace-provider";
import { resolveEntityIcon } from "../spine/icon-map";
import { plainTextToBlocks } from "./markup-v2/paste";
import { serializeBlocks } from "./markup-v2/serialize";
import type { ChatChannel, ChatPerson } from "./model";
import { conversationTitle, dmPeople } from "./shell/sidebar-model";

/** Undo deletes a sent message within this long (#33). */
export const SENT_UNDO_MS = 8_000;

/** One place a message can go: a conversation, or a person (a direct message). */
export type MessageDestination =
  | { kind: "conversation"; channel: ChatChannel; title: string }
  | { kind: "person"; person: ChatPerson };

/**
 * The picker's list: recent conversations first (by last message), then the
 * people you have no direct message with yet, each filtered by the query.
 */
export function messageDestinations(
  channels: readonly ChatChannel[],
  people: readonly ChatPerson[],
  selfId: string,
  query: string,
  memberOf: ReadonlySet<string>,
): MessageDestination[] {
  const q = query.trim().toLowerCase();
  const personOf = (id: string) => people.find((p) => p.userId === id);
  const convs = channels
    .filter((c) => !c.archivedAt && (c.kind === "dm" || memberOf.has(c.id)))
    .map((c) => ({ channel: c, title: conversationTitle(c, selfId, personOf) }))
    .filter((c) => !q || c.title.toLowerCase().includes(q))
    .sort((a, b) =>
      (b.channel.lastMessageAt ?? b.channel.createdAt).localeCompare(
        a.channel.lastMessageAt ?? a.channel.createdAt,
      ),
    );
  const dmWith = new Set(
    channels
      .filter((c) => c.kind === "dm")
      .map((c) => dmPeople(c, selfId))
      .filter((ids) => ids.length === 1)
      .map((ids) => ids[0]),
  );
  const persons = people
    .filter((p) => p.userId !== selfId && !p.former && !dmWith.has(p.userId))
    .filter((p) => !q || p.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [
    ...convs.map((c) => ({ kind: "conversation" as const, channel: c.channel, title: c.title })),
    ...persons.map((p) => ({ kind: "person" as const, person: p })),
  ];
}

/** The stored body: the words, then the "From:" item alone on its line (a card). */
export function messageBody(text: string, from: EntityRef | null): string {
  const blocks = text.trim() ? plainTextToBlocks(text.trim()) : [];
  if (from) blocks.push({ t: "p", c: [{ t: "ref", type: from.type, id: from.id }] });
  return serializeBlocks(blocks);
}

function destinationLabel(d: MessageDestination): string {
  return d.kind === "conversation"
    ? d.channel.kind === "channel"
      ? `#${d.title}`
      : d.title
    : d.person.name;
}

function MessageCaptureBody({
  draft,
  onDraftChange,
  writable,
  onDone,
  context,
  typeChip,
}: CaptureBodyProps) {
  const { runtime, userId } = useAuth();
  const { selectedWorkspaceId } = useWorkspace();
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [people, setPeople] = useState<ChatPerson[]>([]);
  const [memberOf, setMemberOf] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [dest, setDest] = useState<MessageDestination | null>(null);
  const [fromOn, setFromOn] = useState(true);
  const [busy, setBusy] = useState(false);
  const pickerRef = useRef<HTMLInputElement>(null);
  const lineRef = useRef<HTMLTextAreaElement>(null);
  const selfId = userId ?? "";
  const source = context?.source ?? null;

  useEffect(() => {
    const chat = runtime?.chat;
    if (!chat || !selectedWorkspaceId || !selfId) return;
    let live = true;
    void Promise.all([
      chat.listChannels(selectedWorkspaceId),
      chat.people(selectedWorkspaceId),
      chat.listMyMemberships(selectedWorkspaceId, selfId),
    ])
      .then(([list, ppl, mine]) => {
        if (!live) return;
        setChannels(list);
        setPeople(ppl.data ?? []);
        setMemberOf(new Set(mine.map((m) => m.channelId)));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [runtime, selectedWorkspaceId, selfId]);

  // No default destination: the picker has the focus when the type opens.
  useEffect(() => {
    const id = window.setTimeout(() => (dest ? lineRef : pickerRef).current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [dest]);

  const options = useMemo(
    () => messageDestinations(channels, people, selfId, query, memberOf).slice(0, 8),
    [channels, people, selfId, query, memberOf],
  );

  const pick = (d: MessageDestination) => {
    setDest(d);
    setQuery("");
  };

  const send = async () => {
    const chat = runtime?.chat;
    if (busy || !chat || !selectedWorkspaceId) return;
    if (!writable) {
      toast.error("You have view-only access to chat.");
      return;
    }
    if (!dest) {
      pickerRef.current?.focus();
      return;
    }
    const from = fromOn && source ? (source.ref ?? (await source.resolve?.()) ?? null) : null;
    const body = messageBody(draft, from);
    if (!body.trim()) return;
    setBusy(true);
    try {
      const channel =
        dest.kind === "conversation"
          ? dest.channel
          : await chat.openDm({ workspaceId: selectedWorkspaceId, userIds: [dest.person.userId] });
      const id = crypto.randomUUID();
      const res = await chat.send({
        id,
        channelId: channel.id,
        body,
        replyToId: null,
        format: "v2",
      });
      if (res.error) throw new Error(res.error.message);
      onDraftChange("");
      onDone();
      const where = destinationLabel(dest);
      toast(`Sent to ${where}`, {
        id: `chat-sent-${id}`,
        duration: SENT_UNDO_MS,
        action: {
          label: "Undo",
          onClick: () => {
            void chat.remove(id).then((r) => {
              if (r.error) toast.error("Couldn't take it back.");
            });
          },
        },
        cancel: {
          label: "Open",
          onClick: () =>
            window.dispatchEvent(
              new CustomEvent(ENTITY_OPEN_EVENT, {
                detail: { type: "chat_channel", id: channel.id, messageId: id },
              }),
            ),
        },
      });
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't send that.");
    } finally {
      setBusy(false);
    }
  };

  const SourceIcon = MessageSquare;
  return (
    <div className="flex flex-col">
      <div className="flex min-w-0 items-center gap-1 px-2 pt-2">
        {typeChip}
        <span className="text-muted-foreground" aria-hidden>
          ·
        </span>
        {dest ? (
          <Chip
            size="sm"
            icon={resolveEntityIcon(
              dest.kind === "person"
                ? "chat_dm"
                : dest.channel.kind === "dm"
                  ? "chat_dm"
                  : dest.channel.isPrivate
                    ? "chat_private"
                    : "chat_channel",
            )}
            onRemove={() => setDest(null)}
            removeLabel="Pick another destination"
            className="max-w-64"
          >
            {destinationLabel(dest)}
          </Chip>
        ) : (
          <span className="text-sm text-muted-foreground">To…</span>
        )}
        <span className="grow" />
        {source && fromOn ? (
          <Chip
            size="sm"
            icon={SourceIcon}
            onRemove={() => setFromOn(false)}
            removeLabel="Don't add it"
            title="Goes into the message as a card"
            className="max-w-64"
          >
            From: {source.label}
          </Chip>
        ) : null}
      </div>

      {dest ? null : (
        <div className="px-2 pt-1">
          <input
            ref={pickerRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, options.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter" || e.key === "Tab") {
                const d = options[active];
                if (!d) return;
                e.preventDefault();
                pick(d);
              }
            }}
            placeholder="Send to a conversation or a person…"
            aria-label="Send to"
            role="combobox"
            aria-expanded
            aria-controls="message-capture-destinations"
            className="h-(--ctrl-h) w-full rounded-md bg-transparent px-2 font-sans text-sm text-foreground outline-none placeholder:text-muted-foreground"
          />
          <div
            id="message-capture-destinations"
            role="listbox"
            aria-label="Destinations"
            className="flex flex-col py-1"
          >
            {options.map((d, i) => {
              const Icon = resolveEntityIcon(
                d.kind === "person"
                  ? "contact"
                  : d.channel.kind === "dm"
                    ? "chat_dm"
                    : d.channel.isPrivate
                      ? "chat_private"
                      : "chat_channel",
              );
              return (
                <div
                  key={d.kind === "person" ? `p:${d.person.userId}` : `c:${d.channel.id}`}
                  role="option"
                  tabIndex={-1}
                  aria-selected={i === active}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(d);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={cn(
                    "flex cursor-default items-center gap-2 rounded-md px-2 py-1 text-sm text-foreground",
                    i === active && "bg-state-hover",
                  )}
                >
                  <Icon className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate">{d.kind === "person" ? d.person.name : d.title}</span>
                  {d.kind === "person" ? (
                    <span className="ml-auto text-xs text-muted-foreground">Direct message</span>
                  ) : null}
                </div>
              );
            })}
            {options.length === 0 ? (
              <p className="px-2 py-1 text-sm text-muted-foreground">
                No conversation or person matches.
              </p>
            ) : null}
          </div>
        </div>
      )}

      {dest ? (
        <textarea
          ref={lineRef}
          value={draft}
          rows={2}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
            e.preventDefault();
            void send();
          }}
          placeholder="Write a message…"
          aria-label="Message"
          className="w-full resize-none bg-transparent px-4 pt-2 font-sans text-base text-foreground outline-none placeholder:text-muted-foreground"
        />
      ) : null}

      <div className="flex items-center gap-3 border-t border-border px-4 py-2 font-sans text-xs text-muted-foreground">
        {writable ? (
          dest ? (
            <>
              <span className="flex items-center gap-1">
                <Kbd>⏎</Kbd> Send
              </span>
              <span className="flex items-center gap-1">
                <Kbd>⇧⏎</Kbd> New line
              </span>
            </>
          ) : (
            <span className="flex items-center gap-1">
              <Kbd>⏎</Kbd> Pick where it goes
            </span>
          )
        ) : (
          <span>You have view-only access to chat.</span>
        )}
      </div>
    </div>
  );
}

export const chatCaptureType: CaptureTypeDef = {
  type: "message",
  module: "chat",
  label: "Message",
  icon: MessageSquare,
  destination: "Pick a conversation",
  canWrite: (perms) => perms.chat === "edit" || perms.chat === "admin",
  Body: MessageCaptureBody,
  ownsHeader: true,
};
