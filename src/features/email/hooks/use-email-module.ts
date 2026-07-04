// Email module data + actions hook (EM-4/EM-5). Loads the unified desktop inbox
// (engine envelopes → shaped threads) plus the cloud "tissue" refs (for rail
// counts + the web view), and owns triage with a JS-held undo window (the
// undo-send pattern: the IMAP op only commits after the window, so Undo is a clean
// local restore — no fragile cross-expunge reversal).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { isAwaitingFollowUp, isSnoozeDue } from "../refs";
import { shapeInboxThreads } from "../threads";
import type {
  EmailEnvelope,
  EmailThread,
  SavedAccount,
} from "../model/email-types";
import type { EmailAccountRef, EmailThreadRef } from "../../../lib/runtime.types";

/** How long a triage action can be undone before the IMAP op commits. */
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

export function useEmailModule({ runtime, workspaceId, isDesktop }: Params) {
  const [accounts, setAccounts] = useState<SavedAccount[]>([]);
  const [envelopes, setEnvelopes] = useState<EmailEnvelope[]>([]);
  const [tissueRefs, setTissueRefs] = useState<EmailThreadRef[]>([]);
  const [tissueAccounts, setTissueAccounts] = useState<EmailAccountRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reqRef = useRef(0);
  const pendingRef = useRef<Map<string, PendingTriage>>(new Map());
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

  // Commit any still-pending triage immediately on unmount (don't lose ops).
  useEffect(() => {
    const pending = pendingRef.current;
    return () => {
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        void commitTriage(runtime, entry);
      }
      pending.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runtime]);

  const threads = useMemo(() => shapeInboxThreads(envelopes, accounts), [envelopes, accounts]);

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
    syncNow,
    toggleStar,
    markRead,
    triage,
    getThread,
    getBody,
  };
}

export type EmailModuleApi = ReturnType<typeof useEmailModule>;

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
