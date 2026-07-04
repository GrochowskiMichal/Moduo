// The /email page (EM-4 shell + EM-5 triage). Owns the hook, the lifted scope
// (selectedAccountId) + selection (selectedThreadId), composes FeaturePanelsShell
// (left rail · center list · right reader/detail switcher), and wires keyboard-
// first triage with sonner undo toasts (the triage() undo-window pattern). On web
// (no desktop engine) it degrades to a calm read-only note + any linked-email
// cards from the cloud tissue — no fake compose/triage. Replaces EmailWorkspace.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Mail } from "lucide-react";

import { FeaturePanelsShell } from "../../../components/app/feature-panels-shell";
import {
  RightPanelSwitcher,
  type RightPanelVariant,
} from "../../../components/app/right-panel-switcher";
import { EmptyState } from "../../../components/ui/empty-state";
import { useAuth } from "../../../providers/auth-provider";
import { useWorkspace } from "../../../providers/workspace-provider";
import {
  TRIAGE_UNDO_MS,
  useEmailModule,
} from "../hooks/use-email-module";
import { resolveAccountHues } from "../accounts";
import { threadsForAccount, unreadCount } from "../threads";
import { formatEmailDate } from "../utils/email-format";
import type { EmailFolderInfo, EmailThread, SavedAccount } from "../model/email-types";
import { EmailConnectDialog } from "./email-connect-dialog";
import { EmailRail, type EmailScope } from "./email-rail";
import { EmailThreadList } from "./email-thread-list";
import { EmailReader } from "./email-reader";
import { EmailMovePopover } from "./email-move-popover";

/** Fires on the window so the nav can badge the Email tab (AC3). */
export const EMAIL_UNREAD_EVENT = "moduo:email:unread";

const IS_DESKTOP =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type PanelVariantId = "reader" | "detail";

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
  const { runtime } = useAuth();
  const { selectedWorkspaceId: workspaceId } = useWorkspace();
  const email = useEmailModule({ runtime, workspaceId, isDesktop: IS_DESKTOP });

  const [selectedAccountId, setSelectedAccountId] = useState<EmailScope>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [panelVariant, setPanelVariant] = useState<PanelVariantId>("reader");
  const [connectOpen, setConnectOpen] = useState(false);
  const [reconnectTarget, setReconnectTarget] = useState<SavedAccount | null>(null);
  const [movePopoverOpen, setMovePopoverOpen] = useState(false);

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

  const runSnooze = useCallback(() => {
    // Placeholder until EM-6 wires the real snooze picker/folder move.
    toast("Snooze lands in EM-6");
  }, []);

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
          if (current) runSnooze();
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [moveSelection, openThread, runArchive, runDelete, runSnooze, togglePin]);

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
          />
        ),
      },
      {
        id: "detail",
        label: "Detail",
        render: () => (
          <EmptyState
            title="No links yet"
            description="Links appear here once this email is in the tissue."
          />
        ),
      },
    ],
    [selectedThread, email.getThread, email.getBody],
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
            }}
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
            <EmailThreadList
              threads={scopedThreads}
              loading={email.loading}
              error={email.error}
              selectedThreadId={selectedThreadId}
              showAccountDot={selectedAccountId === null}
              accountHues={accountHues}
              onSelectThread={openThread}
              onArchive={runArchive}
              onSnooze={runSnooze}
              onDelete={runDelete}
              onRetry={() => void email.reload()}
            />

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
    </>
  );
}
