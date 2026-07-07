// Email module data + actions hook (EM-4/EM-5). Loads the unified desktop inbox
// (engine envelopes → shaped threads) plus the cloud "tissue" refs (for rail
// counts + the web view), and owns triage with a JS-held undo window (the
// undo-send pattern: the IMAP op only commits after the window, so Undo is a clean
// local restore — no fragile cross-expunge reversal).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import {
  buildRefUpsertArgs,
  isAwaitingFollowUp,
  isSnoozeDue,
  type EmailRefUpsertArgs,
} from "../refs";
import { shapeInboxThreads } from "../threads";
import type {
  EmailEnvelope,
  EmailThread,
  SavedAccount,
} from "../model/email-types";
import type { EmailAccountRef, EmailThreadRef } from "../../../lib/runtime.types";

/** How long a triage/snooze action can be undone before the IMAP op commits. */
export const TRIAGE_UNDO_MS = 8000;

export type TriageOp = "archive" | "move" | "delete";

type Params = {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  isDesktop: boolean;
};

type PendingTriage = {
  threadId: string;
  accountId: string;
  op: TriageOp;
  destFolder?: string;
  envelopes: EmailEnvelope[];
  timer: ReturnType<typeof setTimeout>;
};

type PendingSnooze = {
  threadId: string;
  accountId: string;
  at: Date;
  /** The tissue-ref payload, snapshotted at snooze time (thread may leave state). */
  refArgs: EmailRefUpsertArgs;
  envelopes: EmailEnvelope[];
  timer: ReturnType<typeof setTimeout>;
};

/** Build the `email_op_ref_upsert` payload from a thread row (snooze/follow-up). */
function refArgsFromThread(thread: EmailThread): EmailRefUpsertArgs {
  return buildRefUpsertArgs({
    threadKey: thread.threadId,
    accountId: thread.accountId,
    fromAddr: thread.fromEmail || null,
    fromName: thread.fromName || null,
    subject: thread.subject || null,
    snippet: thread.snippet || null,
    sentAt: Number.isFinite(thread.timestampMs)
      ? new Date(thread.timestampMs).toISOString()
      : null,
  });
}

export function useEmailModule({ runtime, workspaceId, isDesktop }: Params) {
  const [accounts, setAccounts] = useState<SavedAccount[]>([]);
  const [envelopes, setEnvelopes] = useState<EmailEnvelope[]>([]);
  const [tissueRefs, setTissueRefs] = useState<EmailThreadRef[]>([]);
  const [tissueAccounts, setTissueAccounts] = useState<EmailAccountRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Threads optimistically snoozed this session (hidden before the cloud confirms
  // is_snoozed), so the row disappears the instant you snooze it.
  const [optimisticSnoozed, setOptimisticSnoozed] = useState<Set<string>>(
    () => new Set(),
  );

  const reqRef = useRef(0);
  const pendingRef = useRef<Map<string, PendingTriage>>(new Map());
  const pendingSnoozeRef = useRef<Map<string, PendingSnooze>>(new Map());
  const folder = "inbox";

  const load = useCallback(
    async (forceSync = false) => {
      if (!runtime) {
        setLoading(false);
        return;
      }
      const req = ++reqRef.current;
      setLoading(true);
      setError(null);
      try {
        // Cloud tissue (both platforms; degrades to empty pre-migration).
        if (workspaceId) {
          try {
            const bundle = await runtime.email.listModule(workspaceId);
            if (reqRef.current === req) {
              setTissueRefs(bundle.refs ?? []);
              setTissueAccounts(bundle.accounts ?? []);
            }
          } catch {
            /* tissue is best-effort */
          }
        }
        // Desktop engine (the actual inbox).
        if (isDesktop) {
          const acc = (await runtime.email.listAccounts()) as SavedAccount[];
          const res = await runtime.email.listEnvelopes({
            accountId: null,
            folder,
            limit: 500,
            forceSync,
          });
          if (reqRef.current !== req) return;
          setAccounts(acc ?? []);
          setEnvelopes((res?.envelopes ?? []) as EmailEnvelope[]);
        }
      } catch (e) {
        if (reqRef.current === req) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (reqRef.current === req) setLoading(false);
      }
    },
    [runtime, workspaceId, isDesktop],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  /**
   * Re-pull just the cloud tissue (accounts + refs) without the full-load loading
   * flash. Used after a snooze/follow-up write and by the 60s restore orchestrator
   * so the rail counts + snoozed-hide set stay fresh without a skeleton flicker.
   */
  const refreshTissue = useCallback(async () => {
    if (!runtime || !workspaceId) return;
    try {
      const bundle = await runtime.email.listModule(workspaceId);
      setTissueRefs(bundle.refs ?? []);
      setTissueAccounts(bundle.accounts ?? []);
    } catch {
      /* best-effort */
    }
  }, [runtime, workspaceId]);

  // Keep a live ref for use inside setTimeout callbacks (avoid stale closures).
  const refreshTissueRef = useRef(refreshTissue);
  refreshTissueRef.current = refreshTissue;
  const workspaceIdRef = useRef(workspaceId);
  workspaceIdRef.current = workspaceId;

  // Commit any still-pending triage/snooze immediately on unmount (don't lose ops).
  useEffect(() => {
    const pendingTriages = pendingRef.current;
    const pendingSnoozes = pendingSnoozeRef.current;
    return () => {
      for (const entry of pendingTriages.values()) {
        clearTimeout(entry.timer);
        void commitTriage(runtime, entry);
      }
      pendingTriages.clear();
      for (const entry of pendingSnoozes.values()) {
        clearTimeout(entry.timer);
        void commitSnooze(runtime, workspaceIdRef.current, entry);
      }
      pendingSnoozes.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime]);

  // Threads whose messages are snoozed away from the inbox — the server-side move
  // to Moduo/Snoozed drops them on the next sync, but until then (and for the
  // local-hide fallback where the mail never physically leaves) the cloud
  // `is_snoozed` flag + the optimistic set keep the inbox honest.
  const hiddenThreadKeys = useMemo(() => {
    const set = new Set(optimisticSnoozed);
    for (const ref of tissueRefs) {
      if (ref.isSnoozed) set.add(ref.threadKey);
    }
    return set;
  }, [tissueRefs, optimisticSnoozed]);

  const threads = useMemo(() => {
    const shaped = shapeInboxThreads(envelopes, accounts);
    return hiddenThreadKeys.size === 0
      ? shaped
      : shaped.filter((t) => !hiddenThreadKeys.has(t.threadId));
  }, [envelopes, accounts, hiddenThreadKeys]);

  const syncNow = useCallback(async () => {
    if (!runtime || !isDesktop) return;
    setSyncing(true);
    try {
      await runtime.email.syncNow({ accountId: null, folder });
      await load(true);
    } finally {
      setSyncing(false);
    }
  }, [runtime, isDesktop, load]);

  /** Toggle the pin/star flag on a thread (exact, reversible undo). */
  const toggleStar = useCallback(
    async (thread: EmailThread, value: boolean) => {
      if (!runtime || !isDesktop) return;
      const targets = envelopes.filter(
        (e) => e.accountId === thread.accountId && e.threadId === thread.threadId,
      );
      // Optimistic local flag flip.
      setEnvelopes((prev) =>
        prev.map((e) =>
          e.accountId === thread.accountId && e.threadId === thread.threadId
            ? { ...e, starred: value }
            : e,
        ),
      );
      await Promise.all(
        targets.map((e) =>
          runtime.email.applyFlag({
            accountId: e.accountId,
            folder: e.folder,
            uid: e.uid,
            flag: "starred",
            value,
          }),
        ),
      ).catch(() => void load(false));
    },
    [runtime, isDesktop, envelopes, load],
  );

  /** Mark a thread read/unread (used when opening it in the reader). */
  const markRead = useCallback(
    async (thread: EmailThread, read: boolean) => {
      if (!runtime || !isDesktop) return;
      const targets = envelopes.filter(
        (e) => e.accountId === thread.accountId && e.threadId === thread.threadId && e.read !== read,
      );
      if (targets.length === 0) return;
      setEnvelopes((prev) =>
        prev.map((e) =>
          e.accountId === thread.accountId && e.threadId === thread.threadId ? { ...e, read } : e,
        ),
      );
      await Promise.all(
        targets.map((e) =>
          runtime.email.applyFlag({
            accountId: e.accountId,
            folder: e.folder,
            uid: e.uid,
            flag: "seen",
            value: read,
          }),
        ),
      ).catch(() => {});
    },
    [runtime, isDesktop, envelopes],
  );

  /**
   * Archive/move/delete a thread. Optimistically hides its messages and returns an
   * `undo` fn; the IMAP op only fires after {@link TRIAGE_UNDO_MS} (or immediately
   * on unmount). Undo before then is a pure local restore.
   */
  const triage = useCallback(
    (thread: EmailThread, op: TriageOp, destFolder?: string): (() => void) => {
      const targets = envelopes.filter(
        (e) => e.accountId === thread.accountId && e.threadId === thread.threadId,
      );
      // Hide locally right away.
      setEnvelopes((prev) =>
        prev.filter(
          (e) => !(e.accountId === thread.accountId && e.threadId === thread.threadId),
        ),
      );

      const key = `${thread.accountId}::${thread.threadId}`;
      const existing = pendingRef.current.get(key);
      if (existing) clearTimeout(existing.timer);

      const timer = setTimeout(() => {
        const entry = pendingRef.current.get(key);
        pendingRef.current.delete(key);
        if (entry) void commitTriage(runtime, entry);
      }, TRIAGE_UNDO_MS);

      pendingRef.current.set(key, {
        threadId: thread.threadId,
        accountId: thread.accountId,
        op,
        destFolder,
        envelopes: targets,
        timer,
      });

      return () => {
        const entry = pendingRef.current.get(key);
        if (!entry) return;
        clearTimeout(entry.timer);
        pendingRef.current.delete(key);
        // Restore the hidden messages (no IMAP op ever ran).
        setEnvelopes((prev) => [...prev, ...entry.envelopes]);
      };
    },
    [runtime, envelopes],
  );

  /**
   * Snooze a thread (AC6). Hides it immediately and returns an `undo` fn; the cloud
   * state + IMAP move to Moduo/Snoozed only fire after {@link TRIAGE_UNDO_MS} (or on
   * unmount), so Undo before then is a pure local restore — mirrors triage().
   */
  const snooze = useCallback(
    (thread: EmailThread, at: Date): (() => void) => {
      const threadId = thread.threadId;
      const targets = envelopes.filter(
        (e) => e.accountId === thread.accountId && e.threadId === threadId,
      );
      setOptimisticSnoozed((prev) => {
        const next = new Set(prev);
        next.add(threadId);
        return next;
      });

      const key = `${thread.accountId}::${threadId}`;
      const existing = pendingSnoozeRef.current.get(key);
      if (existing) clearTimeout(existing.timer);

      const timer = setTimeout(() => {
        const entry = pendingSnoozeRef.current.get(key);
        pendingSnoozeRef.current.delete(key);
        if (!entry) return;
        void commitSnooze(runtime, workspaceIdRef.current, entry).then(() => {
          // The cloud is_snoozed now keeps it hidden; drop the optimistic marker.
          void refreshTissueRef.current().then(() =>
            setOptimisticSnoozed((prev) => {
              const next = new Set(prev);
              next.delete(threadId);
              return next;
            }),
          );
        });
      }, TRIAGE_UNDO_MS);

      pendingSnoozeRef.current.set(key, {
        threadId,
        accountId: thread.accountId,
        at,
        refArgs: refArgsFromThread(thread),
        envelopes: targets,
        timer,
      });

      return () => {
        const entry = pendingSnoozeRef.current.get(key);
        if (!entry) return;
        clearTimeout(entry.timer);
        pendingSnoozeRef.current.delete(key);
        setOptimisticSnoozed((prev) => {
          const next = new Set(prev);
          next.delete(threadId);
          return next;
        });
      };
    },
    [runtime, envelopes],
  );

  /** Bring a snoozed thread back to the inbox now (cloud unsnooze + IMAP restore). */
  const unsnooze = useCallback(
    async (ref: EmailThreadRef) => {
      if (!runtime || !workspaceId) return;
      try {
        await runtime.email.unsnooze({ workspaceId, refId: ref.id });
        if (isDesktop && ref.accountId) {
          await runtime.email.snoozeRestore({
            accountId: ref.accountId,
            threadId: ref.threadKey,
          });
        }
      } finally {
        setOptimisticSnoozed((prev) => {
          const next = new Set(prev);
          next.delete(ref.threadKey);
          return next;
        });
        await refreshTissue();
      }
    },
    [runtime, workspaceId, isDesktop, refreshTissue],
  );

  /** Arm a "remind me if no reply by X" follow-up on a thread (AC7). */
  const setFollowUp = useCallback(
    async (thread: EmailThread, at: Date) => {
      if (!runtime || !workspaceId) return;
      const ref = await runtime.email.upsertRef({
        workspaceId,
        ...refArgsFromThread(thread),
      });
      await runtime.email.followUp({
        workspaceId,
        refId: ref.id,
        followUpAt: at.toISOString(),
      });
      await refreshTissue();
    },
    [runtime, workspaceId, refreshTissue],
  );

  /** Clear a follow-up manually (the counterpart-reply path clears it silently). */
  const clearFollowUpFor = useCallback(
    async (ref: EmailThreadRef) => {
      if (!runtime || !workspaceId) return;
      await runtime.email.clearFollowUp({ workspaceId, refId: ref.id });
      await refreshTissue();
    },
    [runtime, workspaceId, refreshTissue],
  );

  const getThread = useCallback(
    async (accountId: string, threadId: string): Promise<EmailEnvelope[]> => {
      if (!runtime || !isDesktop) return [];
      const res = await runtime.email.getThread({ accountId, threadId });
      return (res?.messages ?? []) as EmailEnvelope[];
    },
    [runtime, isDesktop],
  );

  const getBody = useCallback(
    async (accountId: string, folderName: string, uid: number) => {
      if (!runtime || !isDesktop) return null;
      return runtime.email.getMessageBody({ accountId, folder: folderName, uid });
    },
    [runtime, isDesktop],
  );

  const snoozed = useMemo(() => tissueRefs.filter((r) => r.isSnoozed), [tissueRefs]);
  const snoozedDue = useMemo(
    () => tissueRefs.filter((r) => isSnoozeDue(r, Date.now())),
    [tissueRefs],
  );
  const followUps = useMemo(() => tissueRefs.filter(isAwaitingFollowUp), [tissueRefs]);

  return {
    accounts,
    envelopes,
    threads,
    loading,
    syncing,
    error,
    tissueRefs,
    tissueAccounts,
    snoozed,
    snoozedDue,
    followUps,
    folder,
    reload: () => load(false),
    refreshTissue,
    syncNow,
    toggleStar,
    markRead,
    triage,
    snooze,
    unsnooze,
    setFollowUp,
    clearFollowUpFor,
    getThread,
    getBody,
  };
}

export type EmailModuleApi = ReturnType<typeof useEmailModule>;

async function commitSnooze(
  runtime: ModuoRuntime | null,
  workspaceId: string | null,
  entry: PendingSnooze,
): Promise<void> {
  if (!runtime || !workspaceId) return;
  try {
    // 1. Ensure the tissue ref (idempotent) so snooze state has a backing row.
    const ref = await runtime.email.upsertRef({ workspaceId, ...entry.refArgs });
    // 2. Cloud snooze state (drives the rail count, web view, restore + widget).
    await runtime.email.snooze({
      workspaceId,
      refId: ref.id,
      snoozeUntil: entry.at.toISOString(),
    });
    // 3. Server move to Moduo/Snoozed (best-effort; local-hide fallback in Rust).
    await runtime.email.snoozeThread({
      accountId: entry.accountId,
      threadId: entry.threadId,
      uids: entry.envelopes.map((e) => e.uid),
    });
  } catch {
    /* best-effort — the optimistic hide clears on next reload if the cloud is
       degraded pre-migration; nothing is lost server-side. */
  }
}

async function commitTriage(runtime: ModuoRuntime | null, entry: PendingTriage): Promise<void> {
  if (!runtime) return;
  // Apply the op to every message of the thread in its folder.
  await Promise.all(
    entry.envelopes.map((e) =>
      runtime.email.applyMessageOp({
        accountId: e.accountId,
        folder: e.folder,
        uid: e.uid,
        op: entry.op,
        destFolder: entry.destFolder ?? null,
      }),
    ),
  ).catch(() => {});
}
