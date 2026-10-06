// Chat dialogs: create a channel, pick people (new DM / add to channel),
// browse channels, and the ⌘J conversation switcher.

import { Check, Hash, Lock, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ChatChannel, ChatPerson } from "../model";
import { normalizeChannelName } from "../timeline";
import { PersonAvatar } from "./person-avatar";

// ── Create channel ───────────────────────────────────────────────────────────

export function CreateChannelDialog({
  open,
  onOpenChange,
  people,
  selfId,
  takenNames,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  people: ChatPerson[];
  selfId: string;
  takenNames: Set<string>;
  onCreate: (args: {
    name: string;
    topic: string;
    isPrivate: boolean;
    memberIds: string[];
    managersOnly: boolean;
  }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [managersOnly, setManagersOnly] = useState(false);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName("");
    setTopic("");
    setIsPrivate(false);
    setManagersOnly(false);
    setMemberIds([]);
    setError(null);
  }, [open]);

  const normalized = normalizeChannelName(name);
  const taken = normalized !== "" && takenNames.has(normalized);
  const others = people.filter((p) => p.userId !== selfId);

  const submit = async () => {
    if (!normalized || taken || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate({ name: normalized, topic: topic.trim(), isPrivate, memberIds, managersOnly });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the channel.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New channel</DialogTitle>
          <DialogDescription>
            Channels are where a topic lives. Keep them focused.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="chat-channel-name">Name</Label>
            <div className="relative">
              {isPrivate ? (
                <Lock
                  className="pointer-events-none absolute top-1/2 left-2.5 size-icon-sm -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
              ) : (
                <Hash
                  className="pointer-events-none absolute top-1/2 left-2.5 size-icon-sm -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
              )}
              <Input
                id="chat-channel-name"
                // biome-ignore lint/a11y/noAutofocus: dialog's primary field
                autoFocus
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. launch-plan"
                className="pl-8"
                aria-invalid={taken}
              />
            </div>
            <p className={cn("text-2xs", taken ? "text-danger" : "text-muted-foreground")}>
              {taken
                ? `#${normalized} already exists.`
                : normalized && normalized !== name
                  ? `Will be created as #${normalized}`
                  : "Lowercase, no spaces — spaces become dashes."}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="chat-channel-topic">
              Topic <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="chat-channel-topic"
              value={topic}
              maxLength={250}
              rows={2}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="What's this channel about?"
            />
          </div>
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="chat-channel-private">Make private</Label>
              <p className="text-xs text-muted-foreground">
                Only people you add can find and read it. This can't be changed later.
              </p>
            </div>
            <Switch id="chat-channel-private" checked={isPrivate} onCheckedChange={setIsPrivate} />
          </div>
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-3">
            <div className="flex flex-col gap-0.5">
              <Label htmlFor="chat-channel-announce">Only managers can post</Label>
              <p className="text-xs text-muted-foreground">
                An announcement channel. You can still add managers later.
              </p>
            </div>
            <Switch
              id="chat-channel-announce"
              checked={managersOnly}
              onCheckedChange={setManagersOnly}
            />
          </div>
          {others.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              <Label>Add people</Label>
              <div className="flex flex-wrap gap-1.5">
                {others.map((p) => {
                  const on = memberIds.includes(p.userId);
                  return (
                    <button
                      key={p.userId}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setMemberIds((ids) =>
                          on ? ids.filter((id) => id !== p.userId) : [...ids, p.userId],
                        )
                      }
                      className={cn(
                        "inline-flex h-(--ctrl-h-sm) items-center gap-1.5 rounded-full border pr-2.5 pl-0.5 text-xs transition-colors",
                        on
                          ? "border-(--selected-border) bg-(--selected-bg) text-foreground"
                          : "border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      <PersonAvatar person={p} size="sm" className="scale-75" />
                      {p.name}
                      {on ? <Check className="size-icon-xs" aria-hidden /> : null}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          {error ? <p className="text-xs text-danger">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!normalized || taken || busy}>
              {busy ? "Creating…" : "Create channel"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── People picker (new DM / add people) ──────────────────────────────────────

export function PeoplePickerDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  people,
  excludeIds,
  allowSelf,
  selfId,
  isOnline,
  max,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: (count: number) => string;
  people: ChatPerson[];
  excludeIds?: string[];
  allowSelf?: boolean;
  selfId: string;
  isOnline: (id: string) => boolean;
  max?: number;
  onConfirm: (userIds: string[]) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setPicked([]);
  }, [open]);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people
      .filter((p) => (allowSelf || p.userId !== selfId) && !(excludeIds ?? []).includes(p.userId))
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .sort(
        (a, b) =>
          Number(isOnline(b.userId)) - Number(isOnline(a.userId)) || a.name.localeCompare(b.name),
      );
  }, [people, query, allowSelf, selfId, excludeIds, isOnline]);

  const toggle = (id: string) =>
    setPicked((ids) =>
      ids.includes(id)
        ? ids.filter((x) => x !== id)
        : max && ids.length >= max
          ? ids
          : [...ids, id],
    );

  const confirm = async () => {
    if (picked.length === 0 || busy) return;
    setBusy(true);
    try {
      await onConfirm(picked);
      onOpenChange(false);
    } catch {
      /* the caller toasts */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {picked.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {picked.map((id) => {
                const p = people.find((x) => x.userId === id);
                return (
                  <span
                    key={id}
                    className="inline-flex h-(--ctrl-h-sm) items-center gap-1 rounded-full bg-(--selected-bg) pr-1 pl-2.5 text-xs text-foreground"
                  >
                    {p?.name ?? "Member"}
                    <button
                      type="button"
                      aria-label={`Remove ${p?.name ?? "person"}`}
                      onClick={() => toggle(id)}
                      className="rounded-full p-0.5 hover:bg-accent"
                    >
                      <X className="size-icon-xs" aria-hidden />
                    </button>
                  </span>
                );
              })}
            </div>
          ) : null}
          <div className="relative">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-icon-sm -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              // biome-ignore lint/a11y/noAutofocus: dialog's primary field
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (query && candidates[0]) {
                    toggle(candidates[0].userId);
                    setQuery("");
                  } else void confirm();
                }
              }}
              placeholder="Find people"
              aria-label="Find people"
              className="pl-8"
            />
          </div>
          <div className="scrollbar-thin -mx-1 flex max-h-72 flex-col gap-0.5 overflow-y-auto px-1">
            {candidates.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                {people.length <= 1
                  ? "Invite someone to the workspace to chat with them."
                  : "No one matches."}
              </p>
            ) : (
              candidates.map((p) => {
                const on = picked.includes(p.userId);
                return (
                  <button
                    key={p.userId}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(p.userId)}
                    className={cn(
                      "flex min-h-(--row-h) items-center gap-2.5 rounded-md px-2 text-left transition-colors",
                      on ? "bg-(--selected-bg)" : "hover:bg-accent",
                    )}
                  >
                    <PersonAvatar person={p} size="sm" online={isOnline(p.userId)} />
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                      {p.name}
                      {p.userId === selfId ? (
                        <span className="text-muted-foreground"> (you)</span>
                      ) : null}
                    </span>
                    <span className="text-2xs text-muted-foreground">
                      {isOnline(p.userId) ? "Active" : ""}
                    </span>
                    {on ? <Check className="size-icon-sm text-foreground" aria-hidden /> : null}
                  </button>
                );
              })
            )}
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void confirm()} disabled={picked.length === 0 || busy}>
            {confirmLabel(picked.length)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Browse channels ──────────────────────────────────────────────────────────

export function BrowseChannelsDialog({
  open,
  onOpenChange,
  channels,
  isMember,
  onOpen,
  onJoin,
  onNew,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channels: ChatChannel[];
  isMember: (channelId: string) => boolean;
  onOpen: (channelId: string) => void;
  onJoin: (channelId: string) => Promise<void>;
  onNew: () => void;
}) {
  const [query, setQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return channels
      .filter((c) => c.kind === "channel" && (showArchived ? c.archivedAt : !c.archivedAt))
      .filter((c) => !q || (c.name ?? "").includes(q) || c.topic.toLowerCase().includes(q))
      .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""));
  }, [channels, query, showArchived]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Browse channels</DialogTitle>
          <DialogDescription>
            Every public channel in this workspace, plus private ones you're in.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute top-1/2 left-2.5 size-icon-sm -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              // biome-ignore lint/a11y/noAutofocus: dialog's primary field
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search channels"
              aria-label="Search channels"
              className="pl-8"
            />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowArchived((v) => !v)}
            aria-pressed={showArchived}
            style={{ height: "var(--ctrl-h)" }}
          >
            {showArchived ? "Active" : "Archived"}
          </Button>
        </div>
        <div className="scrollbar-thin -mx-1 flex max-h-96 flex-col gap-0.5 overflow-y-auto px-1">
          {list.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <p className="text-sm text-foreground">
                {showArchived ? "No archived channels." : "No channels match."}
              </p>
              {!showArchived ? (
                <Button size="sm" onClick={onNew}>
                  New channel
                </Button>
              ) : null}
            </div>
          ) : (
            list.map((c) => {
              const member = isMember(c.id);
              return (
                <div
                  key={c.id}
                  className="group flex items-center gap-3 rounded-md px-2 py-2 hover:bg-accent/60"
                >
                  {c.isPrivate ? (
                    <Lock className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />
                  ) : (
                    <Hash className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />
                  )}
                  <button
                    type="button"
                    onClick={() => onOpen(c.id)}
                    className="flex min-w-0 flex-1 flex-col text-left"
                  >
                    <span className="truncate text-sm font-medium text-foreground">{c.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {member ? "Joined" : "Not joined"}
                      {c.topic ? ` · ${c.topic}` : ""}
                    </span>
                  </button>
                  {!member && !c.archivedAt ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void onJoin(c.id)}
                      style={{ height: "var(--ctrl-h-sm)" }}
                    >
                      Join
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onOpen(c.id)}
                      style={{ height: "var(--ctrl-h-sm)" }}
                    >
                      Open
                    </Button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── ⌘J switcher ──────────────────────────────────────────────────────────────

export function ConversationSwitcher({
  open,
  onOpenChange,
  channels,
  people,
  selfId,
  titleOf,
  unreadOf,
  isOnline,
  onPickChannel,
  onPickPerson,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channels: ChatChannel[];
  people: ChatPerson[];
  selfId: string;
  titleOf: (c: ChatChannel) => string;
  unreadOf: (channelId: string) => number;
  isOnline: (id: string) => boolean;
  onPickChannel: (channelId: string) => void;
  onPickPerson: (userId: string) => void;
}) {
  const dmPeople = new Set(
    channels
      .filter((c) => c.kind === "dm")
      .flatMap((c) => (c.dmKey ?? "").split(",").filter((id) => id !== selfId)),
  );
  const live = channels.filter((c) => !c.archivedAt);
  const unread = live.filter((c) => unreadOf(c.id) > 0);
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Jump to a conversation"
      description="Search channels and people"
    >
      <CommandInput placeholder="Jump to a channel or person…" />
      <CommandList>
        <CommandEmpty>Nothing found.</CommandEmpty>
        {unread.length > 0 ? (
          <CommandGroup heading="Unread">
            {unread.map((c) => (
              <CommandItem
                key={`u:${c.id}`}
                value={`unread ${titleOf(c)} ${c.id}`}
                onSelect={() => onPickChannel(c.id)}
              >
                {c.kind === "dm" ? (
                  <span className="size-icon-sm" />
                ) : c.isPrivate ? (
                  <Lock aria-hidden />
                ) : (
                  <Hash aria-hidden />
                )}
                <span className="flex-1 truncate font-medium">{titleOf(c)}</span>
                <span className="text-2xs text-muted-foreground tabular-nums">
                  {unreadOf(c.id)}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        <CommandGroup heading="Channels">
          {live
            .filter((c) => c.kind === "channel")
            .map((c) => (
              <CommandItem
                key={c.id}
                value={`${titleOf(c)} ${c.topic} ${c.id}`}
                onSelect={() => onPickChannel(c.id)}
              >
                {c.isPrivate ? <Lock aria-hidden /> : <Hash aria-hidden />}
                <span className="flex-1 truncate">{titleOf(c)}</span>
              </CommandItem>
            ))}
        </CommandGroup>
        <CommandGroup heading="People">
          {people.map((p) => (
            <CommandItem
              key={p.userId}
              value={`${p.name} ${p.userId}`}
              onSelect={() => onPickPerson(p.userId)}
            >
              <PersonAvatar person={p} size="sm" online={isOnline(p.userId)} className="scale-75" />
              <span className="flex-1 truncate">
                {p.name}
                {p.userId === selfId ? " (you)" : ""}
              </span>
              {!dmPeople.has(p.userId) && p.userId !== selfId ? (
                <span className="text-2xs text-muted-foreground">New message</span>
              ) : null}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
