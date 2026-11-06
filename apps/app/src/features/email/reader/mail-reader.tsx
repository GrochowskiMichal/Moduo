// The reader (MR-10, rebuilt in specs/mail-v3.md §8): the toolbar, the subject,
// the send note, the chip row from the spine's links, the who-card, the
// account's sign-in line and the conversation stack from the engine. Re-reads
// when the engine's threads change (a fetched body swaps in that way).

import { type ReactNode, useEffect, useImperativeHandle, useMemo, useState } from "react";

import type {
  MailAccount,
  MailEngine,
  MailMessage,
  MailThread,
} from "@/lib/runtime.types.mail-engine";

import type { MailThreadLink } from "../commands/spine";
import type { MailBehavior } from "../engine/behavior";
import { ChipRow } from "./chip-row";
import { useAttachmentFiles } from "./engine-reader";
import type { MessageAction } from "./message-card";
import { MessageStack } from "./message-stack";
import type { ReaderMoreActions } from "./more-menu";
import { isDarkTheme, type Person, shortDay } from "./reader-format";
import { type ReaderWhy, useReaderMore } from "./reader-more";
import { type ReaderAction, ReaderToolbar } from "./reader-toolbar";
import { SendNote, type SendNotePort, useSendNote } from "./send-note";
import { type ReaderLinks, useThreadLinks } from "./thread-links";
import { type MailWho, WhoCard } from "./who-card";

/** What `o`, `y`, `b` and the ⋯ menu ask of the open reader. */
export type MailReaderApi = {
  /** `o`: unfold the middle and open every message. */
  expandAll(): void;
  /** ⋯ → Show original: the newest message's raw source. */
  showOriginal(): void;
};

/** The who-card's source and actions. */
export type ReaderWho = {
  lookup(address: string): Promise<MailWho | null>;
  /** The thread sits in New senders (Allow / Block). */
  screened: boolean;
  onDecide?(threadId: string, sender: Person, decision: "allow" | "block"): void;
  onAddContact?(sender: Person): void;
  onOpenContact?(contactId: string): void;
};

export type ReaderSendNotes = {
  port: SendNotePort;
  /** Changes when the Outbox or Drafts may have changed. */
  refreshKey: string;
  onEditOutbox?: (outboxId: string) => void;
  onFix?: Parameters<typeof SendNote>[0]["onFix"];
};

export type MailReaderProps = {
  engine: MailEngine | null;
  threadId: string | null;
  version: number;
  behavior: Pick<MailBehavior, "remoteImages" | "trackerBlocking">;
  /** Page content above the stack (the invite card). */
  renderAbove?: (thread: MailThread) => ReactNode;
  /** Labels… in the ⋯ menu (Gmail threads). */
  menuItems?: (thread: MailThread) => ReactNode;
  /** The ⋯ menu's actions (MV-9); absent leaves only Labels and Show original. */
  more?: ReaderMoreActions | null;
  /** "Why is this in {Tab}?": names from Settings and the Settings link. */
  why?: ReaderWhy | null;
  now?: () => number;
  accounts?: readonly MailAccount[];
  /** Your addresses (lower-case): "you" in to-lines, never the who-card's sender. */
  selfAddresses?: readonly string[];
  /** Contact addresses (lower-case), for the "contacts" image policy. */
  contacts?: ReadonlySet<string>;
  /** Opened from Archive: the "Done" chip. */
  done?: boolean;
  onAction?: (action: ReaderAction | MessageAction, threadId: string, messageId?: string) => void;
  links?: ReaderLinks | null;
  who?: ReaderWho | null;
  sendNotes?: ReaderSendNotes | null;
  panel?: { open: boolean; onToggle: () => void } | null;
  apiRef?: { current: MailReaderApi | null };
};

function useThread(engine: MailEngine | null, threadId: string | null, version: number) {
  const [got, setGot] = useState<{ key: string; thread: MailThread | null } | null>(null);
  const key = `${threadId}:${version}`;
  useEffect(() => {
    if (!engine || !threadId) return;
    let gone = false;
    void engine.getThread(threadId).then(
      (thread) => {
        if (!gone) setGot({ key, thread });
      },
      () => {
        if (!gone) setGot({ key, thread: null });
      },
    );
    return () => {
      gone = true;
    };
  }, [engine, threadId, key]);
  const thread = got?.thread?.row.threadId === threadId ? got.thread : null;
  return { thread, loading: got?.key !== key };
}

function useWho(lookup: ReaderWho["lookup"] | undefined, address: string | null) {
  const [got, setGot] = useState<{ address: string; who: MailWho | null } | null>(null);
  useEffect(() => {
    if (!lookup || !address) return;
    let gone = false;
    void lookup(address).then(
      (who) => !gone && setGot({ address, who }),
      () => !gone && setGot({ address, who: null }),
    );
    return () => {
      gone = true;
    };
  }, [lookup, address]);
  return got && got.address === address ? got.who : null;
}

export function MailReader(props: MailReaderProps) {
  return <ThreadStack key={props.threadId ?? ""} {...props} />;
}

/** The newest message from someone other than you (the who-card's person). */
function senderOf(messages: readonly MailMessage[], self: ReadonlySet<string>): MailMessage | null {
  return (
    [...messages].reverse().find((m) => !self.has(m.from.email.toLowerCase())) ??
    messages.at(-1) ??
    null
  );
}

function ReaderLine({ account }: { account: MailAccount | undefined }) {
  if (account?.syncState !== "reconnect") return null;
  return (
    <p role="status" className="px-4 pb-2 text-xs text-muted-foreground">
      {account.displayName || account.address} needs you to sign in again; your changes wait.
    </p>
  );
}

type Head = {
  thread: MailThread;
  threadLinks: MailThreadLink[];
  self: ReadonlySet<string>;
  nowMs: number;
  account: MailAccount | undefined;
  onOriginal: () => void;
};

/** Toolbar actions: a pressed Task or Note opens what it made; the rest go to the page. */
function toolbarAction(props: MailReaderProps, head: Head, action: ReaderAction) {
  const kind = action === "task" ? "task" : action === "note" ? "note" : null;
  const made = kind ? head.threadLinks.find((l) => l.entity.type === kind) : undefined;
  if (made && props.links) props.links.open(made);
  else props.onAction?.(action, head.thread.row.threadId);
}

/** The who-card for the newest sender who isn't you; "Last:" falls back to their newest mail. */
function ReaderWhoCard({
  thread,
  self,
  nowMs,
  source,
}: {
  thread: MailThread;
  self: ReadonlySet<string>;
  nowMs: number;
  source: ReaderWho;
}) {
  const sender = senderOf(thread.messages, self);
  const who = useWho(source.lookup, sender?.from.email.toLowerCase() ?? null);
  if (!sender) return null;
  const person = sender.from;
  const decide = (decision: "allow" | "block") =>
    source.onDecide?.(thread.row.threadId, person, decision);
  const shown =
    who && !who.lastTouch
      ? { ...who, lastTouch: `Emailed ${shortDay(sender.dateMs, nowMs)}` }
      : who;
  return (
    <WhoCard
      sender={person}
      who={shown}
      screened={source.screened}
      onAllow={() => decide("allow")}
      onBlock={() => decide("block")}
      onAddContact={source.onAddContact ? () => source.onAddContact!(person) : undefined}
      onOpenContact={source.onOpenContact}
    />
  );
}

/** The newest sender who isn't you (Block, Mark Priority); null on your own thread. */
function otherSender(messages: readonly MailMessage[], self: ReadonlySet<string>): Person | null {
  const m = senderOf(messages, self);
  return m && !self.has(m.from.email.toLowerCase()) ? m.from : null;
}

function ReaderHead(props: MailReaderProps & Head) {
  const { thread, threadLinks: links, self, nowMs, account } = props;
  const row = thread.row;
  const note = useSendNote(props.sendNotes?.port, row, props.sendNotes?.refreshKey ?? "");
  const more = useReaderMore({
    engine: props.engine,
    thread,
    version: props.version,
    sender: otherSender(thread.messages, self),
    more: props.more,
    why: props.why,
    labels: props.menuItems?.(thread) ?? null,
    onOriginal: props.engine?.getRawMessage ? props.onOriginal : null,
  });
  return (
    <>
      <ReaderToolbar
        onAction={(a) => toolbarAction(props, props, a)}
        pressed={{
          snooze: row.snoozedUntilMs !== null && row.snoozedUntilMs > nowMs,
          remind: (row.followUpAtMs ?? null) !== null,
          task: links.some((l) => l.entity.type === "task"),
          note: links.some((l) => l.entity.type === "note"),
          pin: row.pinned,
        }}
        menu={more.menu}
        panel={props.panel}
      />
      {more.popover}
      <h2 className="min-w-0 px-4 pt-3 pb-2 text-lg font-semibold text-foreground">
        {row.subject || "(no subject)"}
      </h2>
      {note ? (
        <SendNote
          note={note}
          offline={account?.syncState === "offline"}
          onEditOutbox={props.sendNotes?.onEditOutbox}
          onFix={props.sendNotes?.onFix}
        />
      ) : null}
      {note ? null : (
        <ChipRow
          row={row}
          nowMs={nowMs}
          done={props.done}
          links={links}
          onOpenLink={props.links?.open}
          onUnlink={props.links?.unlink}
          onLink={props.links ? () => props.onAction?.("link", row.threadId) : undefined}
        />
      )}
      <ReaderLine account={account} />
      {props.who ? (
        <ReaderWhoCard thread={thread} self={self} nowMs={nowMs} source={props.who} />
      ) : null}
    </>
  );
}

function useStackState(
  threadId: string | null,
  apiRef: MailReaderProps["apiRef"],
  lastId: string | null,
) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [unfolded, setUnfolded] = useState(false);
  const [allOpen, setAllOpen] = useState(false);
  const [originalId, setOriginalId] = useState<string | null>(null);
  const api = useMemo<MailReaderApi>(
    () => ({
      expandAll: () => {
        setUnfolded(true);
        setAllOpen(true);
      },
      showOriginal: () => setOriginalId(lastId),
    }),
    [lastId],
  );
  useImperativeHandle(apiRef as React.Ref<MailReaderApi> | undefined, () => api, [api]);
  const toggle = (id: string, expanded: boolean) => {
    setAllOpen(false);
    if (!expanded && id === originalId) setOriginalId(null);
    setOpen((o) => ({ ...o, [id]: expanded }));
  };
  return {
    open,
    unfolded,
    allOpen,
    originalId,
    api,
    toggle,
    unfold: () => setUnfolded(true),
    threadId,
  };
}

function ThreadStack(props: MailReaderProps) {
  const { engine, threadId, version, behavior } = props;
  const { thread, loading } = useThread(engine, threadId, version);
  const links = useThreadLinks(props.links, thread ? threadId : null);
  const files = useAttachmentFiles(engine, threadId, thread?.messages ?? []);
  const self = useMemo(
    () => new Set((props.selfAddresses ?? []).map((a) => a.toLowerCase())),
    [props.selfAddresses],
  );
  const stack = useStackState(threadId, props.apiRef, thread?.messages.at(-1)?.id ?? null);
  const [allowed, setAllowed] = useState(false);

  if (!threadId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        No conversation selected
      </div>
    );
  }
  if (!thread) {
    return (
      <div aria-busy={loading} className="flex-1 p-4 text-sm text-muted-foreground">
        {loading ? "Opening…" : "This conversation is no longer here."}
      </div>
    );
  }
  const nowMs = (props.now ?? Date.now)();
  const account = props.accounts?.find((a) => a.id === thread.row.accountId);
  const senderAllowed = allowed || !!thread.imagesAllowed;
  const setImageAllow = engine?.setImageAllow?.bind(engine);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-reader-thread={threadId}>
      <ReaderHead
        {...props}
        thread={thread}
        threadLinks={links}
        self={self}
        nowMs={nowMs}
        account={account}
        onOriginal={stack.api.showOriginal}
      />
      {props.renderAbove?.(thread)}
      <MessageStack
        threadId={threadId}
        messages={thread.messages}
        open={stack.open}
        allOpen={stack.allOpen}
        unfolded={stack.unfolded}
        onToggle={stack.toggle}
        onUnfold={stack.unfold}
        images={(m) => ({
          policy: behavior.remoteImages,
          senderIsContact: props.contacts?.has(m.from.email.toLowerCase()) ?? false,
          senderAllowed,
          loadedForMessage: false,
        })}
        trackerBlocking={behavior.trackerBlocking}
        selfAddresses={self}
        offline={account?.syncState === "offline"}
        darkSurface={isDarkTheme()}
        originalId={stack.originalId}
        loadOriginal={
          engine?.getRawMessage ? (id) => engine.getRawMessage!(id, threadId) : undefined
        }
        onAction={props.onAction ? (a, id) => props.onAction!(a, threadId, id) : undefined}
        onAlwaysImages={
          setImageAllow
            ? (address) => {
                setAllowed(true);
                void setImageAllow(address, true).catch(() => setAllowed(false));
              }
            : undefined
        }
        files={{
          fileUrl: files.available ? files.fileUrl : undefined,
          previewUrl: files.available ? files.previewUrl : undefined,
          onAttachment: files.available ? (a) => void files.ensure(a).catch(() => {}) : undefined,
        }}
      />
    </div>
  );
}
