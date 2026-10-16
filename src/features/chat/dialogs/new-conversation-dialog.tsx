// New conversation (spec §12, prototype round 5 frame 3, "New channel" and
// "New direct message"; ⌘N, the bottom bar's +, the left panel's "+ New
// conversation"). One dialog, two tabs: a channel (name as typed, topic,
// people, private, the announcement switch, and an optional link to a project,
// client or team between Name and People, CV-13; picking an item names an
// unnamed channel after it) or
// a direct message (up to nine people with you; opens the one you already
// have). Picking only yourself offers "Capture a note" instead (§1: no
// notes-to-self conversations). The server decides; its refusal shows inline.

import { Link2 } from "lucide-react";
import { type FormEvent, useState } from "react";

import { PersonAvatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
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
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import type { ModuoRuntime } from "@/lib/runtime.types";
import type { ChatLink, ChatPerson } from "../model";
import {
  CHANNEL_NAME_MAX,
  channelNameProblem,
  DM_MAX_OTHERS,
  dmIntent,
  pickable,
} from "../panel/details-model";
import { ChatLinkPicker } from "../panel/link-section";

export type NewConversationTab = "channel" | "dm";

export type NewChannelInput = {
  name: string;
  topic: string;
  isPrivate: boolean;
  announcement: boolean;
  memberIds: string[];
  /** The optional link (CV-13). */
  link: ChatLink | null;
};

export type NewConversationDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selfId: string;
  /** Everyone you could add (the workspace's people). */
  people: readonly ChatPerson[];
  /** What your role may create (`create_public` / `create_private`). */
  canCreatePublic: boolean;
  canCreatePrivate: boolean;
  initialTab?: NewConversationTab;
  onCreateChannel: (input: NewChannelInput) => Promise<void>;
  onOpenDm: (userIds: string[]) => Promise<void>;
  onCaptureNote: () => void;
  onBrowse: () => void;
  /** For the optional link's picker (CV-13); no link field without them. */
  runtime?: ModuoRuntime | null;
  workspaceId?: string | null;
};

const errorText = (err: unknown) =>
  err instanceof Error && err.message ? err.message : "That didn't work. Try again.";

export function NewConversationDialog(props: NewConversationDialogProps) {
  const { open, onOpenChange } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-4" data-slot="new-conversation">
        {/* Remounts on each open: a fresh form every time. */}
        {open ? <NewConversationForm {...props} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function NewConversationForm({
  onOpenChange,
  selfId,
  people,
  canCreatePublic,
  canCreatePrivate,
  initialTab,
  onCreateChannel,
  onOpenDm,
  onCaptureNote,
  onBrowse,
  runtime = null,
  workspaceId = null,
}: NewConversationDialogProps) {
  const canChannel = canCreatePublic || canCreatePrivate;
  const [tab, setTab] = useState<NewConversationTab>(canChannel ? (initialTab ?? "channel") : "dm");
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  // A role that may only create private channels starts (and stays) private.
  const [isPrivate, setPrivate] = useState(!canCreatePublic);
  const [announcement, setAnnouncement] = useState(false);
  const [link, setLink] = useState<{ link: ChatLink; label: string } | null>(null);
  const [channelPeople, setChannelPeople] = useState<string[]>([]);
  const [dmPeople, setDmPeople] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  const nameProblem = channelNameProblem(name);
  const intent = dmIntent(dmPeople, selfId);

  const run = (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    void work()
      .then(() => onOpenChange(false))
      .catch((err: unknown) => setError(errorText(err)))
      .finally(() => setBusy(false));
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (tab === "channel") {
      setTried(true);
      if (nameProblem) return;
      run(() =>
        onCreateChannel({
          name: name.trim(),
          topic: topic.trim(),
          isPrivate,
          announcement,
          memberIds: channelPeople.filter((id) => id !== selfId),
          link: link?.link ?? null,
        }),
      );
      return;
    }
    if (intent.kind === "self") {
      onOpenChange(false);
      onCaptureNote();
      return;
    }
    if (intent.kind === "open") run(() => onOpenDm(intent.userIds));
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>New conversation</DialogTitle>
        <DialogDescription className="sr-only">
          Make a channel, or start a direct message.
        </DialogDescription>
      </DialogHeader>
      {canChannel ? (
        <SegmentedControl
          aria-label="Conversation type"
          size="sm"
          className="self-start"
          value={tab}
          onValueChange={(v) => {
            setTab(v as NewConversationTab);
            setError(null);
          }}
          items={[
            { value: "channel", label: "Channel" },
            { value: "dm", label: "Direct message" },
          ]}
        />
      ) : null}

      {tab === "channel" ? (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-channel-name">Name</Label>
            <Input
              id="new-channel-name"
              autoFocus
              value={name}
              maxLength={CHANNEL_NAME_MAX}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              aria-invalid={tried && !!nameProblem}
              aria-describedby={tried && nameProblem ? "new-channel-name-problem" : undefined}
            />
            {tried && nameProblem ? (
              <p id="new-channel-name-problem" className="text-xs text-destructive">
                {nameProblem}
              </p>
            ) : null}
          </div>
          {runtime && workspaceId ? (
            <div className="flex flex-col gap-1.5" data-slot="new-channel-link">
              <Label>Link to (optional)</Label>
              <div className="flex min-w-0 items-center gap-2">
                {link ? (
                  <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                    {link.label}
                  </span>
                ) : null}
                <ChatLinkPicker
                  runtime={runtime}
                  workspaceId={workspaceId}
                  onPick={(next, label) => {
                    setLink({ link: next, label: label || "Linked item" });
                    if (!name.trim() && label) setName(label.slice(0, CHANNEL_NAME_MAX));
                    setError(null);
                  }}
                  trigger={
                    <Button type="button" variant="outline" size="sm">
                      <Link2 className="size-icon-sm" aria-hidden />
                      {link ? "Change" : "A project, client or team"}
                    </Button>
                  }
                />
                {link ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setLink(null)}>
                    Remove
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="new-channel-topic">Topic (optional)</Label>
            <Input
              id="new-channel-topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
            />
          </div>
          <PeoplePicker
            id="new-channel-people"
            label="People"
            people={people.filter((p) => p.userId !== selfId)}
            picked={channelPeople}
            onChange={setChannelPeople}
          />
          <Toggle
            id="new-channel-private"
            checked={isPrivate}
            disabled={!canCreatePublic || !canCreatePrivate}
            onCheckedChange={setPrivate}
            title="Private"
            detail="Only the people you add can see it. You can make it private later, not public."
          />
          <Toggle
            id="new-channel-announcement"
            checked={announcement}
            onCheckedChange={setAnnouncement}
            title="Only managers can post"
            detail="For announcements; everyone else reads and reacts. You're its manager."
          />
        </>
      ) : (
        <>
          <PeoplePicker
            id="new-dm-people"
            label={`To (up to ${DM_MAX_OTHERS + 1} people)`}
            people={people}
            picked={dmPeople}
            onChange={(ids) => {
              setDmPeople(ids);
              setError(null);
            }}
            selfId={selfId}
            autoFocus
          />
          {intent.kind === "self" ? (
            <p className="text-sm text-muted-foreground" data-slot="dm-self">
              A conversation with only yourself is a note. Capture one instead.
            </p>
          ) : intent.kind === "too-many" ? (
            <p className="text-sm text-destructive">
              A direct message holds up to {DM_MAX_OTHERS + 1} people. Make a channel instead.
            </p>
          ) : null}
        </>
      )}

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <DialogFooter className="items-center sm:justify-between">
        {tab === "channel" ? (
          <Button
            type="button"
            variant="link"
            size="sm"
            className="px-0 text-muted-foreground"
            onClick={() => {
              onOpenChange(false);
              onBrowse();
            }}
          >
            Browse channels
          </Button>
        ) : (
          <span className="text-xs text-subtle-foreground">
            Opens your conversation with them if you have one.
          </span>
        )}
        <div className="flex gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {tab === "channel" ? (
            <Button type="submit" size="sm" disabled={busy}>
              Create
            </Button>
          ) : intent.kind === "self" ? (
            <Button type="submit" size="sm">
              Capture a note
            </Button>
          ) : (
            <Button type="submit" size="sm" disabled={busy || intent.kind !== "open"}>
              Open
            </Button>
          )}
        </div>
      </DialogFooter>
    </form>
  );
}

function Toggle({
  id,
  checked,
  disabled,
  onCheckedChange,
  title,
  detail,
}: {
  id: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (on: boolean) => void;
  title: string;
  detail: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <Switch
        id={id}
        size="sm"
        className="mt-0.5"
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        aria-describedby={`${id}-detail`}
      />
      <div className="min-w-0">
        <Label htmlFor={id}>{title}</Label>
        <p id={`${id}-detail`} className="text-xs text-muted-foreground">
          {detail}
        </p>
      </div>
    </div>
  );
}

/** Chips for who's picked, and a field that finds people by name (↵ adds the first). */
export function PeoplePicker({
  id,
  label,
  people,
  picked,
  onChange,
  selfId,
  autoFocus,
}: {
  id: string;
  label: string;
  people: readonly ChatPerson[];
  picked: string[];
  onChange: (ids: string[]) => void;
  selfId?: string;
  autoFocus?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const byId = new Map(people.map((p) => [p.userId, p]));
  const offers = focused || query ? pickable(people, picked, query) : [];
  const add = (userId: string) => {
    onChange([...picked, userId]);
    setQuery("");
  };
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {picked.length > 0 ? (
        <div className="flex flex-wrap gap-1" data-slot="picked-people">
          {picked.map((userId) => {
            const p = byId.get(userId);
            const name = p?.name ?? "Member";
            return (
              <Chip
                key={userId}
                shape="full"
                icon={<PersonAvatar name={name} id={userId} src={p?.avatarUrl} size="icon" />}
                onRemove={() => onChange(picked.filter((x) => x !== userId))}
                removeLabel={`Remove ${name}`}
              >
                {userId === selfId ? `${name} (you)` : name}
              </Chip>
            );
          })}
        </div>
      ) : null}
      <Input
        id={id}
        autoFocus={autoFocus}
        placeholder="Add people by name"
        value={query}
        autoComplete="off"
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && query.trim()) {
            e.preventDefault();
            const first = offers[0];
            if (first) add(first.userId);
          } else if (e.key === "Backspace" && !query && picked.length > 0) {
            onChange(picked.slice(0, -1));
          }
        }}
      />
      {offers.length > 0 ? (
        <ul
          aria-label="Suggestions"
          className="flex max-h-48 flex-col gap-px overflow-auto rounded-md border border-hairline p-1"
        >
          {offers.map((p) => (
            <li key={p.userId}>
              <button
                type="button"
                // Before the field's blur closes the list.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => add(p.userId)}
                className="flex h-(--row-h-sm) w-full min-w-0 items-center gap-2 rounded-sm px-2 text-left text-sm outline-none hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <PersonAvatar name={p.name} id={p.userId} src={p.avatarUrl} size="icon" />
                <span className="min-w-0 truncate">
                  {p.userId === selfId ? `${p.name} (you)` : p.name}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
