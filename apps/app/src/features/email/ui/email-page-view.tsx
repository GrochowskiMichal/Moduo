// The /email page (EM-4 shell + EM-5 triage). Owns the hook, the lifted scope
// (selectedAccountId) + selection (selectedThreadId), composes FeaturePanelsShell
// (left rail · center list · right reader/detail switcher), and wires keyboard-
// first triage with sonner undo toasts (the triage() undo-window pattern). On web
// (no desktop engine) it degrades to a calm read-only note + any linked-email
// cards from the cloud tissue — no fake compose/triage.

import { AlertTriangle, Mail, PenSquare, RefreshCw } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { onCreateNew } from "../../../components/app/create-events";
import { FeaturePanelsShell } from "../../../components/app/feature-panels-shell";
import { RightPanel } from "../../../components/app/right-panel";
import { truncationNotice } from "../../../components/app/truncation-notice";
import { Button } from "../../../components/ui/button";
import { EmptyState } from "../../../components/ui/empty-state";
import { Eyebrow } from "../../../components/ui/eyebrow";
import { IconButton } from "../../../components/ui/icon-button";
import { type CaptureSource, useCaptureSource } from "../../../lib/capture-source";
import type { EntityRef } from "../../../lib/entity-links";
import { takeEntityOpenIntent } from "../../../lib/entity-open";
import { useAppHotkeys } from "../../../lib/hotkeys";
import type { EmailThreadRef } from "../../../lib/runtime.types";
import { useAuth } from "../../../providers/auth-provider";
import { useWorkspace } from "../../../providers/workspace-provider";
import type { Contact } from "../../contacts/model";
import { endPosition, makeTask } from "../../tasks/helpers";
import {
  TasksProvider,
  useTaskById,
  useTaskCommands,
  useTasksSelector,
  useTasksStatus,
} from "../../tasks/tasks-context";
import { TaskDetailPanel } from "../../tasks/ui/task-detail-panel";
import { accountSyncHealth, resolveAccountHues } from "../accounts";
import { type EmailSection, flattenSections, groupThreadsBySection, senderKey } from "../classify";
import { blankDraft, buildComposeDraft, type ComposeMode } from "../compose";
import {
  buildConvertDescription,
  cleanTaskTitle,
  resolveContactIdByAddress,
  spawnedFromLinkArgs,
} from "../convert";
import { useEmailCompose } from "../hooks/use-email-compose";
import { TRIAGE_UNDO_MS, useEmailModule } from "../hooks/use-email-module";
import { useEmailPrefs } from "../hooks/use-email-prefs";
import { useEmailSearch } from "../hooks/use-email-search";
import { useEmailSnoozeRestore } from "../hooks/use-email-snooze-restore";
import type { EmailFolderInfo, EmailThread, SavedAccount } from "../model/email-types";
import { buildRefUpsertArgs } from "../refs";
import { formatSnoozeUntil } from "../snooze";
import { threadsForAccount, unreadCount } from "../threads";
import { EMAIL_OPEN_THREAD_EVENT, resolveEmailThreadTarget } from "../url-search";
import { formatEmailDate, formatEmailDetailDate } from "../utils/email-format";
import { EmailCompose } from "./email-compose";
import { EmailConnectDialog } from "./email-connect-dialog";
import { EmailContactPanel } from "./email-contact-panel";
import { EmailDestinationList } from "./email-destination-list";
import { EmailDetailPanel } from "./email-detail-panel";
import { EmailMovePopover } from "./email-move-popover";
import type { PanelVariantId } from "./email-page-types";
import { EmailRail, type EmailScope, type EmailView } from "./email-rail";
import { EmailReader } from "./email-reader";
import { EmailSearchFooter, EmailSearchInput } from "./email-search-bar";
import { EmailShortcutsDialog } from "./email-shortcuts-dialog";
import { EmailSnoozePicker } from "./email-snooze-picker";
import { EmailSyncBanner } from "./email-sync-banner";
import { EmailThreadList } from "./email-thread-list";
import { EmailWebView } from "./email-web-view";
import { refArgsForThread, useEmailConvert } from "./use-email-convert";
import { useEmailThreadDeepLink } from "./use-email-thread-deep-link";
import { useEmailTriageActions } from "./use-email-triage-actions";

/** Fires on the window so the nav can badge the Email tab (AC3). */
export const EMAIL_UNREAD_EVENT = "moduo:email:unread";

const IS_DESKTOP = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type EmailPageViewProps = {
  /** Inbound `?thread=` deep link (DF-2) — select + scroll the thread (desktop)
   * or its tissue card (web). Accepts a raw threadId or an `email_thread` ref id. */
  urlThreadId?: string | null;
  /** Called once the deep link is applied (or found stale) so the page can
   * clear the URL param. */
  onConsumeThreadDeepLink?: () => void;
};

export function EmailPageView(props: EmailPageViewProps = {}) {
  const { runtime, userId } = useAuth();
  const { selectedWorkspaceId: workspaceId, modulePermissions } = useWorkspace();
  // Tasks module — powers the convert great-moment + the Task right-panel variant.
  return (
    <TasksProvider
      runtime={runtime}
      userId={userId}
      workspaceId={workspaceId}
      modulePermission={modulePermissions?.tasks ?? "none"}
    >
      <EmailPageBody {...props} />
    </TasksProvider>
  );
}

function EmailPageBody({ urlThreadId = null, onConsumeThreadDeepLink }: EmailPageViewProps) {
  const { runtime, userId } = useAuth();
  const { selectedWorkspaceId: workspaceId } = useWorkspace();
  const email = useEmailModule({ runtime, workspaceId, isDesktop: IS_DESKTOP });
  // Tasks, read narrowly from the provider above (A4).
  const { load: reloadTasks } = useTaskCommands();
  const { canEdit: tasksCanEdit } = useTasksStatus();
  const tasksInbox = useTasksSelector((d) => d.inbox);
  // Contacts, for resolving a sender → an existing contact (AC9).
  const [contacts, setContacts] = useState<Contact[]>([]);
  useEffect(() => {
    if (!runtime || !workspaceId) return;
    let active = true;
    void runtime.contacts
      .list(workspaceId)
      .then((bundle) => {
        if (active) setContacts(bundle.contacts ?? []);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [runtime, workspaceId]);
  // The 60s desktop loop that restores due snoozes, fires due follow-up reminders,
  // and clears follow-ups a counterpart has replied to (AC6/AC7/AC16).
  useEmailSnoozeRestore({ email, runtime, workspaceId, isDesktop: IS_DESKTOP });
  // Compose surface + the 10s undo-send hold (EM-7).
  const compose = useEmailCompose({
    runtime,
    isDesktop: IS_DESKTOP,
    onSent: () => void email.reload(),
  });

  const [selectedAccountId, setSelectedAccountId] = useState<EmailScope>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [view, setView] = useState<EmailView>("inbox");
  const [panelVariant, setPanelVariant] = useState<PanelVariantId>("reader");
  const [connectOpen, setConnectOpen] = useState(false);
  const [reconnectTarget, setReconnectTarget] = useState<SavedAccount | null>(null);
  const [movePopoverOpen, setMovePopoverOpen] = useState(false);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const detailTask = useTaskById(detailTaskId);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const accountHues = useMemo(() => resolveAccountHues(email.accounts), [email.accounts]);

  // The scope's threads (Unified = all; else one account).
  const scopedThreads = useMemo(
    () => (selectedAccountId ? threadsForAccount(email.threads, selectedAccountId) : email.threads),
    [email.threads, selectedAccountId],
  );

  const unreadByAccount = useMemo(() => {
    const out: Record<string, number> = {};
    for (const t of email.threads) {
      out[t.accountId] = (out[t.accountId] ?? 0) + t.unreadCount;
    }
    return out;
  }, [email.threads]);

  const unifiedUnread = useMemo(() => unreadCount(email.threads), [email.threads]);

  // ── smart inbox (EM-10) + search (EM-9) ────────────────────────────────────
  const emailPrefs = useEmailPrefs(userId ?? "");
  const search = useEmailSearch({
    runtime,
    envelopes: email.envelopes,
    accounts: email.accounts,
    isDesktop: IS_DESKTOP,
    accountId: selectedAccountId,
  });
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Known-sender signal: a from-address that resolves to a contact pulls the
  // thread into Personal even under bulk headers (brief §5).
  const knownSenderKeys = useMemo(() => {
    const set = new Set<string>();
    for (const c of contacts) {
      if (c.email) set.add(c.email.trim().toLowerCase());
      for (const ch of c.emails ?? []) {
        if (ch.value) set.add(ch.value.trim().toLowerCase());
      }
    }
    return set;
  }, [contacts]);

  // Group the scope's threads into Personal / Notifications / Newsletters, honoring
  // per-sender overrides + the known-sender pull-back.
  const sections = useMemo(
    () =>
      groupThreadsBySection(scopedThreads, {
        overrides: emailPrefs.prefs.senderOverrides,
        isKnownSender: (key) => knownSenderKeys.has(key),
      }),
    [scopedThreads, emailPrefs.prefs.senderOverrides, knownSenderKeys],
  );

  // The rows in display/keyboard order: search results when searching, else the
  // section-flattened inbox.
  const orderedThreads = useMemo(
    () => (search.active ? search.results : flattenSections(sections)),
    [search.active, search.results, sections],
  );

  const overrideFor = useCallback(
    (thread: EmailThread): EmailSection | null =>
      emailPrefs.prefs.senderOverrides[senderKey(thread.fromEmail)] ?? null,
    [emailPrefs.prefs.senderOverrides],
  );

  // DF-6: per-sender remote-image allow-list (cloud-synced pref) → the reader.
  const imageAllowedSenders = useMemo(
    () => new Set(emailPrefs.prefs.imageAllowedSenders),
    [emailPrefs.prefs.imageAllowedSenders],
  );
  const { allowImagesFromSender } = emailPrefs;
  const allowSenderImages = useCallback(
    (senderEmail: string) => {
      allowImagesFromSender(senderEmail);
      toast(`Images from ${senderKey(senderEmail)} will always load`);
    },
    [allowImagesFromSender],
  );

  // The accounts in the current scope (Unified = all; else the one selected).
  const scopedAccounts = useMemo(
    () =>
      selectedAccountId ? email.accounts.filter((a) => a.id === selectedAccountId) : email.accounts,
    [email.accounts, selectedAccountId],
  );

  // DF-6: accounts in the current scope that have silently stopped syncing —
  // surfaced as a banner (the rail glyphs alone were invisible on All inboxes).
  // Partitioned per account (AC12): a broken mailbox names itself and never
  // stands in for the healthy ones, which keep syncing and listing.
  const syncHealth = useMemo(() => accountSyncHealth(scopedAccounts), [scopedAccounts]);

  // Newest successful sync across the scope, for the refresh button's tooltip.
  const lastSyncLabel = useMemo(() => {
    const newest = scopedAccounts
      .map((a) => (a.lastSyncAt ? Date.parse(a.lastSyncAt) : Number.NaN))
      .filter((n) => Number.isFinite(n))
      .sort((x, y) => y - x)[0];
    return newest ? formatEmailDetailDate(new Date(newest).toISOString()) : null;
  }, [scopedAccounts]);

  // The selected thread object — looked up across the ordered rows AND the inbox
  // scope so opening a search result (and keeping the reader while searching) work.
  const selectedThread = useMemo(
    () =>
      orderedThreads.find((t) => t.threadId === selectedThreadId) ??
      scopedThreads.find((t) => t.threadId === selectedThreadId) ??
      null,
    [orderedThreads, scopedThreads, selectedThreadId],
  );

  // If the selected thread leaves the scope (filter change / triage), drop it.
  useEffect(() => {
    if (selectedThreadId && !selectedThread) setSelectedThreadId(null);
  }, [selectedThreadId, selectedThread]);

  // ── inbound thread deep link (DF-2) ────────────────────────────────────────
  const highlightedRefId = useEmailThreadDeepLink({
    urlThreadId,
    onConsumeThreadDeepLink,
    isDesktop: IS_DESKTOP,
    email,
    clearSearch: search.clear,
    setView,
    setSelectedAccountId,
    setSelectedThreadId,
    setPanelVariant,
  });

  // Nav unread badge (AC3): broadcast the count whenever it changes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent(EMAIL_UNREAD_EVENT, { detail: { count: unifiedUnread } }));
  }, [unifiedUnread]);

  const openThread = useCallback(
    (thread: EmailThread) => {
      setSelectedThreadId(thread.threadId);
      setPanelVariant("reader");
      if (thread.unread) void email.markRead(thread, true);
    },
    [email],
  );

  // ── triage handlers — optimistic + undo toast (the triage() contract) ──────
  const {
    runArchive,
    runDelete,
    runMove,
    openSnooze,
    doSnooze,
    openFollowUp,
    doFollowUp,
    unsnoozeRef,
    clearFollowUpRef,
    snoozeOpen,
    setSnoozeOpen,
    followUpOpen,
    setFollowUpOpen,
  } = useEmailTriageActions({ email, selectedThreadId, setSelectedThreadId });

  // ── compose (EM-7) ─────────────────────────────────────────────────────────
  const signatureFor = useCallback(
    (address: string) => {
      const norm = address.trim().toLowerCase();
      return email.tissueAccounts.find((a) => a.address === norm)?.signatureHtml ?? "";
    },
    [email.tissueAccounts],
  );

  const startNew = useCallback(() => {
    const account = email.accounts.find((a) => a.id === selectedAccountId) ?? email.accounts[0];
    if (!account) return;
    compose.openDraft(blankDraft(account.id, signatureFor(account.email)));
  }, [email.accounts, selectedAccountId, compose, signatureFor]);

  // ⌘N / global "+" → new message (this listener is only mounted on /email).
  useEffect(() => onCreateNew(startNew), [startNew]);

  const listAttachments = useCallback(
    (accountId: string, folder: string, uid: number) =>
      runtime?.email.listAttachments({ accountId, folder, uid }) ?? Promise.resolve([]),
    [runtime],
  );
  const saveAttachment = useCallback(
    (
      accountId: string,
      folder: string,
      uid: number,
      attachmentId: string,
      defaultFilename: string,
    ) =>
      runtime?.email.saveAttachment({
        accountId,
        folder,
        uid,
        attachmentId,
        defaultFilename,
      }) ?? Promise.resolve({ saved: false, path: null }),
    [runtime],
  );
  const getInlineImages = useCallback(
    (accountId: string, folder: string, uid: number) =>
      runtime?.email.getInlineImages({ accountId, folder, uid }) ?? Promise.resolve([]),
    [runtime],
  );

  const startReply = useCallback(
    async (mode: ComposeMode) => {
      const thread = selectedThread;
      if (!thread || mode === "new") return;
      const account = email.accounts.find((a) => a.id === thread.accountId);
      const messages = await email.getThread(thread.accountId, thread.threadId);
      compose.openDraft(
        buildComposeDraft({
          mode,
          thread,
          messages,
          self: {
            accountId: thread.accountId,
            address: account?.email ?? "",
            signatureHtml: signatureFor(account?.email ?? ""),
          },
          selfAddresses: email.accounts.map((a) => a.email),
        }),
      );
    },
    [selectedThread, email, compose, signatureFor],
  );

  // ── the great moment: convert → task + contact context (EM-8) ──────────────
  const contactIndex = useMemo(
    () =>
      contacts.map((c) => ({
        id: c.id,
        emails: [c.email, ...c.emails.map((e) => e.value)].filter(Boolean) as string[],
      })),
    [contacts],
  );

  const resolvedContact = useMemo(() => {
    const id = resolveContactIdByAddress(selectedThread?.fromEmail ?? null, contactIndex);
    return id ? (contacts.find((c) => c.id === id) ?? null) : null;
  }, [selectedThread, contactIndex, contacts]);

  // The selected thread's tissue-ref id (= its email_thread entity id), or null.
  const selectedRefId = useMemo(
    () =>
      selectedThread
        ? (email.tissueRefs.find((r) => r.threadKey === selectedThread.threadId)?.id ?? null)
        : null,
    [selectedThread, email.tissueRefs],
  );

  const openEntity = useCallback((ref: EntityRef) => {
    window.dispatchEvent(
      new CustomEvent("moduo:entity:open", { detail: { type: ref.type, id: ref.id } }),
    );
  }, []);

  // An open thread rides along on a capture as "From: …" (tasks-v3 call 93);
  // it joins the registry only if the capture keeps the link.
  const captureSource = useMemo<CaptureSource | null>(() => {
    if (!selectedThread || !runtime || !workspaceId) return null;
    const thread = selectedThread;
    return {
      kind: "email",
      label: thread.subject || "(no subject)",
      ref: selectedRefId ? { type: "email_thread", id: selectedRefId } : undefined,
      resolve: async () => {
        const ref = await runtime.email.upsertRef({ workspaceId, ...refArgsForThread(thread) });
        return { type: "email_thread", id: ref.id };
      },
    };
  }, [selectedThread, selectedRefId, runtime, workspaceId, refArgsForThread]);
  useCaptureSource(captureSource);

  const { runConvert, addAsContact, makeTaskFromRef } = useEmailConvert({
    runtime,
    workspaceId,
    email,
    tasksInbox,
    reloadTasks,
    contacts,
    setContacts,
    contactIndex,
    selectedThread,
    selectedThreadId,
    setSelectedThreadId,
    setDetailTaskId,
    setPanelVariant,
  });

  const togglePin = useCallback(
    (thread: EmailThread) => {
      void email.toggleStar(thread, !thread.starred);
    },
    [email],
  );

  // ── keyboard triage (EM-5, §2). Selection walks by index within the visible
  // order (sections-flattened or search results), tracked as a threadId so it
  // survives reordering. ────────────────────────────────────────────────────
  const scopedRef = useRef<EmailThread[]>(orderedThreads);
  const selectedIdRef = useRef<string | null>(selectedThreadId);
  useEffect(() => {
    scopedRef.current = orderedThreads;
    selectedIdRef.current = selectedThreadId;
  });

  const moveSelection = useCallback((dir: 1 | -1) => {
    const list = scopedRef.current;
    if (list.length === 0) return;
    const curId = selectedIdRef.current;
    const curIdx = curId ? list.findIndex((t) => t.threadId === curId) : -1;
    const nextIdx =
      curIdx === -1
        ? dir === 1
          ? 0
          : list.length - 1
        : (curIdx + dir + list.length) % list.length;
    setSelectedThreadId(list[nextIdx].threadId);
  }, []);

  // Registry bindings in the "email" scope (routes/pages/email-page.tsx turns
  // it on). Email's own `?` (the triage legend) outranks the app-wide sheet by
  // scope (`overrides: true`), not by listening in the capture phase (TS-6).
  // Never from a field; a key a nearer handler claimed is skipped.
  const currentThread = () => {
    const curId = selectedIdRef.current;
    return curId ? (scopedRef.current.find((t) => t.threadId === curId) ?? null) : null;
  };
  const withCurrent = (run: (thread: EmailThread) => void) => () => {
    const current = currentThread();
    if (current) run(current);
  };
  useAppHotkeys({
    "email.next": () => moveSelection(1),
    "email.prev": () => moveSelection(-1),
    "email.open": withCurrent(openThread),
    "email.archive": withCurrent(runArchive),
    "email.pin": withCurrent(togglePin),
    "email.delete": withCurrent(runDelete),
    "email.move": withCurrent(() => setMovePopoverOpen(true)),
    "email.snooze": withCurrent(openSnooze),
    "email.convert": withCurrent((thread) => void runConvert(thread)),
    "email.reply": withCurrent(() => void startReply("reply")),
    "email.legend": () => setShortcutsOpen(true),
    "email.search": () => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    },
  });

  const onConnected = useCallback(() => {
    setConnectOpen(false);
    setReconnectTarget(null);
    void email.reload();
  }, [email]);

  // The registered views (features/email/panel-views.ts), unchanged from the
  // old tabs until the module is rebuilt.
  const panelViews = useMemo(
    () => ({
      reader: () => (
        <EmailReader
          thread={selectedThread}
          getThread={email.getThread}
          getBody={email.getBody}
          onReply={startReply}
          onConvert={selectedThread ? () => void runConvert(selectedThread) : undefined}
          listAttachments={listAttachments}
          saveAttachment={saveAttachment}
          getInlineImages={getInlineImages}
          imageAllowedSenders={imageAllowedSenders}
          onAllowSenderImages={allowSenderImages}
        />
      ),
      contact: () => (
        <EmailContactPanel
          runtime={runtime}
          workspaceId={workspaceId}
          fromName={selectedThread?.fromName ?? ""}
          fromAddr={selectedThread?.fromEmail ?? ""}
          contact={resolvedContact}
          canEdit={tasksCanEdit}
          onAddContact={addAsContact}
          onOpenEntity={openEntity}
        />
      ),
      detail: () => (
        <EmailDetailPanel
          runtime={runtime}
          workspaceId={workspaceId}
          refId={selectedRefId}
          canEdit={tasksCanEdit}
          onOpenEntity={openEntity}
        />
      ),
      task: () =>
        detailTaskId ? (
          <TaskDetailPanel
            task={detailTask}
            onRequestCapture={() => {}}
            onSelectTask={setDetailTaskId}
            runtime={runtime}
            workspaceId={workspaceId}
            onOpenEntity={openEntity}
          />
        ) : (
          <EmptyState
            title="No task selected"
            description="Convert an email to a task to work on it here."
          />
        ),
    }),
    [
      selectedThread,
      email.getThread,
      email.getBody,
      startReply,
      runConvert,
      listAttachments,
      saveAttachment,
      getInlineImages,
      imageAllowedSenders,
      allowSenderImages,
      runtime,
      workspaceId,
      resolvedContact,
      selectedRefId,
      detailTaskId,
      detailTask,
      tasksCanEdit,
      addAsContact,
      openEntity,
    ],
  );

  // ── web: read-only tissue view (no desktop engine, AC15) ───────────────────
  if (!IS_DESKTOP) return <EmailWebView email={email} highlightedRefId={highlightedRefId} />;

  return (
    <>
      <FeaturePanelsShell
        feature="email"
        notice={truncationNotice(email.truncated)}
        left={
          <EmailRail
            accounts={email.accounts}
            accountHues={accountHues}
            unifiedUnread={unifiedUnread}
            unreadByAccount={unreadByAccount}
            selectedAccountId={selectedAccountId}
            onSelectScope={(scope) => {
              setSelectedAccountId(scope);
              setSelectedThreadId(null);
              setView("inbox");
            }}
            activeView={view}
            onSelectView={setView}
            snoozedCount={email.snoozed.length}
            followUpCount={email.followUps.length}
            onConnect={() => setConnectOpen(true)}
            onReconnect={(account) => setReconnectTarget(account)}
          />
        }
        right={
          <RightPanel
            module="email"
            views={panelViews}
            activeId={panelVariant}
            onChange={(id) => setPanelVariant(id as PanelVariantId)}
          />
        }
        center={
          <div className="relative flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
              <EmailSearchInput
                ref={searchInputRef}
                query={search.query}
                onQuery={search.setQuery}
                onClear={search.clear}
              />
              {/* DF-6: visible sync state + manual refresh (calendar-toolbar pattern). */}
              {email.syncing ? (
                <span className="shrink-0 text-2xs text-muted-foreground">Syncing…</span>
              ) : null}
              <IconButton
                icon={RefreshCw}
                label={email.syncing ? "Syncing…" : "Sync now"}
                tooltip={
                  email.syncing
                    ? "Syncing…"
                    : lastSyncLabel
                      ? `Sync now — last synced ${lastSyncLabel}`
                      : "Sync now"
                }
                disabled={email.syncing}
                onClick={() => void email.syncNow()}
                className={email.syncing ? "animate-spin motion-reduce:animate-none" : undefined}
              />
              <Button size="sm" onClick={startNew}>
                <PenSquare aria-hidden />
                New message
              </Button>
            </div>
            <EmailSyncBanner
              health={syncHealth}
              onReconnect={setReconnectTarget}
              onRetrySync={() => void email.syncNow()}
            />
            {search.active ? (
              <EmailThreadList
                threads={search.results}
                loading={false}
                error={null}
                selectedThreadId={selectedThreadId}
                showAccountDot={selectedAccountId === null}
                accountHues={accountHues}
                onSelectThread={openThread}
                onArchive={runArchive}
                onSnooze={openSnooze}
                onFollowUp={openFollowUp}
                onDelete={runDelete}
                onRetry={() => void email.reload()}
                empty={{
                  title: "No matches",
                  description: "Nothing here matches — try the full-mailbox search below.",
                }}
                footer={
                  <EmailSearchFooter
                    accounts={
                      selectedAccountId
                        ? email.accounts.filter((a) => a.id === selectedAccountId)
                        : email.accounts
                    }
                    serverStates={search.serverStates}
                    onEscalate={search.escalate}
                  />
                }
              />
            ) : view === "inbox" ? (
              <EmailThreadList
                threads={scopedThreads}
                sections={sections}
                loading={email.loading}
                error={email.error}
                selectedThreadId={selectedThreadId}
                showAccountDot={selectedAccountId === null}
                accountHues={accountHues}
                onSelectThread={openThread}
                onArchive={runArchive}
                onSnooze={openSnooze}
                onFollowUp={openFollowUp}
                onDelete={runDelete}
                onRetry={() => void email.reload()}
                onSetSection={(thread, section) =>
                  emailPrefs.setSenderOverride(thread.fromEmail, section)
                }
                overrideFor={overrideFor}
              />
            ) : (
              <EmailDestinationList
                mode={view}
                refs={view === "snoozed" ? email.snoozed : email.followUps}
                now={Date.now()}
                onUnsnooze={unsnoozeRef}
                onClearFollowUp={clearFollowUpRef}
                onMakeTask={makeTaskFromRef}
              />
            )}

            {/* The move popover anchors to an invisible span — opened by `m` or
                the row's move action; lists the selected thread's account
                folders. */}
            <EmailMovePopover
              open={movePopoverOpen}
              onOpenChange={setMovePopoverOpen}
              runtime={runtime}
              accountId={selectedThread?.accountId ?? null}
              onSelect={(folder) => {
                if (selectedThread) runMove(selectedThread, folder);
              }}
            >
              <span aria-hidden className="pointer-events-none absolute left-1/2 top-2 h-0 w-0" />
            </EmailMovePopover>

            {/* Snooze + follow-up pickers — anchored invisibly, opened by the `s`
                key / a row action; each resolves a concrete instant on pick. */}
            <EmailSnoozePicker open={snoozeOpen} onOpenChange={setSnoozeOpen} onPick={doSnooze}>
              <span aria-hidden className="pointer-events-none absolute left-1/3 top-2 h-0 w-0" />
            </EmailSnoozePicker>
            <EmailSnoozePicker
              open={followUpOpen}
              onOpenChange={setFollowUpOpen}
              onPick={doFollowUp}
              title="Follow up if no reply"
              confirmLabel="Set reminder"
            >
              <span aria-hidden className="pointer-events-none absolute left-2/3 top-2 h-0 w-0" />
            </EmailSnoozePicker>
          </div>
        }
      />

      {(connectOpen || reconnectTarget) && runtime ? (
        <EmailConnectDialog
          open={connectOpen || reconnectTarget !== null}
          onOpenChange={(open) => {
            if (!open) {
              setConnectOpen(false);
              setReconnectTarget(null);
            }
          }}
          isReconnect={reconnectTarget ?? undefined}
          onConnected={onConnected}
        />
      ) : null}

      {compose.draft ? (
        <EmailCompose
          draft={compose.draft}
          accounts={email.accounts}
          runtime={runtime}
          workspaceId={workspaceId}
          onSend={compose.send}
          onClose={compose.close}
        />
      ) : null}

      <EmailShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </>
  );
}
