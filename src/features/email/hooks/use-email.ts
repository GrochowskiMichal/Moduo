import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  connectCallback,
  connectInit,
  disconnectAccount,
  getThread,
  listAccounts,
  listFolders,
  listThreads,
  sendEmail,
  syncAccount,
  upsertCustomAccount,
} from "../api/client";
import { emailLocalDB } from "../db/local-db";
import type {
  EmailAccount,
  EmailComposeDraft,
  EmailFolder,
  EmailMessage,
  EmailProvider,
  EmailSendInput,
  EmailSyncStatus,
  EmailThread,
} from "../types";

type Params = {
  supabase: SupabaseClient | null;
  userId: string | null;
  workspaceId: string | null;
};

function draftEmpty(): EmailComposeDraft {
  return { to: "", cc: "", bcc: "", subject: "", bodyText: "" };
}

function parseEmails(value: string): Array<{ email: string; name?: string }> {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((email) => ({ email }));
}

export function useEmail({ supabase, userId, workspaceId }: Params) {
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [folders, setFolders] = useState<EmailFolder[]>([]);
  const [threads, setThreads] = useState<EmailThread[]>([]);
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [threadsCursor, setThreadsCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<EmailSyncStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [composeDraft, setComposeDraft] = useState<EmailComposeDraft>(() => draftEmpty());
  const [sending, setSending] = useState(false);

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === selectedAccountId) ?? null,
    [accounts, selectedAccountId]
  );

  const selectedFolder = useMemo(
    () => folders.find((folder) => folder.id === selectedFolderId) ?? null,
    [folders, selectedFolderId]
  );

  const selectedThread = useMemo(
    () => threads.find((thread) => thread.id === selectedThreadId) ?? null,
    [selectedThreadId, threads]
  );

  const loadAccounts = useCallback(async () => {
    if (!supabase || !workspaceId) {
      setAccounts([]);
      setSelectedAccountId(null);
      return;
    }

    const next = await listAccounts(supabase, workspaceId);
    setAccounts(next);
    setSelectedAccountId((current) => (current && next.some((account) => account.id === current) ? current : next[0]?.id ?? null));
    await emailLocalDB.accounts.bulkPut(next);
  }, [supabase, workspaceId]);

  const loadFolders = useCallback(async () => {
    if (!supabase || !selectedAccountId) {
      setFolders([]);
      setSelectedFolderId(null);
      return;
    }

    const next = await listFolders(supabase, selectedAccountId);
    setFolders(next);
    const inbox = next.find((folder) => folder.kind === "inbox")?.id ?? next[0]?.id ?? null;
    setSelectedFolderId((current) => (current && next.some((folder) => folder.id === current) ? current : inbox));
    await emailLocalDB.folders.bulkPut(next);
  }, [selectedAccountId, supabase]);

  const loadThreads = useCallback(
    async (append = false) => {
      if (!supabase || !selectedAccountId) {
        setThreads([]);
        setThreadsCursor(null);
        return;
      }

      let page;
      try {
        page = await listThreads(supabase, {
          accountId: selectedAccountId,
          folderId: selectedFolderId ?? undefined,
          cursor: append ? threadsCursor ?? undefined : undefined,
          limit: 30,
        });
      } catch (err: any) {
        setThreads([]);
        setThreadsCursor(null);
        setSelectedThreadId(null);
        setError(err?.message ?? "Failed to load threads");
        return;
      }

      setThreads((current) => {
        const next = append ? [...current, ...page.threads] : page.threads;
        void emailLocalDB.threads.bulkPut(next);
        return next;
      });
      setThreadsCursor(page.nextCursor);
      if (!append) {
        setSelectedThreadId(page.threads[0]?.id ?? null);
      }
    },
    [selectedAccountId, selectedFolderId, supabase, threadsCursor]
  );

  const loadThreadMessages = useCallback(async () => {
    if (!supabase || !selectedThreadId) {
      setMessages([]);
      return;
    }
    const detail = await getThread(supabase, selectedThreadId);
    setMessages(detail.messages);
    await emailLocalDB.messages.bulkPut(detail.messages);
  }, [selectedThreadId, supabase]);

  const refreshAll = useCallback(async () => {
    if (!supabase || !workspaceId || !userId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await loadAccounts();
    } catch (err: any) {
      setError(err?.message ?? "Failed to load email accounts.");
    } finally {
      setLoading(false);
    }
  }, [loadAccounts, supabase, userId, workspaceId]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    void loadFolders();
  }, [loadFolders]);

  useEffect(() => {
    void loadThreads(false);
  }, [loadThreads]);

  useEffect(() => {
    void loadThreadMessages();
  }, [loadThreadMessages]);

  useEffect(() => {
    if (!supabase || !selectedAccountId) return;
    const id = setInterval(() => {
      setSyncStatus("syncing");
      void syncAccount(supabase, selectedAccountId)
        .then(() => loadThreads(false))
        .then(() => setSyncStatus("synced"))
        .catch((err: any) => {
          setSyncStatus("error");
          setError(err?.message ?? "Email sync failed.");
        });
    }, 3 * 60 * 1000);
    return () => clearInterval(id);
  }, [loadThreads, selectedAccountId, supabase]);

  const connectProvider = useCallback(
    async (provider: EmailProvider) => {
      if (!supabase || !workspaceId) return;
      setError(null);
      const init = await connectInit(supabase, { provider, workspaceId });
      if (init.authUrl && typeof window !== "undefined") {
        window.open(init.authUrl, "_blank");
      }
      await loadAccounts();
    },
    [loadAccounts, supabase, workspaceId]
  );

  const connectWithToken = useCallback(
    async (args: {
      provider: EmailProvider;
      emailAddress?: string;
      displayName?: string;
      accessToken?: string;
      refreshToken?: string;
      authMode?: "oauth" | "app_password" | "smtp_imap" | "smtp_pop3";
      authorizationCode?: string;
      idToken?: string;
    }) => {
      if (!supabase || !workspaceId) return;
      const {
        data: { session },
      } = await supabase.auth.getSession();
      await connectCallback(supabase, {
        ...args,
        workspaceId,
        authToken: session?.access_token,
      });
      await loadAccounts();
    },
    [loadAccounts, supabase, workspaceId]
  );

  const connectCustom = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!supabase || !workspaceId) return;
      await upsertCustomAccount(supabase, { workspaceId, ...payload });
      await loadAccounts();
    },
    [loadAccounts, supabase, workspaceId]
  );

  const syncNow = useCallback(async () => {
    if (!supabase || !selectedAccountId) return;
    setSyncStatus("syncing");
    setError(null);
    try {
      await syncAccount(supabase, selectedAccountId);
      await loadFolders();
      await loadThreads(false);
      setSyncStatus("synced");
      await loadAccounts();
    } catch (err: any) {
      setSyncStatus("error");
      setError(err?.message ?? "Sync failed");
    }
  }, [loadAccounts, loadFolders, loadThreads, selectedAccountId, supabase]);

  const send = useCallback(async () => {
    if (!supabase || !selectedAccountId || sending) return;

    const payload: EmailSendInput = {
      accountId: selectedAccountId,
      to: parseEmails(composeDraft.to),
      cc: parseEmails(composeDraft.cc),
      bcc: parseEmails(composeDraft.bcc),
      subject: composeDraft.subject,
      bodyText: composeDraft.bodyText,
      replyThreadId: selectedThreadId,
    };

    setSending(true);
    setError(null);
    try {
      await sendEmail(supabase, payload);
      setComposeDraft(draftEmpty());
      await syncNow();
    } catch (err: any) {
      setError(err?.message ?? "Failed to send email");
    } finally {
      setSending(false);
    }
  }, [composeDraft, selectedAccountId, selectedThreadId, sending, supabase, syncNow]);

  const disconnect = useCallback(
    async (accountId: string) => {
      if (!supabase) return;
      await disconnectAccount(supabase, accountId);
      await refreshAll();
    },
    [refreshAll, supabase]
  );

  const loadMoreThreads = useCallback(async () => {
    if (!threadsCursor) return;
    await loadThreads(true);
  }, [loadThreads, threadsCursor]);

  return {
    loading,
    error,
    accounts,
    folders,
    threads,
    messages,
    selectedAccount,
    selectedFolder,
    selectedThread,
    selectedAccountId,
    selectedFolderId,
    selectedThreadId,
    threadsCursor,
    syncStatus,
    composeDraft,
    sending,
    setComposeDraft,
    setSelectedAccountId,
    setSelectedFolderId,
    setSelectedThreadId,
    connectProvider,
    connectWithToken,
    connectCustom,
    syncNow,
    disconnect,
    send,
    loadMoreThreads,
  };
}
