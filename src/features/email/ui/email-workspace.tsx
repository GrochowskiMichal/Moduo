import { useEffect, useRef, useState } from "react";
import { FeaturePanelsShell } from "../../../components/app/feature-panels-shell";
import { useWorkspace } from "../../../providers/workspace-provider";
import { useAuth } from "../../../providers/auth-provider";
import { getRuntime } from "../../../lib/runtime";
import type { ConnectionStatus, Email, FolderType, MailboxProvider, SavedAccount } from "../model/email-types";
import {
  ACCOUNTS_CACHE_TTL_MS,
  ALL_ACCOUNTS_ID,
  EMAIL_CACHE_TTL_MS,
  emailCacheKey,
  emailCacheState,
  emailListCache,
} from "../model/email-cache";
import { EmailAccountSidebar } from "./email-account-sidebar";
import { EmailComposePanel } from "./email-compose-panel";
import { EmailConnectionSetup } from "./email-connection-setup";
import { EmailMessageDetail } from "./email-message-detail";
import { EmailMessageList } from "./email-message-list";

export function EmailWorkspace() {
  const { selectedWorkspaceId } = useWorkspace();
  const cachedAccounts = emailCacheState.accountsCache?.accounts ?? [];
  const [isBootstrapping, setIsBootstrapping] = useState(() => cachedAccounts.length === 0);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>(() => (cachedAccounts.length > 0 ? "connected" : "disconnected"));
  const [provider, setProvider] = useState<MailboxProvider | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [mailError, setMailError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<SavedAccount[]>(cachedAccounts);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(() => {
    if (emailCacheState.lastEmailSelection.accountId === ALL_ACCOUNTS_ID) {
      return ALL_ACCOUNTS_ID;
    }
    if (emailCacheState.lastEmailSelection.accountId && cachedAccounts.some((account) => account.id === emailCacheState.lastEmailSelection.accountId)) {
      return emailCacheState.lastEmailSelection.accountId;
    }
    return cachedAccounts[0]?.id ?? null;
  });
  const [expandedAccounts, setExpandedAccounts] = useState<Record<string, boolean>>({});
  const [expandedAll, setExpandedAll] = useState(true);
  const [leftPanelMenu, setLeftPanelMenu] = useState<{ x: number; y: number } | null>(null);

  const [creds, setCreds] = useState({ email: "", password: "" });
  const [customHosts, setCustomHosts] = useState({ imapHost: "", smtpHost: "", imapPort: "993", smtpPort: "587" });
  const [activeFolder, setActiveFolder] = useState<FolderType>(emailCacheState.lastEmailSelection.folder);
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [isComposing, setIsComposing] = useState(false);

  const [emails, setEmails] = useState<Email[]>(() => {
    const accountId =
      (emailCacheState.lastEmailSelection.accountId === ALL_ACCOUNTS_ID
        ? ALL_ACCOUNTS_ID
        : emailCacheState.lastEmailSelection.accountId && cachedAccounts.some((account) => account.id === emailCacheState.lastEmailSelection.accountId)
          ? emailCacheState.lastEmailSelection.accountId
          : cachedAccounts[0]?.id) ?? null;
    if (!accountId) return [];
    return emailListCache.get(emailCacheKey(accountId, emailCacheState.lastEmailSelection.folder))?.emails ?? [];
  });
  const [isLoadingEmails, setIsLoadingEmails] = useState(false);
  const [isRefreshingEmails, setIsRefreshingEmails] = useState(false);
  const [loadingBodyEmailId, setLoadingBodyEmailId] = useState<string | null>(null);
  const [selectedBodyError, setSelectedBodyError] = useState<string | null>(null);
  const fetchRequestSeqRef = useRef(0);

  // Compose state
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [isSending, setIsSending] = useState(false);
  const activeAccount = accounts.find((account) => account.id === activeAccountId) ?? null;
  const isAllAccountsView = activeAccountId === ALL_ACCOUNTS_ID;

  const toErrorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

  const patchAccount = (
    accountId: string,
    patch: Partial<Pick<SavedAccount, "status" | "lastError" | "lastSyncAt">>,
  ) => {
    setAccounts((current) => {
      const next = current.map((account) =>
        account.id === accountId ? { ...account, ...patch } : account,
      );
      emailCacheState.accountsCache = { accounts: next, fetchedAt: Date.now() };
      return next;
    });
  };

  const loadAccounts = async (preferredAccountId?: string | null) => {
    const rt = getRuntime();
    const nextAccounts = rt ? ((await rt.email.listAccounts()) as SavedAccount[]) : [];
    emailCacheState.accountsCache = { accounts: nextAccounts, fetchedAt: Date.now() };
    setAccounts(nextAccounts);

    if (nextAccounts.length === 0) {
      setActiveAccountId(null);
      setConnectionStatus("disconnected");
      setEmails([]);
      setSelectedEmailId(null);
      setMailError(null);
      emailListCache.clear();
      emailCacheState.lastEmailSelection = { accountId: null, folder: "inbox" };
      return;
    }

    const preferredId = preferredAccountId ?? activeAccountId ?? emailCacheState.lastEmailSelection.accountId;
    if (preferredId === ALL_ACCOUNTS_ID) {
      setActiveAccountId(ALL_ACCOUNTS_ID);
      setConnectionStatus("connected");
      return;
    }
    const resolvedAccountId =
      (preferredId && nextAccounts.some((account) => account.id === preferredId)
        ? preferredId
        : nextAccounts[0]?.id) ?? null;
    setActiveAccountId(resolvedAccountId);
    setConnectionStatus("connected");
  };

  const handleProviderSelect = (prov: MailboxProvider) => {
    setProvider(prov);
    setAuthError(null);
  };

  const handleConnect = async () => {
    if (!provider || !creds.email || !creds.password) {
      setAuthError("Email and Password/App Password required.");
      return;
    }
    if (
      provider === "custom" &&
      (!customHosts.imapHost.trim() ||
        !customHosts.smtpHost.trim() ||
        !customHosts.imapPort.trim() ||
        !customHosts.smtpPort.trim())
    ) {
      setAuthError("IMAP/SMTP host and port are required for custom mailbox.");
      return;
    }
    setConnectionStatus("connecting");
    setAuthError(null);

    try {
      const _rt = getRuntime();
      if (!_rt) throw new Error("Runtime not available");
      const nextAccount = (await _rt.email.connectAndSave({
        provider,
        email: creds.email.trim(),
        password: creds.password,
        workspaceId: selectedWorkspaceId,
        ...(provider === "custom"
          ? {
            imapHost: customHosts.imapHost.trim(),
            smtpHost: customHosts.smtpHost.trim(),
            imapPort: Number(customHosts.imapPort),
            smtpPort: Number(customHosts.smtpPort),
          }
          : {}),
      })) as SavedAccount;
      setCreds({ email: "", password: "" });
      setCustomHosts({ imapHost: "", smtpHost: "", imapPort: "993", smtpPort: "587" });
      setActiveFolder("inbox");
      setSelectedEmailId(null);
      setMailError(null);
      setProvider(null);
      await loadAccounts(nextAccount.id);
    } catch (e: any) {
      setConnectionStatus("disconnected");
      setAuthError(toErrorMessage(e));
    }
  };

  const fetchEmails = async (
    folder: FolderType,
    accountId = activeAccountId,
    options?: { force?: boolean; sync?: boolean },
  ) => {
    if (!accountId) {
      setEmails([]);
      setMailError(null);
      return;
    }

    const key = emailCacheKey(accountId, folder);
    const cached = emailListCache.get(key);
    const requestSeq = ++fetchRequestSeqRef.current;
    const accountEmailMap = new Map(accounts.map((account) => [account.id, account.email] as const));
    const mapEnvelopes = (envelopes: any[], previousRows: Email[]): Email[] => {
      const previousMap = new Map(previousRows.map((row) => [row.id, row] as const));
      return envelopes.map((envelope: any) => {
        const nextAccountId = envelope.accountId ?? accountId;
        const previous = previousMap.get(envelope.id);
        return {
          id: envelope.id,
          messageKey: envelope.messageKey ?? envelope.message_key ?? envelope.id,
          uid: Number(envelope.uid ?? 0),
          sender: envelope.sender ?? "Unknown sender",
          senderEmail: envelope.senderEmail ?? envelope.sender_email ?? "",
          to: envelope.to ?? "",
          subject: envelope.subject ?? "(No subject)",
          preview: envelope.preview ?? "",
          body: previous?.body,
          bodyHtml: previous?.bodyHtml,
          hasCachedBody: !!(envelope.hasCachedBody ?? envelope.has_cached_body),
          date: envelope.date ?? new Date().toISOString(),
          read: !!envelope.read,
          starred: !!envelope.starred,
          folder: envelope.folder ?? folder,
          accountId: nextAccountId,
          accountEmail: accountEmailMap.get(nextAccountId),
        };
      });
    };
    const readLocalEnvelopes = async (previousRows: Email[]) => {
      const _rt2 = getRuntime();
      if (!_rt2) throw new Error("Runtime not available");
      const localResult = (await _rt2.email.listEnvelopes({
        accountId: accountId === ALL_ACCOUNTS_ID ? ALL_ACCOUNTS_ID : accountId,
        folder,
        limit: 50,
        forceSync: false,
      })) as { envelopes: any[] };
      return mapEnvelopes(localResult.envelopes ?? [], previousRows);
    };

    let latestRows = cached?.emails ?? [];

    if (cached) {
      setEmails(cached.emails);
      setMailError(null);
    }
    setIsLoadingEmails(!cached);
    setIsRefreshingEmails(false);
    if (!cached) setMailError(null);

    try {
      latestRows = await readLocalEnvelopes(latestRows);
      if (requestSeq !== fetchRequestSeqRef.current) return;
      emailListCache.set(key, { emails: latestRows, fetchedAt: Date.now() });
      setEmails(latestRows);
      setMailError(null);
    } catch (e: any) {
      if (requestSeq !== fetchRequestSeqRef.current) return;
      const errorMessage = toErrorMessage(e);
      if (!cached) {
        setMailError(errorMessage);
        setEmails([]);
      }
      if (accountId !== ALL_ACCOUNTS_ID) {
        patchAccount(accountId, {
          status:
            errorMessage.includes("reauth") || errorMessage.includes("missing_account_secret")
              ? "reauth_required"
              : "error",
          lastError: errorMessage,
        });
      }
      return;
    } finally {
      if (requestSeq === fetchRequestSeqRef.current) {
        setIsLoadingEmails(false);
      }
    }

    const shouldSync = options?.sync ?? true;
    if (!shouldSync) return;
    const isCacheFresh = cached && Date.now() - cached.fetchedAt <= EMAIL_CACHE_TTL_MS;
    if (!options?.force && isCacheFresh && latestRows.length > 0) return;

    // Fire email_sync_now in the background — DO NOT await it here.
    // The UI already shows cached/local results. When the sync finishes,
    // we re-read local Redb and update the list in the background.
    const _rt3 = getRuntime();
    const syncPromise = _rt3
      ? _rt3.email.syncNow({ accountId: accountId === ALL_ACCOUNTS_ID ? null : accountId, folder })
      : Promise.resolve();

    // Show a non-blocking refreshing indicator.
    if (requestSeq === fetchRequestSeqRef.current) {
      setIsRefreshingEmails(true);
    }

    syncPromise
      .then(async () => {
        if (requestSeq !== fetchRequestSeqRef.current) return;
        try {
          const refreshedRows = await readLocalEnvelopes(latestRows);
          if (requestSeq !== fetchRequestSeqRef.current) return;
          emailListCache.set(key, { emails: refreshedRows, fetchedAt: Date.now() });
          setEmails(refreshedRows);

          if (accountId !== ALL_ACCOUNTS_ID) {
            const uids = refreshedRows
              .slice(0, 5)
              .map((row) => row.uid)
              .filter((uid) => uid > 0);
            if (uids.length > 0) {
              void getRuntime()?.email.prefetchBodies({ accountId, folder, uids, limit: 5 });
            }
            patchAccount(accountId, {
              status: "active",
              lastError: null,
              lastSyncAt: new Date().toISOString(),
            });
          }
        } catch {
          // Background refresh failed — local results are already shown, ignore.
        }
      })
      .catch((e: any) => {
        if (requestSeq !== fetchRequestSeqRef.current) return;
        const errorMessage = toErrorMessage(e);
        if (latestRows.length === 0) {
          setMailError(errorMessage);
        }
        if (accountId !== ALL_ACCOUNTS_ID) {
          patchAccount(accountId, {
            status:
              errorMessage.includes("reauth") || errorMessage.includes("missing_account_secret")
                ? "reauth_required"
                : "error",
            lastError: errorMessage,
          });
        }
      })
      .finally(() => {
        if (requestSeq === fetchRequestSeqRef.current) {
          setIsRefreshingEmails(false);
        }
      });
  };

  useEffect(() => {
    let active = true;
    const bootstrap = async () => {
      try {
        if (emailCacheState.accountsCache?.accounts.length) {
          const cachedAccountsList = emailCacheState.accountsCache.accounts;
          const preferredId = emailCacheState.lastEmailSelection.accountId;
          const resolvedAccountId =
            (preferredId &&
              cachedAccountsList.some((account) => account.id === preferredId)
              ? preferredId
              : cachedAccountsList[0]?.id) ?? null;
          setAccounts(cachedAccountsList);
          setActiveAccountId(resolvedAccountId);
          setConnectionStatus("connected");
          setIsBootstrapping(false);

          // Keep account state fresh in the background without blocking UI.
          if (Date.now() - emailCacheState.accountsCache.fetchedAt > ACCOUNTS_CACHE_TTL_MS) {
            void loadAccounts(resolvedAccountId);
          }
          return;
        }
        await loadAccounts(emailCacheState.lastEmailSelection.accountId);
      } catch (error) {
        if (!active) return;
        setConnectionStatus("disconnected");
        setAuthError(toErrorMessage(error));
      } finally {
        if (active) setIsBootstrapping(false);
      }
    };
    void bootstrap();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (connectionStatus === "connected" && (activeAccount || activeAccountId === ALL_ACCOUNTS_ID)) {
      if (activeAccountId === ALL_ACCOUNTS_ID) {
        void fetchEmails(activeFolder, ALL_ACCOUNTS_ID, { force: true, sync: true });
        setSelectedEmailId(null);
        return;
      }
      if (!activeAccount) {
        return;
      }
      if (activeAccount.status === "reauth_required") {
        setMailError("Account requires reconnect. Re-enter app password.");
        setEmails([]);
        return;
      }
      void fetchEmails(activeFolder, activeAccount.id, { force: true, sync: true });
      setSelectedEmailId(null);
    }
  }, [activeFolder, activeAccountId, connectionStatus]);

  useEffect(() => {
    if (connectionStatus !== "connected") return;
    if (!activeAccountId) return;
    // 30-second tick refreshes ONLY the local Redb snapshot.
    // IDLE workers handle server-side freshness; email_set_activity_state is
    // called in a separate effect whenever account/folder actually changes.
    const timer = window.setInterval(() => {
      void fetchEmails(activeFolder, activeAccountId, { force: false, sync: false });
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [activeFolder, activeAccountId, connectionStatus]);

  useEffect(() => {
    if (connectionStatus !== "connected") return;
    if (!activeAccountId) return;
    void getRuntime()?.email.setActivityState({ mode: "mailForeground", activeAccountId, activeFolder });
  }, [activeAccountId, activeFolder, connectionStatus]);

  useEffect(() => {
    emailCacheState.lastEmailSelection = {
      accountId: activeAccountId,
      folder: activeFolder,
    };
  }, [activeAccountId, activeFolder]);

  useEffect(() => {
    if (!leftPanelMenu) return;

    const closeMenu = () => setLeftPanelMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };

    window.addEventListener("click", closeMenu);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [leftPanelMenu]);

  const handleSend = async () => {
    if (!activeAccountId || activeAccountId === ALL_ACCOUNTS_ID || !composeTo || !composeBody) {
      if (activeAccountId === ALL_ACCOUNTS_ID) {
        setMailError("Select a specific account to send email.");
      }
      return;
    }
    setIsSending(true);
    try {
      const _rtSend = getRuntime();
      if (!_rtSend) throw new Error("Runtime not available");
      await _rtSend.email.sendSaved({
        accountId: activeAccountId,
        to: composeTo,
        subject: composeSubject,
        body: composeBody,
      });
      setIsComposing(false);
      setComposeTo("");
      setComposeSubject("");
      setComposeBody("");
      await loadAccounts(activeAccountId);
      if (activeFolder === "sent") {
        void fetchEmails("sent", activeAccountId, { force: true });
      }
    } catch (e: any) {
      setMailError(toErrorMessage(e));
      await loadAccounts(activeAccountId);
    } finally {
      setIsSending(false);
    }
  };

  const selectedEmail = emails.find((e) => e.id === selectedEmailId);
  const loadSelectedBody = async (email: Email) => {
    if (!email.accountId || email.accountId === ALL_ACCOUNTS_ID) return;
    if (email.body || loadingBodyEmailId === email.id) return;
    setSelectedBodyError(null);
    setLoadingBodyEmailId(email.id);
    try {
      const _rtBody = getRuntime();
      if (!_rtBody) throw new Error("Runtime not available");
      const bodyResult = (await _rtBody.email.getMessageBody({
        accountId: email.accountId,
        folder: email.folder,
        uid: email.uid,
      })) as { body: string; bodyHtml?: string | null };
      setEmails((current) =>
        current.map((item) =>
          item.id === email.id
            ? {
              ...item,
              body: bodyResult.body ?? "",
              bodyHtml: bodyResult.bodyHtml ?? null,
              hasCachedBody: true,
            }
            : item,
        ),
      );
      emailListCache.set(emailCacheKey(activeAccountId ?? email.accountId, activeFolder), {
        emails: emails.map((item) =>
          item.id === email.id
            ? {
              ...item,
              body: bodyResult.body ?? "",
              bodyHtml: bodyResult.bodyHtml ?? null,
              hasCachedBody: true,
            }
            : item,
        ),
        fetchedAt: Date.now(),
      });
    } catch (error) {
      setSelectedBodyError(toErrorMessage(error));
    } finally {
      setLoadingBodyEmailId((current) => (current === email.id ? null : current));
    }
  };

  useEffect(() => {
    if (!selectedEmail) {
      setSelectedBodyError(null);
      return;
    }
    if (!selectedEmail.body && selectedEmail.accountId) {
      void loadSelectedBody(selectedEmail);
    }
  }, [selectedEmailId, selectedEmail?.body, selectedEmail?.accountId]);

  if (isBootstrapping) {
    return (
      <div className="grid h-full w-full place-content-center bg-[#0C0C0C]">
        <div className="flex items-center gap-3 text-[#8b8b8b]">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#2f2f2f] border-t-[#6a6a6a]" />
          <span className="text-[13px] font-bold uppercase tracking-widest">Loading mail accounts...</span>
        </div>
      </div>
    );
  }

  if (connectionStatus === "disconnected" || connectionStatus === "connecting") {
    return (
      <EmailConnectionSetup
        connectionStatus={connectionStatus}
        accounts={accounts}
        activeAccountId={activeAccountId}
        provider={provider}
        authError={authError}
        creds={creds}
        customHosts={customHosts}
        loadAccounts={loadAccounts}
        handleProviderSelect={handleProviderSelect}
        handleConnect={handleConnect}
        setProvider={setProvider}
        setCreds={setCreds}
        setCustomHosts={setCustomHosts}
      />
    );
  }

  const selectAccountFolder = (accountId: string, folder: FolderType) => {
    setActiveAccountId(accountId);
    setActiveFolder(folder);
    setSelectedEmailId(null);
    setMailError(null);
  };

  const beginAddAccount = () => {
    setConnectionStatus("disconnected");
    setProvider(null);
    setAuthError(null);
    setMailError(null);
    setCreds({ email: "", password: "" });
    setCustomHosts({ imapHost: "", smtpHost: "", imapPort: "993", smtpPort: "587" });
  };

  const reconnectAccount = (account: SavedAccount) => {
    setProvider(account.provider);
    setCreds({ email: account.email, password: "" });
    setCustomHosts({
      imapHost: account.imapHost ?? "",
      smtpHost: account.smtpHost ?? "",
      imapPort: account.imapPort ? String(account.imapPort) : "993",
      smtpPort: account.smtpPort ? String(account.smtpPort) : "587",
    });
    setConnectionStatus("disconnected");
    setAuthError("Re-enter your app password to reconnect this account.");
  };

  const toggleAccountFolders = (accountId: string) => {
    setExpandedAccounts((prev) => ({
      ...prev,
      [accountId]: !(prev[accountId] ?? (activeAccountId === accountId)),
    }));
  };

  const handleSelectEmail = (email: Email) => {
    setSelectedEmailId(email.id);
    setSelectedBodyError(null);
    if (!email.read) {
      setEmails((current) =>
        current.map((item) =>
          item.id === email.id ? { ...item, read: true } : item,
        ),
      );
      if (email.accountId) {
        void getRuntime()?.email.applyFlag({
          accountId: email.accountId,
          folder: email.folder,
          uid: email.uid,
          flag: "seen",
          value: true,
        });
      }
    }
    if (!email.body) {
      void loadSelectedBody(email);
    }
  };

  // Connected Mail Client View
  return (
    <FeaturePanelsShell
      feature="email"
      left={
        <EmailAccountSidebar
          accounts={accounts}
          activeAccountId={activeAccountId}
          activeFolder={activeFolder}
          expandedAccounts={expandedAccounts}
          expandedAll={expandedAll}
          leftPanelMenu={leftPanelMenu}
          onOpenContextMenu={setLeftPanelMenu}
          onCloseContextMenu={() => setLeftPanelMenu(null)}
          onSelectAllAccount={() => setActiveAccountId(ALL_ACCOUNTS_ID)}
          onSelectAccount={setActiveAccountId}
          onSelectAccountFolder={selectAccountFolder}
          onToggleAllFolders={() => setExpandedAll((prev) => !prev)}
          onToggleAccountFolders={toggleAccountFolders}
          onReconnectAccount={reconnectAccount}
          onCompose={() => setIsComposing(true)}
          onAddAccount={beginAddAccount}
        />
      }
      center={
        <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
          {selectedEmail ? (
            <EmailMessageDetail
              email={selectedEmail}
              accountEmail={activeAccount?.email}
              loadingBodyEmailId={loadingBodyEmailId}
              selectedBodyError={selectedBodyError}
              onBack={() => setSelectedEmailId(null)}
              onRetryBody={(email) => void loadSelectedBody(email)}
            />
          ) : (
            <EmailMessageList
              emails={emails}
              selectedEmailId={selectedEmailId}
              hasActiveMailbox={!!activeAccount || isAllAccountsView}
              isRefreshingEmails={isRefreshingEmails}
              isLoadingEmails={isLoadingEmails}
              mailError={mailError}
              onRetry={() => void fetchEmails(activeFolder, activeAccountId, { force: true })}
              onSelectEmail={handleSelectEmail}
            />
          )}
          {isComposing && (
            <EmailComposePanel
              composeTo={composeTo}
              composeSubject={composeSubject}
              composeBody={composeBody}
              isSending={isSending}
              onClose={() => setIsComposing(false)}
              onSend={handleSend}
              setComposeTo={setComposeTo}
              setComposeSubject={setComposeSubject}
              setComposeBody={setComposeBody}
            />
          )}
        </div>
      }
      right={
        <div className="h-full min-h-0" />
      }
    />
  );
}
