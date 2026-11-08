// `/email` on the rebuilt engine (MR-16 cutover): the shell (MR-9), the reader
// (MR-10), compose (MR-11) and the connect dialog, all reading the mail store
// the app-chrome `MailEngineProvider` fills. Search is ⌘K (MR-13) and the
// settings live in Settings → Mail (MR-15).

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { getRuntime } from "@/lib/runtime";
import type { MailComposeEngine, MailDraftRow } from "@/lib/runtime.types.mail-compose";
import type {
  MailAccount,
  MailMailbox,
  MailMessage,
  MailThread,
  MailThreadRow,
  MailView,
} from "@/lib/runtime.types.mail-engine";
import { undoToast } from "@/lib/undo-toast";

import { openReferenceFull } from "../../spine/references/open";
import type {
  MailDropTarget,
  MailSpineCommands,
  SpineEntity,
  SpineResult,
} from "../commands/spine";
import { createMailCommands } from "../commands/triage";
import { personEntry } from "../compose/address-list";
import { type MailAlias, openWithAlias } from "../compose/aliases";
import { applyMailtoPrefill, drainMailto, type MailtoPrefill } from "../compose/mailto";
import {
  type ComposeDeps,
  type ComposeKind,
  type ComposeOpenSpec,
  createComposeSession,
} from "../compose/session";
import type { MailSnippet } from "../compose/snippets";
import type { MailKeyId } from "../keys";
import type { MailContactDetail } from "../panels/contact-view";
import {
  createEventAllowed,
  MailSidePanel,
  showMailPanel,
  toggleMailPanel,
} from "../panels/side-panel";
import type { MailTaskDetail } from "../panels/task-view";
import type { TodayEvent } from "../panels/today-events";
import type { TodayTask } from "../panels/today-panel";
import type { MailInvite, MailPartstat } from "../reader/invite-card";
import { MailReader } from "../reader/mail-reader";
import { bumpThreadLinks, useThreadLinks } from "../reader/thread-links";
import type { MailWho } from "../reader/who-card";
import { type MailPanelView, type MailStore, mailStore } from "../store/mail-store";
import { useMailStore } from "../store/use-mail-store";
import { SubscriptionsView } from "../views/subscriptions";
import { useSubscriptionUnsubscribe } from "../views/use-subscription-unsubscribe";
import { ConnectSlot, type MailConnectRequest } from "./connect-slot";
import { useSnoozePicker } from "./email-snooze-picker";
import { useMailLabels } from "./mail-labels";
import { MailMoveDialog } from "./mail-move-dialog";
import { localDate, nextEventSlot } from "./mail-page-wiring";
import { AttachmentsPlace, FailedSends, OutboxPlace, useNotSentThreadIds } from "./mail-places";
import { MailShell, type MailShellApi } from "./mail-shell";
import { KEYED_TOAST } from "./mail-toast";
import { makeTasks } from "./make-tasks";
import { useUndoSendToast } from "./undo-send-toast";
import { draftOpenSpec, useComposeExtras } from "./use-compose-extras";
import { useComposerSlot } from "./use-composer-slot";
import { useReaderWiring } from "./use-reader-wiring";

const COMPOSE_INTENTS: Partial<Record<MailKeyId, ComposeKind>> = {
  "email.compose": "new",
  "email.reply": "reply",
  "email.reply-all": "reply-all",
  "email.forward": "forward",
};

type Person = { name: string; email: string };

function replyRecipients(kind: ComposeKind, last: MailMessage | null, self: string) {
  if (!last || kind === "new" || kind === "forward") return { to: "", cc: "" };
  if (kind === "reply") return { to: personEntry(last.from), cc: "" };
  const others = (p: Person) => p.email.toLowerCase() !== self.toLowerCase();
  return {
    to: personEntry(last.from),
    cc: [...last.to, ...last.cc].filter(others).map(personEntry).join(", "),
  };
}

/** What a reply, reply-all, forward or new message opens with. */
export function composeSpec(
  kind: ComposeKind,
  thread: MailThread | null,
  account: MailAccount,
  /** A message's own reply / forward (the reader's per-message actions); else the newest. */
  messageId?: string,
): ComposeOpenSpec {
  // `c` with a thread open starts a fresh message from that account, not a reply.
  if (kind === "new") thread = null;
  const picked = messageId ? thread?.messages.find((m) => m.id === messageId) : undefined;
  const last = picked ?? thread?.messages.at(-1) ?? null;
  const threaded = kind !== "forward" && last !== null;
  return {
    kind,
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
  /** What the thread already links to: those rows read "Linked" and toggle an unlink. */
  linked?: readonly SpineEntity[];
  onUnlink?: (target: SpineEntity) => void;
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
  /** Custom inbox tabs from Settings, in position order, at most three (AC2); `domains`
   *  lets "Why is this in {Tab}?" name the domain a tab collects. */
  customTabs?: readonly { id: string; label: string; domains?: readonly string[] }[];
  /** Rules from Settings by item id, named for "Why is this in {Tab}?" (MV-9). */
  rules?: readonly { id: string; label: string }[];
  /** Priority people from Settings (item id, lower-case address), for ⋯ → Mark Priority. */
  priorityPeople?: readonly { id: string; address: string }[];
  /** Sync now for one account (Retry now, AC5); defaults to the runtime's. */
  syncAccount?: (accountId: string) => Promise<unknown> | void;
  /** Contacts for autocomplete and "Add as contact" (lower-case addresses). */
  contacts?: { name: string; email: string }[];
  onAddContact?: (email: string, name: string) => void;
  /** The reader's who-card: what Moduo knows about a sender address (MV-8). */
  whoFor?: (address: string) => Promise<MailWho | null>;
  /** The side panel's Contact view: the open tasks, notes and meetings with a contact. */
  contactDetailFor?: (address: string) => Promise<MailContactDetail | null>;
  /** The side panel's Task view: a linked task's status, due date, project and notes. */
  taskFor?: (taskId: string) => MailTaskDetail | null;
  /** Renames a task (the title `t` opens editable, specs/mail-improve.md AC13). */
  onRenameTask?: (taskId: string, title: string) => void;
  /** An invite's parsed event; absent means the card isn't shown. */
  loadInvite?: (messageId: string) => Promise<MailInvite | null>;
  onRsvp?: (messageId: string, status: MailPartstat) => Promise<void> | void;
  now?: () => number;
};

/** Changes whenever the Outbox or Drafts places may need a re-read. */
const selPlaceKey = (s: ReturnType<MailStore["getState"]>) =>
  `${s.threadsVersion}:${s.counts?.outbox ?? 0}`;

const errText = (e: unknown, fallback: string) =>
  e instanceof Error && e.message ? e.message : fallback;

/**
 * `t` convert with the undo toast plus "Also mark done": Done chains onto the
 * convert's plan, and the follow-up toast's one Undo reverts both (AC33).
 */
async function runConvert(
  spine: MailSpineCommands,
  row: MailThreadRow,
  onMade?: (taskId: string | null) => void,
) {
  let res: SpineResult;
  try {
    res = await spine.convert(row);
  } catch (e) {
    toast.error(errText(e, "That didn't go through. Nothing was changed."));
    return;
  }
  // The reader's chips and the side panel's Task view show the new task (MV-8, §10).
  bumpThreadLinks();
  onMade?.(res.plan?.taskId ?? null);
  const undo = () => void res.undo().then(bumpThreadLinks, () => {});
  undoToast("Task created", {
    onUndo: undo,
    // One at a time, like the triage toast: the newest task's replaces the last.
    id: "mail-task",
    className: KEYED_TOAST,
    // A button with its key, like Undo (specs/mail-improve.md AC13).
    link: {
      label: "Also mark the email Done",
      keyHint: "e",
      onClick: () =>
        void spine.alsoDone(res, row).then(
          (ok) => ok && undoToast("Task created and marked done", { onUndo: undo }),
          (e) => toast.error(errText(e, "Couldn't mark it done.")),
        ),
    },
  });
}

/** Runs a spine gesture with the one undo grammar (DF-5); the reader's chips re-read. */
async function runGesture(label: string, run: () => Promise<{ undo: () => Promise<void> }>) {
  try {
    const res = await run();
    bumpThreadLinks();
    undoToast(label, { onUndo: () => void res.undo().then(bumpThreadLinks, () => {}) });
  } catch (e) {
    toast.error(errText(e, "That didn't go through. Nothing was changed."));
  }
}

/** The side panel's Today view: only with the spine (its drops and tasks need it). */
function todayView<T>(spine: MailSpineCommands | null, today: T): T | null {
  return spine ? today : null;
}

/** An action on the open thread, absent with none open. */
function forThread(threadId: string | null, act: (threadId: string) => void) {
  return threadId ? () => act(threadId) : undefined;
}

/** A known display name for an address (contacts, correspondents, the open thread). */
function knownName(
  email: string,
  lists: readonly (readonly { name: string; email: string }[] | undefined)[],
): string | null {
  for (const list of lists) {
    const hit = list?.find((p) => p.name && p.email.toLowerCase() === email);
    if (hit) return hit.name;
  }
  return null;
}

/** The compose port (prop wins over the runtime) and its session. */
function useComposeSession(
  compose: MailPageProps["compose"],
  store: NonNullable<MailPageProps["store"]>,
  shell: { current: MailShellApi | null },
  engine: ReturnType<typeof mailStore.getState>["engine"],
  sent: { current: ComposeDeps["showSent"] },
) {
  // The prop wins, then the provider's (the fixture's), then the runtime's (desktop).
  const provided = useMailStore((s) => s.compose, store);
  const port = compose === undefined ? (provided ?? getRuntime()?.email?.compose ?? null) : compose;
  const session = useMemo(
    () =>
      port
        ? createComposeSession({
            port,
            settings: () => {
              const b = store.getState().behavior;
              return { undoSeconds: b.undoSendSeconds, doneOnSend: b.doneOnSend };
            },
            // Through the shell: a send that takes the thread out of the view advances
            // like `e`, and undoing the send brings it back (specs/mail-improve.md AC12).
            markDone: async (threadId) => {
              const entry = await shell.current?.act("done", [threadId], undefined, {
                quiet: true,
              });
              return entry ? () => shell.current?.undo(entry) ?? Promise.resolve() : undefined;
            },
            onReopen: (threadId) => shell.current?.open(threadId),
            setFollowUp: engine?.setFollowUp
              ? (threadId, dueMs) => engine.setFollowUp!(threadId, dueMs)
              : undefined,
            // The undo-send toast (spec §5): the page fills it (it knows names and the clock).
            showSent: (handle, actions, info) => sent.current?.(handle, actions, info),
          })
        : null,
    [port, store, shell, engine, sent],
  );
  return { port, session };
}

/** Rule and custom-tab names for "Why is this in {Tab}?" (MV-9). */
function useWhyNames(rules: MailPageProps["rules"], customTabs: MailPageProps["customTabs"]) {
  return useMemo(() => ({ rules: rules ?? [], customTabs: customTabs ?? [] }), [rules, customTabs]);
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
  customTabs,
  rules,
  priorityPeople,
  syncAccount,
  contacts = [],
  onAddContact,
  whoFor,
  contactDetailFor,
  taskFor,
  onRenameTask,
  loadInvite,
  onRsvp,
  now = Date.now,
}: MailPageProps) {
  const engine = useMailStore((s) => s.engine, store);
  const behavior = useMailStore((s) => s.behavior, store);
  const accounts = useMailStore((s) => s.accounts, store);
  const version = useMailStore((s) => s.threadsVersion, store);
  const panelOpen = useMailStore((s) => s.panel !== null, store);
  const commands = useMemo(() => createMailCommands(store), [store]);
  const shell = useRef<MailShellApi | null>(null);
  const [connect, setConnect] = useState<MailConnectRequest | null>(null);
  // Through the shell so the list advances like Done (AC14).
  const snooze = useSnoozePicker(now, (ids, untilMs) => {
    void shell.current?.act("snooze", ids, { untilMs });
  });
  const [move, setMove] = useState<{ ids: string[]; boxes: MailMailbox[] } | null>(null);
  const [linkFor, setLinkFor] = useState<MailThreadRow | null>(null);
  const [current, setCurrent] = useState<string | null>(initialThreadId);
  const [subs, setSubs] = useState<MailThreadRow[] | null>(null);
  const [files, setFiles] = useState(false);
  const [view, setView] = useState<MailView | null>(null);
  // The task `t` just made: its title opens editable in the Task view.
  const [editTitleFor, setEditTitleFor] = useState<string | null>(null);

  useEffect(() => {
    if (initialThreadId) onConsumeThreadDeepLink?.();
  }, [initialThreadId, onConsumeThreadDeepLink]);

  const names = useRef<(email: string) => string | null>(() => null);
  const undoSend = useUndoSendToast({ now, nameFor: (email) => names.current(email) });
  const { port, session } = useComposeSession(compose, store, shell, engine, undoSend.sent);
  const extras = useComposeExtras({ port, session, engine, accounts });
  const composer = useComposerSlot({
    session,
    port,
    engine,
    accounts,
    extras,
    aliases,
    snippets,
    contacts,
    spellCheck: behavior.spellCheck,
    now,
  });
  names.current = (email) =>
    knownName(email, [contacts, current ? shell.current?.row(current)?.senders : undefined]);
  const placeKey = useMailStore(selPlaceKey, store);
  const notSent = useNotSentThreadIds(port, placeKey);

  /** Reopens a saved draft (Fix and send, Outbox Edit; AC11); a reply opens under its thread. */
  const openDraft = (draft: MailDraftRow) => {
    if (draft.threadId) shell.current?.open(draft.threadId);
    void session?.open(draftOpenSpec(draft));
  };
  /** Sends a failed draft again, optionally without one file (AC19). */
  const resend = async (draft: MailDraftRow, without?: string) => {
    if (!port) return;
    try {
      const attachments = without
        ? draft.doc.attachments.filter((a) => a.filename !== without)
        : draft.doc.attachments;
      await port.saveDraft({
        draftId: draft.id,
        accountId: draft.accountId,
        threadId: draft.threadId,
        doc: { ...draft.doc, attachments, lastError: null },
      });
      await port.queueSend({
        draftId: draft.id,
        undoSeconds: store.getState().behavior.undoSendSeconds,
      });
      toast(without ? `Sending without ${without}` : "Sending again");
    } catch (e) {
      toast.error(errText(e, "Couldn't send it. It's still in Drafts."));
    }
  };
  const editOutbox = async (outboxId: string) => {
    if (!port) return;
    const { draftId } = await port.undoSend(outboxId);
    const draft = draftId ? await port.getDraft(draftId) : null;
    if (draft) openDraft(draft);
  };
  const retryAccount = (accountId: string) =>
    void Promise.resolve(
      (syncAccount ?? ((id: string) => getRuntime()?.email?.syncNow({ accountId: id })))(accountId),
    ).catch((e) => toast.error(errText(e, "Couldn't sync that account.")));

  /** A thread's row: the loaded window first, else the engine. */
  const rowOf = async (threadId: string): Promise<MailThreadRow | null> =>
    shell.current?.row(threadId) ??
    (engine ? ((await engine.getThread(threadId))?.row ?? null) : null);

  const openCompose = async (
    kind: ComposeKind,
    threadId: string | null,
    to?: string,
    prefill?: MailtoPrefill,
    messageId?: string,
  ) => {
    if (!session) return;
    const thread = threadId && engine ? await engine.getThread(threadId) : null;
    const accountId = thread?.row.accountId ?? accounts[0]?.id;
    const account = accounts.find((a) => a.id === accountId);
    if (!account) return;
    // The alias the original was addressed to (else the default), its signature inserted.
    const orig = thread?.messages.find((m) => m.id === messageId) ?? thread?.messages.at(-1);
    const addressed = orig ? [...orig.to, ...orig.cc].map((p) => p.email) : [];
    const spec = openWithAlias(
      composeSpec(kind, thread, account, messageId),
      aliases ?? [],
      addressed,
    );
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

  const whyNames = useWhyNames(rules, customTabs);
  const openPanel = useCallback((view: MailPanelView) => showMailPanel(store, view), [store]);
  const reader = useReaderWiring({
    engine,
    commands,
    spine,
    port,
    placeKey,
    view,
    contacts,
    whoFor,
    onAddContact,
    loadInvite,
    onRsvp,
    onIntent: (intent, ids) => onIntent(intent, ids),
    openPanel,
    openCompose: (kind, threadId, messageId) =>
      void openCompose(kind, threadId, undefined, undefined, messageId),
    act: (kind, ids, args) => void shell.current?.act(kind, ids, args),
    rowOf,
    openDraft,
    retrySend: (d) => void resend(d),
    removeAndSend: (d, file) => void resend(d, file),
    editOutbox: (id) => void editOutbox(id),
    runGesture: (label, run) => void runGesture(label, run),
    now,
    whyNames,
    priorityPeople,
  });
  const linked = useThreadLinks(reader.links, linkFor?.threadId ?? null);

  const onIntent = (intent: MailKeyId, threadIds: string[]) => {
    if (reader.onKey(intent, threadIds)) return;
    const kind = COMPOSE_INTENTS[intent];
    if (kind) {
      void openCompose(kind, threadIds[0] ?? null);
      return;
    }
    if (intent === "email.snooze") snooze.open(threadIds);
    else if (intent === "email.move") void openMove(threadIds);
    // `t` on a selection: one task per thread, one Undo (spec §6).
    else if (intent === "email.convert" && spine && threadIds.length > 1)
      void makeTasks(spine, threadIds, rowOf);
    else if (intent === "email.convert" && spine && threadIds[0])
      void rowOf(threadIds[0]).then((row) =>
        row
          ? runConvert(spine, row, (taskId) => {
              setEditTitleFor(taskId);
              showMailPanel(store, "task");
            })
          : undefined,
      );
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
    setFiles(false);
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
  const own = useMemo(() => accounts.map((a) => a.address.toLowerCase()), [accounts]);

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
          onUndoFirst={undoSend.undoFirst}
          customTabs={customTabs}
          linkedKindsFor={spine?.linkedKindsFor}
          notSentThreadIds={notSent}
          onConnect={(provider) => setConnect({ reconnect: null, provider })}
          onReconnect={(id) => setConnect({ reconnect: accounts.find((a) => a.id === id) ?? null })}
          onRetryAccount={retryAccount}
          renderPlace={(view) =>
            view.kind === "outbox" && port ? (
              <OutboxPlace
                port={port}
                refreshKey={placeKey}
                nowMs={now()}
                onEdit={(id) => void editOutbox(id)}
              />
            ) : null
          }
          renderListTop={(view) =>
            view.kind === "unified" && view.role === "drafts" && port ? (
              <FailedSends
                port={port}
                refreshKey={placeKey}
                onFix={openDraft}
                onRetry={(d) => void resend(d)}
                onRemoveAndSend={(d, file) => void resend(d, file)}
              />
            ) : null
          }
          onIntent={onIntent}
          onOpenSubscriptions={engine ? () => void openSubscriptions() : undefined}
          subscriptionsActive={subs !== null}
          onOpenAttachments={
            engine
              ? () => {
                  setSubs(null);
                  setFiles(true);
                }
              : undefined
          }
          attachmentsActive={files}
          onSyncNow={() => accounts.forEach((a) => retryAccount(a.id))}
          onViewChange={(v) => {
            setView(v);
            setSubs(null);
            setFiles(false);
          }}
          onCursorChange={setCurrent}
          renderSelectionActions={labels.selectionActions}
          renderReader={(threadId, { listEmpty, empty } = { listEmpty: false, empty: null }) => {
            // A New message takes the reader column; the list stays beside it (decision 17).
            if (composer.column) return composer.column;
            if (files && engine) {
              return (
                <AttachmentsPlace
                  engine={engine}
                  refreshKey={String(version)}
                  onPreview={(entry) => {
                    setFiles(false);
                    shell.current?.open(entry.threadId);
                  }}
                />
              );
            }
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
            // An empty list: inbox zero's next tabs, else a blank reader (spec §4, AC22).
            if (!threadId && listEmpty) return empty;
            return (
              <MailReader
                engine={engine}
                threadId={threadId}
                version={version}
                behavior={behavior}
                menuItems={labels.readerMenuItems}
                now={now}
                accounts={accounts}
                selfAddresses={own}
                contacts={contactSet}
                {...reader.props}
                panel={{ open: panelOpen, onToggle: () => toggleMailPanel(store) }}
                composer={composer.inline(threadId)}
              />
            );
          }}
        />
        <MailSidePanel
          store={store}
          threadId={current}
          engine={engine}
          version={version}
          nowMs={now()}
          today={todayView(spine, {
            tasks: todayTasks,
            events: todayEvents,
            date: localDate(now()),
            onDropThread,
            // Not for a draft, an Outbox message or a new message (AC18).
            onCreateEvent: createEventAllowed({
              view,
              composingNew: !!composer.column,
              threadId: current,
            })
              ? forThread(current, createEvent)
              : undefined,
          })}
          links={reader.links}
          rowOf={rowOf}
          selfAddresses={own}
          contacts={contactSet}
          whoFor={reader.props.who?.lookup}
          contactDetailFor={contactDetailFor}
          taskFor={taskFor}
          editTitleFor={onRenameTask ? editTitleFor : null}
          onRenameTask={onRenameTask}
          onEditTitleDone={() => setEditTitleFor(null)}
          onAddContact={onAddContact}
          onOpenContact={(id) => openReferenceFull({ type: "contact", id })}
          onOpenItem={(type, id) => openReferenceFull({ type, id })}
          onOpenTask={(id) => openReferenceFull({ type: "task", id })}
          onMakeTask={forThread(current, (id) => onIntent("email.convert", [id]))}
          onOpenThread={(id) => shell.current?.open(id)}
          onPreview={(entry) => shell.current?.open(entry.threadId)}
        />
      </div>
      {snooze.picker}
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
      {reader.remindPicker}
      {renderLinkPicker && linkFor
        ? renderLinkPicker({
            open: true,
            onOpenChange: (o) => (o ? null : setLinkFor(null)),
            onPick: (target) => {
              const row = linkFor;
              setLinkFor(null);
              if (spine) void runGesture("Linked", () => spine.link(row, target));
            },
            linked: linked.map((l) => l.entity),
            onUnlink: (target) => {
              setLinkFor(null);
              const link = linked.find(
                (l) => l.entity.type === target.type && l.entity.id === target.id,
              );
              if (link) reader.links?.unlink(link);
            },
          })
        : null}
      <ConnectSlot request={connect} onClose={() => setConnect(null)} />
    </div>
  );
}
