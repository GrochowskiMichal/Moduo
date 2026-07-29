// The /email page (EM-4 shell + EM-5 triage). Owns the hook, the lifted scope
// (selectedAccountId) + selection (selectedThreadId), composes FeaturePanelsShell
// (left rail · center list · right reader/detail switcher), and wires keyboard-
// first triage with sonner undo toasts (the triage() undo-window pattern). On web
// (no desktop engine) it degrades to a calm read-only note + any linked-email
// cards from the cloud tissue — no fake compose/triage.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { AlertTriangle, Mail, PenSquare, RefreshCw } from "lucide-react";

import { FeaturePanelsShell } from "../../../components/app/feature-panels-shell";
import { onCreateNew } from "../../../components/app/create-events";
import {
  RightPanelSwitcher,
  type RightPanelVariant,
} from "../../../components/app/right-panel-switcher";
import { Button } from "../../../components/ui/button";
import { EmptyState } from "../../../components/ui/empty-state";
import { IconButton } from "../../../components/ui/icon-button";
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
import {
  flattenSections,
  groupThreadsBySection,
  senderKey,
  type EmailSection,
} from "../classify";
import { useEmailPrefs } from "../hooks/use-email-prefs";
import { useEmailSearch } from "../hooks/use-email-search";
import { EmailSearchFooter, EmailSearchInput } from "./email-search-bar";
import { formatSnoozeUntil } from "../snooze";
import { buildRefUpsertArgs } from "../refs";
import { blankDraft, buildComposeDraft, type ComposeMode } from "../compose";
import {
  buildConvertDescription,
  cleanTaskTitle,
  resolveContactIdByAddress,
  spawnedFromLinkArgs,
} from "../convert";
import { formatEmailDate, formatEmailDetailDate } from "../utils/email-format";
import { takeEntityOpenIntent } from "../../../lib/entity-open";
import {
  EMAIL_OPEN_THREAD_EVENT,
  resolveEmailThreadTarget,
} from "../url-search";
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
import { EmailShortcutsDialog } from "./email-shortcuts-dialog";

/** Fires on the window so the nav can badge the Email tab (AC3). */
export const EMAIL_UNREAD_EVENT = "moduo:email:unread";

const IS_DESKTOP =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Poll briefly for a deep-link target row/card (it renders after a scope reset
 * or the inbox load settles over a few frames), then scroll it into view.
 * `onDone(found)` fires once so the caller can degrade on a miss (DF-2). */
function revealBySelector(selector: string, onDone?: (found: boolean) => void): void {
  if (typeof document === "undefined") {
    onDone?.(false);
    return;
  }
  let tries = 0;
  const step = () => {
    const el = document.querySelector(selector);
    if (el) {
      el.scrollIntoView({ block: "center" });
      onDone?.(true);
      return;
    }
    if (++tries < 24) requestAnimationFrame(step);
    else onDone?.(false);
  };
  requestAnimationFrame(step);
}

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

/** One tissue email card for the web read-only view (AC15). Carries the ref +
 * thread ids so a `?thread=` deep link can scroll to it (DF-2). */
function WebTissueCard({
  thread,
  meta,
  highlighted = false,
}: {
  thread: EmailThreadRef;
  meta?: string | null;
  highlighted?: boolean;
}) {
  return (
    <div
      data-thread-ref-id={thread.id}
      data-thread-key={thread.threadKey}
      className={
        "rounded-lg border bg-card p-3 transition-colors duration-(--motion-fade) ease-(--ease-out) " +
        (highlighted ? "border-ring ring-2 ring-ring" : "border-border")
      }
    >
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {thread.fromName?.trim() || thread.fromAddr || "Unknown sender"}
        </span>
        {thread.sentAt ? (
          <time className="shrink-0 text-2xs tabular-nums text-muted-foreground" dateTime={thread.sentAt}>
            {formatEmailDate(thread.sentAt)}
          </time>
        ) : null}
      </div>
      <div className="truncate text-sm text-foreground">{thread.subject || "(No subject)"}</div>
      {thread.snippet ? (
        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{thread.snippet}</p>
      ) : null}
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="text-2xs text-muted-foreground">{meta ?? ""}</span>
        <span className="text-2xs text-muted-foreground/70">Continue on desktop</span>
      </div>
    </div>
  );
}

function WebTissueSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

type EmailPageViewProps = {
  /** Inbound `?thread=` deep link (DF-2) — select + scroll the thread (desktop)
   * or its tissue card (web). Accepts a raw threadId or an `email_thread` ref id. */
  urlThreadId?: string | null;
  /** Called once the deep link is applied (or found stale) so the page can
   * clear the URL param. */
  onConsumeThreadDeepLink?: () => void;
};

export function EmailPageView({
  urlThreadId = null,
  onConsumeThreadDeepLink,
}: EmailPageViewProps = {}) {
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
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

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
      selectedAccountId
        ? email.accounts.filter((a) => a.id === selectedAccountId)
        : email.accounts,
    [email.accounts, selectedAccountId],
  );

  // DF-6: accounts in the current scope that have silently stopped syncing —
  // surfaced as a banner (the rail glyphs alone were invisible on All inboxes).
  const brokenAccounts = useMemo(
    () => scopedAccounts.filter((a) => a.status !== "active"),
    [scopedAccounts],
  );

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
  // A widget row / linked chip / notification opens a specific thread — via the
  // URL (?thread=) or a one-shot in-app event. Both feed one pending target,
  // applied once the inbox/tissue has loaded: desktop selects + scrolls the
  // row; web scrolls its tissue card. The id may be a raw threadId or an
  // `email_thread` ref id (what spine links + the widget carry).
  const [pendingThreadTarget, setPendingThreadTarget] = useState<string | null>(null);
  const [highlightedRefId, setHighlightedRefId] = useState<string | null>(null);
  const processedUrlThreadRef = useRef<string | null>(null);

  // URL → pending (consume-once, then clear the param; the id lives in state).
  useEffect(() => {
    if (!urlThreadId) {
      processedUrlThreadRef.current = null;
      return;
    }
    if (processedUrlThreadRef.current === urlThreadId) return;
    processedUrlThreadRef.current = urlThreadId;
    takeEntityOpenIntent(urlThreadId); // spend the "take me there" mark
    setPendingThreadTarget(urlThreadId);
    onConsumeThreadDeepLink?.();
  }, [urlThreadId, onConsumeThreadDeepLink]);

  // One-shot in-app event → pending (same resolution, no router round-trip).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOpenThread = (e: Event) => {
      const id = (e as CustomEvent<{ id?: string }>).detail?.id;
      if (id) setPendingThreadTarget(id);
    };
    window.addEventListener(EMAIL_OPEN_THREAD_EVENT, onOpenThread);
    return () => window.removeEventListener(EMAIL_OPEN_THREAD_EVENT, onOpenThread);
  }, []);

  // Apply once the inbox/tissue has loaded (so a not-yet-synced id isn't judged
  // stale prematurely).
  useEffect(() => {
    if (!pendingThreadTarget || email.loading) return;
    const id = pendingThreadTarget;
    setPendingThreadTarget(null);
    const target = resolveEmailThreadTarget(id, {
      threads: email.threads,
      refs: email.tissueRefs,
    });

    if (IS_DESKTOP) {
      const inInbox =
        target.kind === "thread" && email.threads.some((t) => t.threadId === target.threadId);
      if (!inInbox) {
        toast("Couldn't find that email", {
          description: "It may have been archived or isn't in this inbox.",
        });
        return;
      }
      // Land the row where it actually renders: the inbox view with no account
      // scope or search filter (sub-views / search results don't carry
      // `data-thread-id`, and a single-account scope would drop the selection
      // via the auto-clear effect above). Then select + scroll it into view.
      setView("inbox");
      search.clear();
      setSelectedAccountId(null);
      setSelectedThreadId(target.threadId);
      setPanelVariant("reader");
      revealBySelector(`[data-thread-id="${CSS.escape(target.threadId)}"]`);
      return;
    }

    // Web: route to the thread's tissue card (its read-only web representation).
    const refId = target.kind === "thread" ? target.refId : null;
    if (!refId) {
      toast("Couldn't find that email here", {
        description: "It isn't among your linked emails — open Moduo on desktop to read it.",
      });
      return;
    }
    setHighlightedRefId(refId);
    revealBySelector(`[data-thread-ref-id="${CSS.escape(refId)}"]`, (found) => {
      if (!found) {
        toast("Open Moduo on desktop to read this email", {
          description: "It's linked here but not shown on the web view.",
        });
      }
    });
  }, [pendingThreadTarget, email.loading, email.threads, email.tissueRefs]);

  // Clear the web card highlight after a beat.
  useEffect(() => {
    if (!highlightedRefId) return;
    const t = window.setTimeout(() => setHighlightedRefId(null), 2000);
    return () => window.clearTimeout(t);
  }, [highlightedRefId]);

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

  /**
   * Best-effort reverse teardown of everything a convert created — shared by
   * the undo toast AND the mid-sequence failure compensation (DF-6) so the two
   * paths can't drift. Each step is individually best-effort (a failed task
   * delete doesn't stop the link/ref cleanup). Only removes the ref/contact
   * link when THIS convert created them.
   */
  const deleteConvertArtifacts = useCallback(
    async (plan: {
      taskId: string | null;
      spawnLinkId: string | null;
      contactLinkId: string | null;
      refId: string | null;
      refCreated: boolean;
    }) => {
      if (!runtime || !workspaceId) return;
      if (plan.taskId) {
        await runtime.tasks.deleteTask({ workspaceId, taskId: plan.taskId }).catch(() => {});
      }
      if (plan.spawnLinkId) {
        await runtime.spine
          .deleteLink({ workspaceId, linkId: plan.spawnLinkId })
          .catch(() => {});
      }
      if (plan.contactLinkId) {
        await runtime.spine
          .deleteLink({ workspaceId, linkId: plan.contactLinkId })
          .catch(() => {});
      }
      if (plan.refId && plan.refCreated) {
        await runtime.email.removeRef({ workspaceId, refId: plan.refId }).catch((err) => {
          // Best-effort: the ref is linkless by now, so a failure here only leaves a
          // stray tissue row — never block the undo. (`email_op_ref_remove` was
          // undeployed until OPS-1 applied it 2026-07-29; this catch is now purely
          // defensive, so warn rather than swallow — a silent failure is invisible.)
          console.warn("email: convert-undo could not remove the ref", err);
        });
      }
    },
    [runtime, workspaceId],
  );

  const undoConvert = useCallback(
    async (plan: {
      taskId: string;
      refId: string;
      refCreated: boolean;
      spawnLinkId: string | null;
      contactLinkId: string | null;
    }) => {
      await deleteConvertArtifacts(plan);
      setDetailTaskId(null);
      setPanelVariant("reader");
      void tasksApi.reload();
      void email.refreshTissue();
    },
    [deleteConvertArtifacts, tasksApi, email],
  );

  const runConvert = useCallback(
    async (thread: EmailThread) => {
      if (!runtime || !workspaceId) return;
      const inbox = tasksApi.inbox;
      if (!inbox) {
        toast.error("Your Tasks inbox isn't ready yet.");
        return;
      }
      // DF-6: the sequence is non-atomic (separate RPCs) — track what each step
      // created so a mid-sequence failure can compensate instead of stranding
      // an orphan task/ref in another module.
      const refExisted = email.tissueRefs.some((r) => r.threadKey === thread.threadId);
      let createdRefId: string | null = null;
      let createdTaskId: string | null = null;
      let createdSpawnLinkId: string | null = null;
      let createdContactLinkId: string | null = null;
      try {
        const ref = await runtime.email.upsertRef({ workspaceId, ...refArgsForThread(thread) });
        createdRefId = ref.id;

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
        createdTaskId = saved.id;

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
        createdSpawnLinkId = spawn?.id ?? null;

        // email_thread --references--> contact (when the sender is a known contact)
        const contactId = resolveContactIdByAddress(thread.fromEmail ?? null, contactIndex);
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
          createdContactLinkId = alreadyLinked ? null : (link?.id ?? null);
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
          contactLinkId: createdContactLinkId,
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
        // DF-6: compensate — tear down whatever this convert managed to create
        // so a partial failure leaves nothing behind in Tasks or the spine.
        await deleteConvertArtifacts({
          taskId: createdTaskId,
          spawnLinkId: createdSpawnLinkId,
          contactLinkId: createdContactLinkId,
          refId: createdRefId,
          refCreated: !refExisted,
        });
        void tasksApi.reload();
        void email.refreshTissue();
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
      deleteConvertArtifacts,
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
      let createdTaskId: string | null = null;
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
        createdTaskId = saved.id;
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
        // DF-6: don't strand a linkless orphan task when the spawn link fails.
        // The ref pre-existed here (it came from the tissue), so never remove it.
        if (createdTaskId) {
          await deleteConvertArtifacts({
            taskId: createdTaskId,
            spawnLinkId: null,
            contactLinkId: null,
            refId: null,
            refCreated: false,
          });
          void tasksApi.reload();
        }
        toast.error(e instanceof Error ? e.message : "Couldn't convert to a task.");
      }
    },
    [runtime, workspaceId, tasksApi, deleteConvertArtifacts],
  );

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
  scopedRef.current = orderedThreads;
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
        case "r":
          if (current) void startReply("reply");
          break;
        case "?":
          setShortcutsOpen(true);
          break;
        case "/":
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    // Capture phase so email's own keys — notably `?` for the triage legend —
    // run BEFORE the bubble-phase global shortcut handler (app-chrome's
    // useGlobalShortcuts). It preventDefaults what it handles; the global `?`
    // sheet then sees defaultPrevented and stays closed on /email. All keys here
    // are already guarded on modifiers + typing targets, so capture is safe.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    moveSelection,
    openThread,
    runArchive,
    runDelete,
    openSnooze,
    runConvert,
    togglePin,
    startReply,
  ]);

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
            imageAllowedSenders={imageAllowedSenders}
            onAllowSenderImages={allowSenderImages}
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
      imageAllowedSenders,
      allowSenderImages,
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

  // ── web: read-only tissue view (no desktop engine, AC15) ───────────────────
  if (!IS_DESKTOP) {
    const now = new Date();
    // Recently pulled-into-tissue threads, newest first, minus those already shown
    // under Snoozed / Follow-ups so a thread appears once.
    const shownIds = new Set([
      ...email.snoozed.map((r) => r.id),
      ...email.followUps.map((r) => r.id),
    ]);
    const recentLinked = [...email.tissueRefs]
      .filter((r) => !shownIds.has(r.id))
      .sort((a, b) => Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || ""))
      .slice(0, 12);
    const hasAny =
      email.snoozed.length > 0 || email.followUps.length > 0 || recentLinked.length > 0;
    return (
      <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-sm text-foreground">
            <Mail className="size-icon-sm text-muted-foreground" aria-hidden />
            Open Moduo on desktop to use email
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Your mailbox lives on the desktop app. Snoozed, follow-ups, and linked emails show here.
          </p>
        </div>

        {email.snoozed.length > 0 ? (
          <WebTissueSection label="Snoozed">
            {email.snoozed.map((ref) => (
              <WebTissueCard
                key={ref.id}
                thread={ref}
                highlighted={highlightedRefId === ref.id}
                meta={ref.snoozeUntil ? `Returns ${formatSnoozeUntil(ref.snoozeUntil, now)}` : null}
              />
            ))}
          </WebTissueSection>
        ) : null}

        {email.followUps.length > 0 ? (
          <WebTissueSection label="Follow-ups due">
            {email.followUps.map((ref) => (
              <WebTissueCard
                key={ref.id}
                thread={ref}
                highlighted={highlightedRefId === ref.id}
                meta={ref.followUpAt ? `Reply by ${formatEmailDate(ref.followUpAt)}` : null}
              />
            ))}
          </WebTissueSection>
        ) : null}

        {recentLinked.length > 0 ? (
          <WebTissueSection label="Recently linked">
            {recentLinked.map((ref) => (
              <WebTissueCard
                key={ref.id}
                thread={ref}
                highlighted={highlightedRefId === ref.id}
              />
            ))}
          </WebTissueSection>
        ) : null}

        {!hasAny ? (
          <EmptyState
            icon={Mail}
            title="Nothing linked yet"
            description="Emails you convert, link, snooze, or follow up on desktop appear here."
          />
        ) : null}
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
            {/* DF-6: a broken account silently contributes nothing to this scope —
                say so instead of letting mail quietly stop arriving. */}
            {brokenAccounts.length > 0 ? (
              <div
                role="status"
                className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-warning/10 px-3 py-1.5 text-xs text-foreground"
              >
                <AlertTriangle className="size-icon-xs shrink-0 text-warning" aria-hidden />
                <span className="min-w-0 flex-1">
                  {brokenAccounts.length === 1
                    ? `${brokenAccounts[0].email} isn't syncing — new mail may be missing.`
                    : `${brokenAccounts.length} accounts aren't syncing — new mail may be missing.`}
                </span>
                {brokenAccounts
                  .filter((a) => a.status === "reauth_required")
                  .map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => setReconnectTarget(a)}
                      className="shrink-0 rounded-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Reconnect{brokenAccounts.length > 1 ? ` ${a.email}` : ""}
                    </button>
                  ))}
                {brokenAccounts.some((a) => a.status === "error") ? (
                  <button
                    type="button"
                    onClick={() => void email.syncNow()}
                    className="shrink-0 rounded-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Retry sync
                  </button>
                ) : null}
              </div>
            ) : null}
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
          workspaceId={workspaceId}
          onSend={compose.send}
          onClose={compose.close}
        />
      ) : null}

      <EmailShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </>
  );
}
