// The /email page (EM-4 shell + EM-5 triage). Owns the hook, the lifted scope
// (selectedAccountId) + selection (selectedThreadId), composes FeaturePanelsShell
// (left rail · center list · right reader/detail switcher), and wires keyboard-
// first triage with sonner undo toasts (the triage() undo-window pattern). On web
// (no desktop engine) it degrades to a calm read-only note + any linked-email
// cards from the cloud tissue — no fake compose/triage. Replaces EmailWorkspace.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Mail, PenSquare } from "lucide-react";

import { FeaturePanelsShell } from "../../../components/app/feature-panels-shell";
import {
  RightPanelSwitcher,
  type RightPanelVariant,
} from "../../../components/app/right-panel-switcher";
import { Button } from "../../../components/ui/button";
import { EmptyState } from "../../../components/ui/empty-state";
import { useAuth } from "../../../providers/auth-provider";
import { useWorkspace } from "../../../providers/workspace-provider";
import {
  TRIAGE_UNDO_MS,
  useEmailModule,
} from "../hooks/use-email-module";
import { useEmailSnoozeRestore } from "../hooks/use-email-snooze-restore";
import { useEmailCompose } from "../hooks/use-email-compose";
import { useTasksModule } from "../../tasks/hooks/use-tasks-module";
import { TaskDetailPanel } from "../../tasks/ui/task-detail-panel";
import { endPosition, makeTask } from "../../tasks/helpers";
import { resolveAccountHues } from "../accounts";
import { threadsForAccount, unreadCount } from "../threads";
import { formatSnoozeUntil } from "../snooze";
import { buildRefUpsertArgs } from "../refs";
import { blankDraft, buildComposeDraft, type ComposeMode } from "../compose";
import {
  buildConvertDescription,
  cleanTaskTitle,
  resolveContactIdByAddress,
  spawnedFromLinkArgs,
} from "../convert";
import { formatEmailDate } from "../utils/email-format";
import type { EmailThreadRef } from "../../../lib/runtime.types";
import type { EntityRef } from "../../../lib/entity-links";
import type { Contact } from "../../contacts/model";
import type { EmailFolderInfo, EmailThread, SavedAccount } from "../model/email-types";
import { EmailCompose } from "./email-compose";
import { EmailContactPanel } from "./email-contact-panel";
import { EmailDetailPanel } from "./email-detail-panel";
import { EmailConnectDialog } from "./email-connect-dialog";
import { EmailRail, type EmailScope, type EmailView } from "./email-rail";
import { EmailThreadList } from "./email-thread-list";
import { EmailReader } from "./email-reader";
import { EmailMovePopover } from "./email-move-popover";
import { EmailSnoozePicker } from "./email-snooze-picker";
import { EmailDestinationList } from "./email-destination-list";

/** Fires on the window so the nav can badge the Email tab (AC3). */
export const EMAIL_UNREAD_EVENT = "moduo:email:unread";

const IS_DESKTOP =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type PanelVariantId = "reader" | "contact" | "detail" | "task";

/** Guard shortcuts from firing while typing or inside an overlay. */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return Boolean(
    el.closest("[role='dialog'], [role='menu'], [role='listbox'], [role='combobox']"),
  );
}

export function EmailPageView() {
  const { runtime, userId } = useAuth();
  const { selectedWorkspaceId: workspaceId, modulePermissions } = useWorkspace();
  const email = useEmailModule({ runtime, workspaceId, isDesktop: IS_DESKTOP });
  // Tasks module — powers the convert great-moment + the Task right-panel variant.
  const tasksApi = useTasksModule(runtime, {
    userId,
    workspaceId,
    modulePermission: modulePermissions?.tasks ?? "none",
  });
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
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [snoozeTarget, setSnoozeTarget] = useState<EmailThread | null>(null);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpTarget, setFollowUpTarget] = useState<EmailThread | null>(null);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);

  const accountHues = useMemo(
    () => resolveAccountHues(email.accounts),
    [email.accounts],
  );

  // The scope's threads (Unified = all; else one account).
  const scopedThreads = useMemo(
    () =>
      selectedAccountId
        ? threadsForAccount(email.threads, selectedAccountId)
        : email.threads,
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

  // The selected thread object (id-based lookup so it survives reordering).
  const selectedThread = useMemo(
    () => scopedThreads.find((t) => t.threadId === selectedThreadId) ?? null,
    [scopedThreads, selectedThreadId],
  );

  // If the selected thread leaves the scope (filter change / triage), drop it.
  useEffect(() => {
    if (selectedThreadId && !selectedThread) setSelectedThreadId(null);
  }, [selectedThreadId, selectedThread]);

  // Nav unread badge (AC3): broadcast the count whenever it changes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent(EMAIL_UNREAD_EVENT, { detail: { count: unifiedUnread } }),
    );
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
  const runArchive = useCallback(
    (thread: EmailThread) => {
      const undo = email.triage(thread, "archive");
      if (selectedThreadId === thread.threadId) setSelectedThreadId(null);
      toast("Done", {
        duration: TRIAGE_UNDO_MS,
        action: { label: "Undo", onClick: undo },
      });
    },
    [email, selectedThreadId],
  );

  const runDelete = useCallback(
    (thread: EmailThread) => {
      const undo = email.triage(thread, "delete");
      if (selectedThreadId === thread.threadId) setSelectedThreadId(null);
      toast("Deleted", {
        duration: TRIAGE_UNDO_MS,
        action: { label: "Undo", onClick: undo },
      });
    },
    [email, selectedThreadId],
  );

  const runMove = useCallback(
    (thread: EmailThread, folder: EmailFolderInfo) => {
      const undo = email.triage(thread, "move", folder.name);
      if (selectedThreadId === thread.threadId) setSelectedThreadId(null);
      toast(`Moved to ${folder.displayName || folder.name}`, {
        duration: TRIAGE_UNDO_MS,
        action: { label: "Undo", onClick: undo },
      });
    },
    [email, selectedThreadId],
  );

  // ── snooze + follow-up (EM-6) ──────────────────────────────────────────────
  const openSnooze = useCallback((thread: EmailThread) => {
    setSnoozeTarget(thread);
    setSnoozeOpen(true);
  }, []);

  const doSnooze = useCallback(
    (at: Date) => {
      const thread = snoozeTarget;
      if (!thread) return;
      const undo = email.snooze(thread, at);
      if (selectedThreadId === thread.threadId) setSelectedThreadId(null);
      toast(`Snoozed — returns ${formatSnoozeUntil(at.toISOString(), new Date())}`, {
        duration: TRIAGE_UNDO_MS,
        action: { label: "Undo", onClick: undo },
      });
    },
    [email, snoozeTarget, selectedThreadId],
  );

  const openFollowUp = useCallback((thread: EmailThread) => {
    setFollowUpTarget(thread);
    setFollowUpOpen(true);
  }, []);

  const doFollowUp = useCallback(
    (at: Date) => {
      const thread = followUpTarget;
      if (!thread) return;
      void email.setFollowUp(thread, at);
      toast(`Follow-up set — ${formatSnoozeUntil(at.toISOString(), new Date())}`);
    },
    [email, followUpTarget],
  );

  const unsnoozeRef = useCallback(
    (ref: EmailThreadRef) => {
      void email.unsnooze(ref);
      toast("Back in your inbox");
    },
    [email],
  );

  const clearFollowUpRef = useCallback(
    (ref: EmailThreadRef) => {
      void email.clearFollowUpFor(ref);
      toast("Follow-up cleared");
    },
    [email],
  );

  // ── compose (EM-7) ─────────────────────────────────────────────────────────
  const signatureFor = useCallback(
    (address: string) => {
      const norm = address.trim().toLowerCase();
      return email.tissueAccounts.find((a) => a.address === norm)?.signatureHtml ?? "";
    },
    [email.tissueAccounts],
  );

  const startNew = useCallback(() => {
    const account =
      email.accounts.find((a) => a.id === selectedAccountId) ?? email.accounts[0];
    if (!account) return;
    compose.openDraft(blankDraft(account.id, signatureFor(account.email)));
  }, [email.accounts, selectedAccountId, compose, signatureFor]);

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

  const refArgsForThread = useCallback(
    (thread: EmailThread) =>
      buildRefUpsertArgs({
        threadKey: thread.threadId,
        accountId: thread.accountId,
        fromAddr: thread.fromEmail || null,
        fromName: thread.fromName || null,
        subject: thread.subject || null,
        snippet: thread.snippet || null,
        sentAt: Number.isFinite(thread.timestampMs)
          ? new Date(thread.timestampMs).toISOString()
          : null,
      }),
    [],
  );

  const undoConvert = useCallback(
    async (plan: {
      taskId: string;
      refId: string;
      refCreated: boolean;
      spawnLinkId: string | null;
      contactLinkId: string | null;
    }) => {
      if (!runtime || !workspaceId) return;
      try {
        await runtime.tasks.deleteTask({ workspaceId, taskId: plan.taskId });
        if (plan.spawnLinkId) await runtime.spine.deleteLink({ workspaceId, linkId: plan.spawnLinkId });
        if (plan.contactLinkId)
          await runtime.spine.deleteLink({ workspaceId, linkId: plan.contactLinkId });
        // Only remove the ref if THIS convert created it (best-effort pre-deploy).
        if (plan.refCreated) {
          try {
            await runtime.email.removeRef({ workspaceId, refId: plan.refId });
          } catch {
            /* email_op_ref_remove not deployed yet — leave the (linkless) ref */
          }
        }
      } catch {
        /* best-effort undo */
      }
      setDetailTaskId(null);
      setPanelVariant("reader");
      void tasksApi.reload();
      void email.refreshTissue();
    },
    [runtime, workspaceId, tasksApi, email],
  );

  const runConvert = useCallback(
    async (thread: EmailThread) => {
      if (!runtime || !workspaceId) return;
      const inbox = tasksApi.inbox;
      if (!inbox) {
        toast.error("Your Tasks inbox isn't ready yet.");
        return;
      }
      try {
        const refExisted = email.tissueRefs.some((r) => r.threadKey === thread.threadId);
        const ref = await runtime.email.upsertRef({ workspaceId, ...refArgsForThread(thread) });

        const title = cleanTaskTitle(thread.subject);
        const task = makeTask({
          workspaceId,
          bucketId: inbox.id,
          title,
          description: buildConvertDescription({
            snippet: thread.snippet,
            subject: thread.subject,
            refId: ref.id,
          }),
          position: endPosition([]),
        });
        const saved = await runtime.tasks.upsertTask(task);

        // task --spawned-from--> email_thread
        const spawn = await runtime.spine.createLink({
          workspaceId,
          ...spawnedFromLinkArgs({
            taskId: saved.id,
            taskTitle: title,
            refId: ref.id,
            subject: thread.subject,
          }),
        });

        // email_thread --references--> contact (when the sender is a known contact)
        const contactId = resolveContactIdByAddress(thread.fromEmail ?? null, contactIndex);
        let contactLinkId: string | null = null;
        if (contactId) {
          // email_op_link is idempotent (returns a PRE-EXISTING row) — so only mark
          // the contact link for undo when THIS convert actually creates it, or
          // undo would silently delete a link the user made earlier.
          let alreadyLinked = false;
          try {
            const existing = await runtime.spine.listLinks({
              workspaceId,
              entityType: "email_thread",
              entityId: ref.id,
            });
            alreadyLinked = existing.some(
              (l) =>
                (l.targetType === "contact" && l.targetId === contactId) ||
                (l.sourceType === "contact" && l.sourceId === contactId),
            );
          } catch {
            // Can't tell → err toward NOT deleting on undo.
            alreadyLinked = true;
          }
          const link = (await runtime.email.linkThread({
            workspaceId,
            threadId: ref.id,
            targetType: "contact",
            targetId: contactId,
            relationKind: "references",
            origin: "manual",
            threadLabel: thread.subject,
            targetLabel: contacts.find((c) => c.id === contactId)?.name ?? null,
          })) as { id?: string } | null;
          contactLinkId = alreadyLinked ? null : (link?.id ?? null);
        }

        setDetailTaskId(saved.id);
        setPanelVariant("task");
        void tasksApi.reload();
        void email.refreshTissue();

        const plan = {
          taskId: saved.id,
          refId: ref.id,
          refCreated: !refExisted,
          spawnLinkId: spawn?.id ?? null,
          contactLinkId,
        };
        toast("Task created", {
          duration: TRIAGE_UNDO_MS,
          action: { label: "Undo", onClick: () => void undoConvert(plan) },
          cancel: {
            label: "Also mark done",
            onClick: () => {
              const undo = email.triage(thread, "archive");
              if (selectedThreadId === thread.threadId) setSelectedThreadId(null);
              toast("Done", {
                duration: TRIAGE_UNDO_MS,
                action: { label: "Undo", onClick: undo },
              });
            },
          },
        });
      } catch (e) {
        // Non-atomic (upsertRef → task → links are separate RPCs). A mid-sequence
        // failure can leave an orphan task/ref with no undo offered — acceptable at
        // alpha (all Supabase RPCs; a partial failure is rare and recoverable).
        toast.error(e instanceof Error ? e.message : "Couldn't convert to a task.");
      }
    },
    [
      runtime,
      workspaceId,
      tasksApi,
      email,
      contactIndex,
      contacts,
      refArgsForThread,
      undoConvert,
      selectedThreadId,
    ],
  );

  const addAsContact = useCallback(
    async (name: string, address: string) => {
      if (!runtime || !workspaceId) return;
      try {
        const contact = await runtime.contacts.createContact({
          workspaceId,
          name: name.trim() || address,
          email: address,
        });
        setContacts((prev) => [...prev, contact]);
        const thread = selectedThread;
        if (thread) {
          const ref = await runtime.email.upsertRef({ workspaceId, ...refArgsForThread(thread) });
          await runtime.email.linkThread({
            workspaceId,
            threadId: ref.id,
            targetType: "contact",
            targetId: contact.id,
            relationKind: "references",
            origin: "manual",
            threadLabel: thread.subject,
            targetLabel: contact.name,
          });
          void email.refreshTissue();
        }
        toast("Added to your contacts");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't add the contact.");
      }
    },
    [runtime, workspaceId, selectedThread, refArgsForThread, email],
  );

  // "Make a task" from the Follow-ups list (AC7). The ref already exists in the
  // tissue, so this creates the task + spawned-from link off ref.id directly.
  const makeTaskFromRef = useCallback(
    async (ref: EmailThreadRef) => {
      if (!runtime || !workspaceId) return;
      const inbox = tasksApi.inbox;
      if (!inbox) {
        toast.error("Your Tasks inbox isn't ready yet.");
        return;
      }
      try {
        const title = cleanTaskTitle(ref.subject);
        const task = makeTask({
          workspaceId,
          bucketId: inbox.id,
          title,
          description: buildConvertDescription({
            snippet: ref.snippet,
            subject: ref.subject,
            refId: ref.id,
          }),
          position: endPosition([]),
        });
        const saved = await runtime.tasks.upsertTask(task);
        await runtime.spine.createLink({
          workspaceId,
          ...spawnedFromLinkArgs({
            taskId: saved.id,
            taskTitle: title,
            refId: ref.id,
            subject: ref.subject,
          }),
        });
        setDetailTaskId(saved.id);
        setPanelVariant("task");
        void tasksApi.reload();
        toast("Task created");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't convert to a task.");
      }
    },
    [runtime, workspaceId, tasksApi],
  );

  const togglePin = useCallback(
    (thread: EmailThread) => {
      void email.toggleStar(thread, !thread.starred);
    },
    [email],
  );

  // ── keyboard triage (EM-5, §2). Selection walks by index within the scope,
  // but is tracked as a threadId so it survives reordering. ─────────────────
  const scopedRef = useRef<EmailThread[]>(scopedThreads);
  scopedRef.current = scopedThreads;
  const selectedIdRef = useRef<string | null>(selectedThreadId);
  selectedIdRef.current = selectedThreadId;

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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      const list = scopedRef.current;
      const curId = selectedIdRef.current;
      const current = curId ? list.find((t) => t.threadId === curId) ?? null : null;

      switch (e.key) {
        case "j":
          moveSelection(1);
          break;
        case "k":
          moveSelection(-1);
          break;
        case "Enter":
          if (current) openThread(current);
          break;
        case "e":
          if (current) runArchive(current);
          break;
        case "p":
          if (current) togglePin(current);
          break;
        case "#":
          if (current) runDelete(current);
          break;
        case "m":
          if (current) setMovePopoverOpen(true);
          break;
        case "s":
          if (current) openSnooze(current);
          break;
        case "t":
          if (current) void runConvert(current);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [moveSelection, openThread, runArchive, runDelete, openSnooze, runConvert, togglePin]);

  const onConnected = useCallback(() => {
    setConnectOpen(false);
    setReconnectTarget(null);
    void email.reload();
  }, [email]);

  const panelVariants = useMemo<RightPanelVariant[]>(
    () => [
      {
        id: "reader",
        label: "Reader",
        render: () => (
          <EmailReader
            thread={selectedThread}
            getThread={email.getThread}
            getBody={email.getBody}
            onReply={startReply}
            onConvert={selectedThread ? () => void runConvert(selectedThread) : undefined}
            listAttachments={listAttachments}
            saveAttachment={saveAttachment}
            getInlineImages={getInlineImages}
          />
        ),
      },
      {
        id: "contact",
        label: "Contact",
        render: () => (
          <EmailContactPanel
            runtime={runtime}
            workspaceId={workspaceId}
            fromName={selectedThread?.fromName ?? ""}
            fromAddr={selectedThread?.fromEmail ?? ""}
            contact={resolvedContact}
            canEdit={tasksApi.canEdit}
            onAddContact={addAsContact}
            onOpenEntity={openEntity}
          />
        ),
      },
      {
        id: "detail",
        label: "Detail",
        render: () => (
          <EmailDetailPanel
            runtime={runtime}
            workspaceId={workspaceId}
            refId={selectedRefId}
            canEdit={tasksApi.canEdit}
            onOpenEntity={openEntity}
          />
        ),
      },
      {
        id: "task",
        label: "Task",
        render: () =>
          detailTaskId ? (
            <TaskDetailPanel
              task={tasksApi.tasks.find((t) => t.id === detailTaskId) ?? null}
              buckets={tasksApi.buckets}
              inbox={tasksApi.inbox}
              canEdit={tasksApi.canEdit}
              onRequestCapture={() => {}}
              onSelectTask={setDetailTaskId}
              api={tasksApi}
            />
          ) : (
            <EmptyState
              title="No task selected"
              description="Convert an email to a task to work on it here."
            />
          ),
      },
    ],
    [
      selectedThread,
      email.getThread,
      email.getBody,
      startReply,
      runConvert,
      listAttachments,
      saveAttachment,
      getInlineImages,
      runtime,
      workspaceId,
      resolvedContact,
      selectedRefId,
      detailTaskId,
      tasksApi,
      addAsContact,
      openEntity,
    ],
  );

  // ── web: read-only tissue view (no desktop engine) ─────────────────────────
  if (!IS_DESKTOP) {
    return (
      <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-sm text-foreground">
            <Mail className="size-icon-sm text-muted-foreground" aria-hidden />
            Open Moduo on desktop to use email
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Your mailbox lives on the desktop app. Linked emails still show up here.
          </p>
        </div>

        {email.tissueRefs.length > 0 ? (
          <div className="flex flex-col gap-2">
            <div className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
              Linked emails
            </div>
            {email.tissueRefs.map((ref) => (
              <div key={ref.id} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                    {ref.fromName?.trim() || ref.fromAddr || "Unknown sender"}
                  </span>
                  {ref.sentAt ? (
                    <time
                      className="shrink-0 text-2xs tabular-nums text-muted-foreground"
                      dateTime={ref.sentAt}
                    >
                      {formatEmailDate(ref.sentAt)}
                    </time>
                  ) : null}
                </div>
                <div className="truncate text-sm text-foreground">
                  {ref.subject || "(No subject)"}
                </div>
                {ref.snippet ? (
                  <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                    {ref.snippet}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Mail}
            title="Nothing linked yet"
            description="Emails you convert or link on desktop will appear here."
          />
        )}
      </div>
    );
  }

  return (
    <>
      <FeaturePanelsShell
        feature="email"
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
          <RightPanelSwitcher
            variants={panelVariants}
            activeId={panelVariant}
            onChange={(id) => setPanelVariant(id as PanelVariantId)}
          />
        }
        center={
          <div className="relative flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 items-center justify-end border-b border-border px-2 py-1.5">
              <Button size="sm" onClick={startNew}>
                <PenSquare aria-hidden />
                New message
              </Button>
            </div>
            {view === "inbox" ? (
              <EmailThreadList
                threads={scopedThreads}
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
              <span
                aria-hidden
                className="pointer-events-none absolute left-1/2 top-2 h-0 w-0"
              />
            </EmailMovePopover>

            {/* Snooze + follow-up pickers — anchored invisibly, opened by the `s`
                key / a row action; each resolves a concrete instant on pick. */}
            <EmailSnoozePicker open={snoozeOpen} onOpenChange={setSnoozeOpen} onPick={doSnooze}>
              <span
                aria-hidden
                className="pointer-events-none absolute left-1/3 top-2 h-0 w-0"
              />
            </EmailSnoozePicker>
            <EmailSnoozePicker
              open={followUpOpen}
              onOpenChange={setFollowUpOpen}
              onPick={doFollowUp}
              title="Remind me if no reply"
              confirmLabel="Remind me"
            >
              <span
                aria-hidden
                className="pointer-events-none absolute left-2/3 top-2 h-0 w-0"
              />
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
          onSend={compose.send}
          onClose={compose.close}
        />
      ) : null}
    </>
  );
}
