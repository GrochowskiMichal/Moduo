// `/email` on the rebuilt engine (MR-16 cutover): the shell (MR-9), the reader
// (MR-10), compose (MR-11) and the connect dialog, all reading the mail store
// the app-chrome `MailEngineProvider` fills. Search is ⌘K (MR-13) and the
// settings live in Settings → Mail (MR-15).

import { type ComponentProps, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { getRuntime } from "@/lib/runtime";
import type { MailComposeEngine } from "@/lib/runtime.types.mail-compose";
import type {
  MailAccount,
  MailEngine,
  MailMailbox,
  MailMessage,
  MailThread,
  MailThreadRow,
} from "@/lib/runtime.types.mail-engine";
import { undoToast } from "@/lib/undo-toast";

import type {
  MailDropTarget,
  MailSpineCommands,
  SpineEntity,
  SpineResult,
} from "../commands/spine";
import { createMailCommands } from "../commands/triage";
import type { MailAlias } from "../compose/aliases";
import { MailComposer } from "../compose/mail-composer";
import { applyMailtoPrefill, drainMailto, type MailtoPrefill } from "../compose/mailto";
import { type ComposeKind, type ComposeOpenSpec, createComposeSession } from "../compose/session";
import type { MailSnippet } from "../compose/snippets";
import type { MailKeyId } from "../keys";
import { ContactMailPanel } from "../panels/contact-mail";
import { useMailWithPerson } from "../panels/mail-with-person";
import type { TodayEvent } from "../panels/today-events";
import { TodayPanel, type TodayTask } from "../panels/today-panel";
import { addInviteToCalendar, engineInviteLoader, engineRsvp } from "../reader/engine-reader";
import { InviteCard, type MailInvite, type MailPartstat } from "../reader/invite-card";
import { MailReader } from "../reader/mail-reader";
import { type MailStore, mailStore } from "../store/mail-store";
import { useMailStore } from "../store/use-mail-store";
import { suggestContacts } from "../suggest-contact";
import { SubscriptionsView } from "../views/subscriptions";
import { useSubscriptionUnsubscribe } from "../views/use-subscription-unsubscribe";
import { EmailConnectDialog } from "./email-connect-dialog";
import { EmailSnoozePicker } from "./email-snooze-picker";
import { useMailLabels } from "./mail-labels";
import { MailMoveDialog } from "./mail-move-dialog";
import { localDate, nextEventSlot } from "./mail-page-wiring";
import { MailShell, type MailShellApi } from "./mail-shell";

const COMPOSE_INTENTS: Partial<Record<MailKeyId, ComposeKind>> = {
  "email.compose": "new",
  "email.reply": "reply",
  "email.reply-all": "reply-all",
  "email.forward": "forward",
};

type Person = { name: string; email: string };

function replyRecipients(kind: ComposeKind, last: MailMessage | null, self: string) {
  if (!last || kind === "new" || kind === "forward") return { to: "", cc: "" };
  if (kind === "reply") return { to: last.from.email, cc: "" };
  const others = (p: Person) => p.email.toLowerCase() !== self.toLowerCase();
  return {
    to: last.from.email,
    cc: [...last.to, ...last.cc]
      .filter(others)
      .map((p) => p.email)
      .join(", "),
  };
}

/** What a reply, reply-all, forward or new message opens with. */
export function composeSpec(
  kind: ComposeKind,
  thread: MailThread | null,
  account: MailAccount,
): ComposeOpenSpec {
  const last = thread?.messages.at(-1) ?? null;
  const threaded = kind !== "forward" && last !== null;
  return {
    kind,
    placement: thread ? "inline" : "pane",
    accountId: account.id,
    threadId: threaded ? (thread?.row.threadId ?? null) : null,
    fromAddr: account.address,
    fromName: account.displayName || null,
    ...replyRecipients(kind, last, account.address),
    bcc: "",
    subject: thread ? `${kind === "forward" ? "Fwd" : "Re"}: ${thread.row.subject}` : "",
    bodyHtml: "",
    inReplyTo: threaded ? last.messageId : null,
    references: threaded ? [last.messageId] : [],
    attachments: [],
    fromInbox: thread !== null,
  };
}

export type MailLinkPickerArgs = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (target: SpineEntity) => void;
};

export type MailPageProps = {
  store?: MailStore;
  /** The compose port; defaults to the runtime's (desktop) when present. */
  compose?: MailComposeEngine | null;
  initialThreadId?: string | null;
  onConsumeThreadDeepLink?: () => void;
  /** Spine gestures (t, l, n, drag, event); absent until the route wires them. */
  spine?: MailSpineCommands | null;
  /** Today's open tasks, the Today panel's drop targets. */
  todayTasks?: readonly TodayTask[];
  /** Today's calendar events, shown in the Today panel beside the tasks. */
  todayEvents?: readonly TodayEvent[];
  /** The `l` target picker (the spine's registry search). */
  renderLinkPicker?: (args: MailLinkPickerArgs) => ReactNode;
  aliases?: MailAlias[];
  snippets?: MailSnippet[];
  /** Contacts for autocomplete and "Add as contact" (lower-case addresses). */
  contacts?: { name: string; email: string }[];
  onAddContact?: (email: string, name: string) => void;
  /** An invite's parsed event; absent means the card isn't shown. */
  loadInvite?: (messageId: string) => Promise<MailInvite | null>;
  onRsvp?: (messageId: string, status: MailPartstat) => Promise<void> | void;
  now?: () => number;
};

const errText = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback;

/**
 * `t` convert with the undo toast plus "Also mark done": Done chains onto the
 * convert's plan, and the follow-up toast's one Undo reverts both (AC33).
 */
async function runConvert(spine: MailSpineCommands, row: MailThreadRow) {
  let res: SpineResult;
  try {
    res = await spine.convert(row);
  } catch (e) {
    toast.error(errText(e, "That didn't go through. Nothing was changed."));
    return;
  }
  undoToast("Task created", {
    onUndo: () => void res.undo(),
    link: {
      label: "Also mark done",
      onClick: () =>
        void spine.alsoDone(res, row).then(
          (ok) =>
            ok && undoToast("Task created and marked done", { onUndo: () => void res.undo() }),
          (e) => toast.error(errText(e, "Couldn't mark it done.")),
        ),
    },
  });
}

/** Runs a spine gesture with the one undo grammar (DF-5). */
async function runGesture(label: string, run: () => Promise<SpineResult>) {
  try {
    const res = await run();
    undoToast(label, { onUndo: () => void res.undo() });
  } catch (e) {
    toast.error(errText(e, "That didn't go through. Nothing was changed."));
  }
}

/** "Add to Moduo calendar" from an invite card, with the undo toast (AC18). */
function addInviteGesture(spine: MailSpineCommands | null, row: MailThreadRow, inv: MailInvite) {
  if (spine) void runGesture("Added to Moduo calendar", () => addInviteToCalendar(spine, row, inv));
}

/**
 * The Contact panel over the engine: "All mail with this person" searches all
 * synced mail for the address; the open thread shows until it answers.
 */
function PersonMail({
  engine,
  version,
  thread,
  ...rest
}: { engine: MailEngine | null; version: number; thread: MailThread } & Omit<
  ComponentProps<typeof ContactMailPanel>,
  "rows" | "messages"
>) {
  const fallback = useMemo(
    () => ({
      rows: [thread.row],
      messages: thread.messages.map((m) => ({ ...m, threadId: thread.row.threadId })),
    }),
    [thread],
  );
  const found = useMailWithPerson(engine, rest.email, version, fallback);
  return <ContactMailPanel {...rest} rows={found.rows} messages={found.messages} />;
}

function InviteSlot({
  messageId,
  loadInvite,
  onRsvp,
  onAddToCalendar,
}: {
  messageId: string;
  loadInvite: (messageId: string) => Promise<MailInvite | null>;
  onRsvp?: MailPageProps["onRsvp"];
  onAddToCalendar: (invite: MailInvite) => void;
}) {
  const [invite, setInvite] = useState<MailInvite | null>(null);
  useEffect(() => {
    let gone = false;
    void loadInvite(messageId).then(
      (i) => !gone && setInvite(i),
      () => {},
    );
    return () => {
      gone = true;
    };
  }, [messageId, loadInvite]);
  if (!invite) return null;
  return (
    <div className="px-4 pb-2">
      <InviteCard
        invite={invite}
        onRsvp={onRsvp && invite.organizer ? (status) => onRsvp(messageId, status) : undefined}
        onAddToCalendar={() => onAddToCalendar(invite)}
      />
    </div>
  );
}

export function MailPage({
  store = mailStore,
  compose,
  initialThreadId = null,
  onConsumeThreadDeepLink,
  spine = null,
  todayTasks = [],
  todayEvents = [],
  renderLinkPicker,
  aliases,
  snippets,
  contacts = [],
  onAddContact,
  loadInvite,
  onRsvp,
  now = Date.now,
}: MailPageProps) {
  const engine = useMailStore((s) => s.engine, store);
  const behavior = useMailStore((s) => s.behavior, store);
  const accounts = useMailStore((s) => s.accounts, store);
  const version = useMailStore((s) => s.threadsVersion, store);
  const commands = useMemo(() => createMailCommands(store), [store]);
  const shell = useRef<MailShellApi | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [snoozeIds, setSnoozeIds] = useState<string[]>([]);
  const [move, setMove] = useState<{ ids: string[]; boxes: MailMailbox[] } | null>(null);
  const [linkFor, setLinkFor] = useState<MailThreadRow | null>(null);
  const [current, setCurrent] = useState<string | null>(initialThreadId);
  const [subs, setSubs] = useState<MailThreadRow[] | null>(null);
  const [dismissedAdd, setDismissedAdd] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (initialThreadId) onConsumeThreadDeepLink?.();
  }, [initialThreadId, onConsumeThreadDeepLink]);

  const port = compose === undefined ? (getRuntime()?.email?.compose ?? null) : compose;
  const session = useMemo(
    () =>
      port
        ? createComposeSession({
            port,
            settings: () => {
              const b = store.getState().behavior;
              return { undoSeconds: b.undoSendSeconds, doneOnSend: b.doneOnSend };
            },
            markDone: (threadId) => commands.apply({ kind: "done", threadIds: [threadId] }),
            setFollowUp: engine?.setFollowUp
              ? (threadId, dueMs) => engine.setFollowUp!(threadId, dueMs)
              : undefined,
            // The undo-send toast (X22): Undo cancels and reopens, Edit reopens to change it.
            showSent: (_handle, actions) => {
              const seconds = store.getState().behavior.undoSendSeconds;
              toast("Sending…", {
                duration: seconds * 1000,
                action: { label: "Undo", onClick: actions.undo },
                cancel: { label: "Edit", onClick: actions.edit },
              });
            },
          })
        : null,
    [port, store, commands, engine],
  );

  /** A thread's row: the loaded window first, else the engine. */
  const rowOf = async (threadId: string): Promise<MailThreadRow | null> =>
    shell.current?.row(threadId) ??
    (engine ? ((await engine.getThread(threadId))?.row ?? null) : null);

  const openCompose = async (
    kind: ComposeKind,
    threadId: string | null,
    to?: string,
    prefill?: MailtoPrefill,
  ) => {
    if (!session) return;
    const thread = threadId && engine ? await engine.getThread(threadId) : null;
    const accountId = thread?.row.accountId ?? accounts[0]?.id;
    const account = accounts.find((a) => a.id === accountId);
    if (!account) return;
    const spec = composeSpec(kind, thread, account);
    await session.open(prefill ? applyMailtoPrefill(spec, prefill) : to ? { ...spec, to } : spec);
  };
  const openComposeRef = useRef(openCompose);
  openComposeRef.current = openCompose;

  // `mailto:` deep links from macOS (AC24): drain what is pending now (a cold
  // launch delivers it before this mounts), then on every nudge from Rust.
  const canCompose = !!session && accounts.length > 0;
  useEffect(() => {
    const take = port?.takeMailto?.bind(port);
    if (!canCompose || !take) return;
    const drain = () =>
      void drainMailto(take, (p) => openComposeRef.current("new", null, undefined, p)).catch(
        () => {},
      );
    drain();
    return port?.onMailto?.(drain);
  }, [port, canCompose]);

  const gesture = (
    label: string,
    threadIds: string[],
    run: (row: MailThreadRow) => Promise<SpineResult>,
  ) => {
    const id = threadIds[0];
    if (!spine || !id) return;
    void rowOf(id).then((row) => (row ? runGesture(label, () => run(row)) : undefined));
  };

  const openMove = async (threadIds: string[]) => {
    if (!engine || threadIds.length === 0) return;
    const row = await rowOf(threadIds[0]!);
    const accountId = row?.accountId ?? accounts[0]?.id;
    if (!accountId) return;
    const boxes = await engine.listMailboxes(accountId);
    setMove({ ids: threadIds, boxes });
  };

  const onIntent = (intent: MailKeyId, threadIds: string[]) => {
    const kind = COMPOSE_INTENTS[intent];
    if (kind) {
      void openCompose(kind, threadIds[0] ?? null);
      return;
    }
    if (intent === "email.snooze") setSnoozeIds(threadIds);
    else if (intent === "email.move") void openMove(threadIds);
    else if (intent === "email.convert" && spine && threadIds[0])
      void rowOf(threadIds[0]).then((row) => (row ? runConvert(spine, row) : undefined));
    else if (intent === "email.note") gesture("Note created", threadIds, (row) => spine!.note(row));
    else if (intent === "email.link" && spine && threadIds[0])
      void rowOf(threadIds[0]).then((row) => setLinkFor(row));
  };

  const onDropThread = (threadId: string, target: MailDropTarget) =>
    gesture(target.kind === "day" ? "Task due today" : "Linked to task", [threadId], (row) =>
      spine!.drop(row, target),
    );

  const createEvent = (threadId: string, at = nextEventSlot(now())) =>
    gesture("Event created", [threadId], (row) => spine!.createEvent(row, at));

  const openSubscriptions = async () => {
    if (!engine) return;
    const page = await engine.listThreads({
      view: { kind: "unified", role: "inbox" },
      tab: { kind: "newsletters" },
      limit: 500,
    });
    setSubs(page.rows);
  };

  const subsUnsub = useSubscriptionUnsubscribe(engine);
  const labels = useMailLabels({
    engine,
    accounts,
    rowOf,
    act: (kind, ids, args) => void shell.current?.act(kind, ids, args),
  });

  const contactSet = useMemo(() => new Set(contacts.map((c) => c.email.toLowerCase())), [contacts]);
  const own = useMemo(() => new Set(accounts.map((a) => a.address.toLowerCase())), [accounts]);

  const renderAbove = (thread: MailThread) => {
    const sender = [...thread.messages]
      .reverse()
      .find((m) => !own.has(m.from.email.toLowerCase()))?.from;
    const suggestions = suggestContacts(thread.messages, {
      ownAddresses: own,
      contacts: contactSet,
      dismissed: dismissedAdd,
    });
    const suggest = sender
      ? suggestions.find((x) => x.email === sender.email.toLowerCase())
      : undefined;
    // The engine's invite reader unless the host passed its own.
    const invites = loadInvite ?? engineInviteLoader(engine, thread.row.threadId);
    const rsvp = onRsvp ?? engineRsvp(engine, thread.row.threadId);
    return (
      <>
        {invites
          ? thread.messages
              .filter((m) => m.hasInvite)
              .map((m) => (
                <InviteSlot
                  key={m.id}
                  messageId={m.id}
                  loadInvite={invites}
                  onRsvp={rsvp}
                  onAddToCalendar={(inv) => addInviteGesture(spine, thread.row, inv)}
                />
              ))
          : null}
        {sender ? (
          <details className="px-0 pb-2">
            <summary className="cursor-default px-4 text-xs text-muted-foreground">
              Mail with {sender.name || sender.email}
            </summary>
            <PersonMail
              engine={engine}
              version={version}
              thread={thread}
              email={sender.email}
              name={sender.name}
              nowMs={now()}
              suggestAdd={Boolean(suggest && onAddContact)}
              onOpenThread={(id) => shell.current?.open(id)}
              onPreview={(entry) => shell.current?.open(entry.threadId)}
              onAddContact={(email, name) => {
                onAddContact?.(email, name);
                setDismissedAdd((s) => new Set([...s, email.toLowerCase()]));
              }}
            />
          </details>
        ) : null}
      </>
    );
  };

  return (
    <div className="relative flex h-full min-h-0 w-full flex-col" data-slot="mail-page">
      <div className="flex min-h-0 flex-1">
        <MailShell
          store={store}
          now={now}
          density={behavior.density}
          previewLines={behavior.previewLines}
          showHints={behavior.shortcutHints}
          screenerOn={behavior.screener}
          initialThreadId={initialThreadId}
          apiRef={shell}
          onConnect={() => setConnectOpen(true)}
          onReconnect={() => setConnectOpen(true)}
          onIntent={onIntent}
          onOpenSubscriptions={engine ? () => void openSubscriptions() : undefined}
          subscriptionsActive={subs !== null}
          onViewChange={() => setSubs(null)}
          onCursorChange={setCurrent}
          renderSelectionActions={labels.selectionActions}
          renderReader={(threadId) => {
            if (subs) {
              return (
                <div className="pane-scroll min-h-0 flex-1 overflow-y-auto">
                  {subsUnsub.confirm}
                  <SubscriptionsView
                    rows={subs}
                    nowMs={now()}
                    unsubscribed={subsUnsub.unsubscribed}
                    onUnsubscribe={(g) => void subsUnsub.unsubscribe(g.email, g.threadIds)}
                    onDoneAll={(g) => {
                      void shell.current?.act("done", g.threadIds);
                      setSubs(
                        (rows) => rows?.filter((r) => !g.threadIds.includes(r.threadId)) ?? null,
                      );
                    }}
                  />
                </div>
              );
            }
            return (
              <MailReader
                engine={engine}
                threadId={threadId}
                version={version}
                behavior={behavior}
                renderAbove={renderAbove}
                renderMenu={labels.readerMenu}
              />
            );
          }}
        />
        {spine ? (
          <div className="w-60 shrink-0 border-l border-hairline">
            <TodayPanel
              tasks={todayTasks}
              events={todayEvents}
              date={localDate(now())}
              onDropThread={onDropThread}
              onCreateEvent={current ? () => createEvent(current) : undefined}
            />
          </div>
        ) : null}
      </div>
      {session ? (
        <div className="absolute right-4 bottom-4 w-96 max-w-full">
          <MailComposer
            session={session}
            spellCheck={behavior.spellCheck}
            aliases={aliases}
            snippets={snippets}
            contacts={contacts}
            stageFile={
              port
                ? async (f) => port.stageAttachment(new Uint8Array(await f.arrayBuffer()))
                : undefined
            }
            pickFiles={port ? () => port.pickAttachments() : undefined}
          />
        </div>
      ) : null}
      <EmailSnoozePicker
        open={snoozeIds.length > 0}
        onOpenChange={(o) => (o ? null : setSnoozeIds([]))}
        onPick={(at) => {
          const ids = snoozeIds;
          setSnoozeIds([]);
          // Through the shell so the list advances like Done (AC14).
          void shell.current?.act("snooze", ids, { untilMs: at.getTime() });
        }}
      >
        <span aria-hidden className="pointer-events-none absolute top-2 left-1/3 h-0 w-0" />
      </EmailSnoozePicker>
      {move ? (
        <MailMoveDialog
          mailboxes={move.boxes}
          onClose={() => setMove(null)}
          onPick={(mailboxId) => {
            const ids = move.ids;
            setMove(null);
            void shell.current?.act("move", ids, { mailboxId });
          }}
        />
      ) : null}
      {labels.dialog}
      {renderLinkPicker && linkFor
        ? renderLinkPicker({
            open: true,
            onOpenChange: (o) => (o ? null : setLinkFor(null)),
            onPick: (target) => {
              const row = linkFor;
              setLinkFor(null);
              if (spine) void runGesture("Linked", () => spine.link(row, target));
            },
          })
        : null}
      {connectOpen ? <EmailConnectDialog open onOpenChange={setConnectOpen} /> : null}
    </div>
  );
}
