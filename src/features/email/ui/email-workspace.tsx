import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FeaturePanelsShell } from "../../../components/app/feature-panels-shell";
import { useWorkspace } from "../../../providers/workspace-provider";

type ConnectionStatus = "disconnected" | "connecting" | "connected";
type MailboxProvider = "gmail" | "outlook" | "icloud" | "custom";
type FolderType = "inbox" | "sent" | "drafts" | "trash" | "spam";

interface Email {
  id: string;
  messageKey: string;
  uid: number;
  sender: string;
  senderEmail: string;
  to?: string;
  subject: string;
  preview: string;
  body?: string;
  bodyHtml?: string | null;
  hasCachedBody?: boolean;
  date: string;
  read: boolean;
  starred?: boolean;
  folder: string;
  tags?: string[];
  accountId?: string;
  accountEmail?: string;
}

type AccountStatus = "active" | "reauth_required" | "error";

interface SavedAccount {
  id: string;
  workspaceId?: string | null;
  provider: MailboxProvider;
  email: string;
  imapHost?: string | null;
  smtpHost?: string | null;
  imapPort?: number | null;
  smtpPort?: number | null;
  lastSyncAt: string | null;
  status: AccountStatus;
  lastError: string | null;
}

const FOLDERS: Array<{ id: FolderType; label: string }> = [
  { id: "inbox", label: "Inbox" },
  { id: "sent", label: "Sent" },
  { id: "drafts", label: "Drafts" },
  { id: "trash", label: "Trash" },
  { id: "spam", label: "Spam" },
];

const EMAIL_CACHE_TTL_MS = 60_000; // IDLE workers push updates; 1-min cache TTL is enough.
const ACCOUNTS_CACHE_TTL_MS = 30_000;

type EmailListCacheEntry = {
  emails: Email[];
  fetchedAt: number;
};

type AccountsCacheEntry = {
  accounts: SavedAccount[];
  fetchedAt: number;
};

const emailListCache = new Map<string, EmailListCacheEntry>();
const ALL_ACCOUNTS_ID = "__all_accounts__";
let accountsCache: AccountsCacheEntry | null = null;
let lastEmailSelection: { accountId: string | null; folder: FolderType } = {
  accountId: null,
  folder: "inbox",
};

function emailCacheKey(accountId: string, folder: FolderType) {
  return `${accountId}::${folder}`;
}

function buildEmailSrcDoc(rawHtml: string) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(rawHtml, "text/html");

  doc.querySelectorAll("script, iframe, object, embed").forEach((node) => {
    node.remove();
  });

  doc.querySelectorAll("*").forEach((node) => {
    for (const attr of [...node.attributes]) {
      if (attr.name.toLowerCase().startsWith("on")) {
        node.removeAttribute(attr.name);
      }
    }
  });

  const headHtml = doc.head?.innerHTML ?? "";
  const bodyHtml = doc.body?.innerHTML ?? rawHtml;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https: http: cid:; style-src 'unsafe-inline'; font-src data: https: http:; media-src data: https: http:;" />
  ${headHtml}
  <style>
    html, body {
      margin: 0;
      padding: 0;
      background: #ffffff;
      color: #1f1f1f;
      font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.45;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    body {
      padding: 16px;
    }
    img, video, table {
      max-width: 100%;
    }
    img, video {
      height: auto;
    }
    pre {
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    * {
      box-sizing: border-box;
    }
  </style>
</head>
<body>${bodyHtml}</body>
</html>`;
}

export function EmailWorkspace() {
  const { selectedWorkspaceId } = useWorkspace();
  const cachedAccounts = accountsCache?.accounts ?? [];
  const [isBootstrapping, setIsBootstrapping] = useState(() => cachedAccounts.length === 0);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>(() => (cachedAccounts.length > 0 ? "connected" : "disconnected"));
  const [provider, setProvider] = useState<MailboxProvider | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [mailError, setMailError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<SavedAccount[]>(cachedAccounts);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(() => {
    if (lastEmailSelection.accountId === ALL_ACCOUNTS_ID) {
      return ALL_ACCOUNTS_ID;
    }
    if (lastEmailSelection.accountId && cachedAccounts.some((account) => account.id === lastEmailSelection.accountId)) {
      return lastEmailSelection.accountId;
    }
    return cachedAccounts[0]?.id ?? null;
  });
  const [expandedAccounts, setExpandedAccounts] = useState<Record<string, boolean>>({});
  const [expandedAll, setExpandedAll] = useState(true);
  const [leftPanelMenu, setLeftPanelMenu] = useState<{ x: number; y: number } | null>(null);

  const [creds, setCreds] = useState({ email: "", password: "" });
  const [customHosts, setCustomHosts] = useState({ imapHost: "", smtpHost: "", imapPort: "993", smtpPort: "587" });
  const [activeFolder, setActiveFolder] = useState<FolderType>(lastEmailSelection.folder);
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [isComposing, setIsComposing] = useState(false);

  const [emails, setEmails] = useState<Email[]>(() => {
    const accountId =
      (lastEmailSelection.accountId === ALL_ACCOUNTS_ID
        ? ALL_ACCOUNTS_ID
        : lastEmailSelection.accountId && cachedAccounts.some((account) => account.id === lastEmailSelection.accountId)
          ? lastEmailSelection.accountId
          : cachedAccounts[0]?.id) ?? null;
    if (!accountId) return [];
    return emailListCache.get(emailCacheKey(accountId, lastEmailSelection.folder))?.emails ?? [];
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
      accountsCache = { accounts: next, fetchedAt: Date.now() };
      return next;
    });
  };

  const loadAccounts = async (preferredAccountId?: string | null) => {
    const nextAccounts = (await invoke("email_accounts_list")) as SavedAccount[];
    accountsCache = { accounts: nextAccounts, fetchedAt: Date.now() };
    setAccounts(nextAccounts);

    if (nextAccounts.length === 0) {
      setActiveAccountId(null);
      setConnectionStatus("disconnected");
      setEmails([]);
      setSelectedEmailId(null);
      setMailError(null);
      emailListCache.clear();
      lastEmailSelection = { accountId: null, folder: "inbox" };
      return;
    }

    const preferredId = preferredAccountId ?? activeAccountId ?? lastEmailSelection.accountId;
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
      const nextAccount = (await invoke("email_account_connect_and_save", {
        input: {
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
        },
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
      const localResult = (await invoke("email_list_envelopes", {
        input: {
          accountId: accountId === ALL_ACCOUNTS_ID ? ALL_ACCOUNTS_ID : accountId,
          folder,
          limit: 50,
          forceSync: false,
        },
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
    const syncPromise = invoke("email_sync_now", {
      input: {
        accountId: accountId === ALL_ACCOUNTS_ID ? null : accountId,
        folder,
      },
    });

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
              void invoke("email_prefetch_bodies", {
                input: {
                  accountId,
                  folder,
                  uids,
                  limit: 5,
                },
              });
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
        if (accountsCache?.accounts.length) {
          const cachedAccountsList = accountsCache.accounts;
          const preferredId = lastEmailSelection.accountId;
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
          if (Date.now() - accountsCache.fetchedAt > ACCOUNTS_CACHE_TTL_MS) {
            void loadAccounts(resolvedAccountId);
          }
          return;
        }
        await loadAccounts(lastEmailSelection.accountId);
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
    void invoke("email_set_activity_state", {
      input: {
        mode: "mailForeground",
        activeAccountId,
        activeFolder,
      },
    }).catch(() => undefined);
  }, [activeAccountId, activeFolder, connectionStatus]);

  useEffect(() => {
    lastEmailSelection = {
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
      await invoke("email_send_saved", {
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
      const bodyResult = (await invoke("email_get_message_body", {
        input: {
          accountId: email.accountId,
          folder: email.folder,
          uid: email.uid,
        },
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

  const formatEmailDate = (raw: string) => {
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return raw;

    const day = String(parsed.getDate());
    const month = parsed
      .toLocaleString("en-US", { month: "short" })
      .replace(".", "");
    const currentYear = new Date().getFullYear();
    if (parsed.getFullYear() === currentYear) {
      return `${day}${month}`;
    }
    const year2 = String(parsed.getFullYear()).slice(-2);
    return `${day}${month}${year2}`;
  };

  const formatEmailDetailDate = (raw: string) => {
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return raw;
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(parsed);
  };

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

  if (
    connectionStatus === "disconnected" ||
    connectionStatus === "connecting"
  ) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center overflow-y-auto bg-[#0C0C0C] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#1a1a1a] to-[#0C0C0C] px-4 py-4">
        <div className="w-full max-w-[420px] rounded-2xl border border-[#222] bg-[#111] p-6 shadow-2xl backdrop-blur-xl transition-all">
          <div className="mb-5 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-[#2a2a2a] text-[#d0d0d0] border border-[#3a3a3a] shadow-inner">
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                <polyline points="22,6 12,13 2,6" />
              </svg>
            </div>
            <h1 className="text-[34px] font-black tracking-tight text-[#f3f3f3] mb-1 leading-none">
              Connect Your Mailbox
            </h1>
            <p className="text-[11px] text-[#888] font-medium leading-relaxed">
              We sync directly over IMAP/SMTP seamlessly mapping your messages.
            </p>
          </div>

          {authError && (
            <div className="mb-4 bg-red-500/10 border border-red-500/20 text-red-500 text-[13px] p-3 rounded-lg font-bold">
              {authError}
            </div>
          )}
          {connectionStatus === "disconnected" && accounts.length > 0 ? (
            <button
              onClick={() => void loadAccounts(activeAccountId ?? accounts[0]?.id ?? null)}
              className="mb-3 w-full rounded-xl border border-[#2b2b2b] bg-[#151515] px-3 py-2 text-[11px] font-bold text-[#d8d8d8] transition-colors hover:bg-[#1b1b1b]"
            >
              Back to connected mailboxes
            </button>
          ) : null}

          {connectionStatus === "connecting" ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#333] border-t-[#6a6a6a] mb-6"></div>
              <p className="text-[14px] font-bold text-[#f3f3f3] animate-pulse">
                Authenticating securely over TLS...
              </p>
            </div>
          ) : provider === null ? (
            <div className="flex flex-col gap-2.5">
              <button
                onClick={() => handleProviderSelect("gmail")}
                className="group relative flex w-full items-center justify-between rounded-xl border border-[#333] bg-[#161616] p-3 transition-all hover:bg-[#1a1a1a] hover:border-[#444] hover:shadow-lg"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-sm">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                      <path
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        fill="#b0b0b0"
                      />
                      <path
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.13v2.84C3.99 20.53 7.7 23 12 23z"
                        fill="#9a9a9a"
                      />
                      <path
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.13C1.43 8.55 1 10.22 1 12s.43 3.45 1.13 4.93l3.71-2.84z"
                        fill="#8f8f8f"
                      />
                      <path
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.13 7.07l3.71 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        fill="#6f6f6f"
                      />
                    </svg>
                  </div>
                  <div className="flex flex-col items-start">
                    <span className="text-[13px] font-bold text-[#f3f3f3]">
                      Google Workspace
                    </span>
                    <span className="text-[11px] font-medium text-[#777]">
                      Connect Gmail
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-center rounded-full bg-[#222] p-1.5 text-[#888] transition-colors group-hover:bg-[#333] group-hover:text-white">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </div>
              </button>
              <button
                onClick={() => handleProviderSelect("outlook")}
                className="group relative flex w-full items-center justify-between rounded-xl border border-[#333] bg-[#161616] p-3 transition-all hover:bg-[#1a1a1a] hover:border-[#444] hover:shadow-lg"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#9a9a9a] shadow-sm text-white">
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M2.5 5.25L11.5 3v18L2.5 18.75V5.25zm19 12.75V6H12v12h9.5z" />
                    </svg>
                  </div>
                  <div className="flex flex-col items-start">
                    <span className="text-[13px] font-bold text-[#f3f3f3]">
                      Microsoft Outlook
                    </span>
                    <span className="text-[11px] font-medium text-[#777]">
                      Office 365 & Outlook
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-center rounded-full bg-[#222] p-1.5 text-[#888] transition-colors group-hover:bg-[#333] group-hover:text-white">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </div>
              </button>
              <button
                onClick={() => handleProviderSelect("icloud")}
                className="group relative flex w-full items-center justify-between rounded-xl border border-[#333] bg-[#161616] p-3 transition-all hover:bg-[#1a1a1a] hover:border-[#444] hover:shadow-lg"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#E5E5EA] shadow-sm text-black">
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M17.5 19H6.5a4.5 4.5 0 010-9 1 1 0 011-1h.25a6.5 6.5 0 0112.5 2.5v.5A3.5 3.5 0 0117.5 19z" />
                    </svg>
                  </div>
                  <div className="flex flex-col items-start">
                    <span className="text-[13px] font-bold text-[#f3f3f3]">
                      Apple iCloud
                    </span>
                    <span className="text-[11px] font-medium text-[#777]">
                      Connect iCloud Mail
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-center rounded-full bg-[#222] p-1.5 text-[#888] transition-colors group-hover:bg-[#333] group-hover:text-white">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </div>
              </button>
              <button
                onClick={() => handleProviderSelect("custom")}
                className="group relative flex w-full items-center justify-between rounded-xl border border-[#333] bg-[#161616] p-3 transition-all hover:bg-[#1a1a1a] hover:border-[#444] hover:shadow-lg"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#2a2a2a] shadow-sm text-[#d0d0d0]">
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M4 4h16v16H4z" />
                      <path d="M4 8h16" />
                      <path d="M8 4v4" />
                      <path d="M16 4v4" />
                    </svg>
                  </div>
                  <div className="flex flex-col items-start">
                    <span className="text-[13px] font-bold text-[#f3f3f3]">
                      Other IMAP/SMTP
                    </span>
                    <span className="text-[11px] font-medium text-[#777]">
                      Custom mail server
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-center rounded-full bg-[#222] p-1.5 text-[#888] transition-colors group-hover:bg-[#333] group-hover:text-white">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </div>
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <div>
                <label className="text-[11px] font-bold uppercase tracking-widest text-[#555] mb-2 block">
                  Email Address
                </label>
                <input
                  type="email"
                  value={creds.email}
                  onChange={(e) =>
                    setCreds({ ...creds, email: e.target.value })
                  }
                  className="w-full bg-[#161616] border border-[#333] focus:border-[#555] outline-none px-3 py-2 rounded-xl text-[13px] text-[#eee]"
                  placeholder="you@domain.com"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold uppercase tracking-widest text-[#555] mb-2 block">
                  <span>{provider === "custom" ? "Mailbox Password" : "App Password (Not Standard Password!)"}</span>
                </label>
                <input
                  type="password"
                  value={creds.password}
                  onChange={(e) =>
                    setCreds({ ...creds, password: e.target.value })
                  }
                  className="w-full bg-[#161616] border border-[#333] focus:border-[#555] outline-none px-3 py-2 rounded-xl text-[13px] text-[#eee]"
                  placeholder="••••••••••••"
                />
              </div>
              {provider === "custom" ? (
                <>
                  <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-3">
                    <div>
                      <label className="text-[11px] font-bold uppercase tracking-widest text-[#555] mb-2 block">
                        IMAP Host
                      </label>
                      <input
                        type="text"
                        value={customHosts.imapHost}
                        onChange={(e) =>
                          setCustomHosts({ ...customHosts, imapHost: e.target.value })
                        }
                        className="w-full bg-[#161616] border border-[#333] focus:border-[#555] outline-none px-3 py-2 rounded-xl text-[13px] text-[#eee]"
                        placeholder="imap.mail.yourdomain.com"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-bold uppercase tracking-widest text-[#555] mb-2 block">
                        Port
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={65535}
                        value={customHosts.imapPort}
                        onChange={(e) =>
                          setCustomHosts({ ...customHosts, imapPort: e.target.value })
                        }
                        className="w-full appearance-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none bg-[#161616] border border-[#333] focus:border-[#555] outline-none px-3 py-2 rounded-xl text-[13px] text-[#eee]"
                        placeholder="993"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-3">
                    <div>
                      <label className="text-[11px] font-bold uppercase tracking-widest text-[#555] mb-2 block">
                        SMTP Host
                      </label>
                      <input
                        type="text"
                        value={customHosts.smtpHost}
                        onChange={(e) =>
                          setCustomHosts({ ...customHosts, smtpHost: e.target.value })
                        }
                        className="w-full bg-[#161616] border border-[#333] focus:border-[#555] outline-none px-3 py-2 rounded-xl text-[13px] text-[#eee]"
                        placeholder="smtp.mail.yourdomain.com"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-bold uppercase tracking-widest text-[#555] mb-2 block">
                        Port
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={65535}
                        value={customHosts.smtpPort}
                        onChange={(e) =>
                          setCustomHosts({ ...customHosts, smtpPort: e.target.value })
                        }
                        className="w-full appearance-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none bg-[#161616] border border-[#333] focus:border-[#555] outline-none px-3 py-2 rounded-xl text-[13px] text-[#eee]"
                        placeholder="587"
                      />
                    </div>
                  </div>
                </>
              ) : null}
              <div className="mt-3 flex gap-2.5">
                <button
                  onClick={() => setProvider(null)}
                  className="h-9 flex-1 rounded-xl text-[12px] font-bold text-[#f3f3f3] transition-colors hover:bg-[#222] shrink-0 max-w-20"
                >
                  Back
                </button>
                <button
                  onClick={handleConnect}
                  className="flex h-9 flex-1 items-center justify-center rounded-xl bg-[#2f2f2f] text-[12px] font-bold leading-none text-white shadow-lg transition-colors hover:bg-[#3a3a3a]"
                >
                  Connect
                </button>
              </div>
            </div>
          )}

          <div className="mt-5 text-center border-t border-[#222] pt-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[#555] flex items-center justify-center gap-2">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>{" "}
              Moduo does not store your credentials externally
            </p>
          </div>
        </div>
      </div>
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

  // Connected Mail Client View
  return (
    <FeaturePanelsShell
      feature="email"
      left={
        <div
          className="relative flex h-full min-h-0 flex-col"
          onContextMenu={(event) => {
            event.preventDefault();
            setLeftPanelMenu({ x: event.clientX, y: event.clientY });
          }}
        >
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="grid gap-1">
              <div className="rounded-xl px-1 py-1">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setActiveAccountId(ALL_ACCOUNTS_ID)}
                    className={`min-w-0 flex-1 truncate px-1 py-1.5 text-left text-[11px] font-medium transition-colors ${activeAccountId === ALL_ACCOUNTS_ID ? "text-[#ececec]" : "text-[#b0b0b0] hover:text-[#d0d0d0]"}`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setExpandedAll((prev) => !prev)}
                    aria-label="Toggle all categories"
                    title="Toggle all categories"
                    className="grid h-7 w-7 place-items-center rounded-md text-[#8a8a8a] transition-colors hover:text-[#c8c8c8]"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      className={`transition-transform ${expandedAll ? "rotate-90" : ""}`}
                    >
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                </div>
                {expandedAll ? (
                  <div className="mt-1 grid gap-0.5">
                    {FOLDERS.map((folder) => {
                      const isActive = activeAccountId === ALL_ACCOUNTS_ID && activeFolder === folder.id;
                      return (
                        <button
                          key={`all:${folder.id}`}
                          onClick={() => selectAccountFolder(ALL_ACCOUNTS_ID, folder.id)}
                          className={`flex items-center rounded-lg px-2 py-2 text-[11px] font-medium transition-colors ${isActive ? "text-[#ececec]" : "text-[#888] hover:text-[#d6d6d6]"}`}
                        >
                          <span>{folder.label}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
              {accounts.map((account) => (
                <div key={account.id} className="rounded-xl px-1 py-1">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setActiveAccountId(account.id)}
                      className={`min-w-0 flex-1 truncate px-1 py-1.5 text-left text-[11px] font-medium transition-colors ${activeAccountId === account.id ? "text-[#ececec]" : "text-[#b0b0b0] hover:text-[#d0d0d0]"}`}
                    >
                      {account.email}
                    </button>
                    <button
                      onClick={() =>
                        setExpandedAccounts((prev) => ({
                          ...prev,
                          [account.id]: !(prev[account.id] ?? (activeAccountId === account.id)),
                        }))
                      }
                      aria-label="Toggle categories"
                      title="Toggle categories"
                      className="grid h-7 w-7 place-items-center rounded-md text-[#8a8a8a] transition-colors hover:text-[#c8c8c8]"
                    >
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        className={`transition-transform ${(expandedAccounts[account.id] ?? (activeAccountId === account.id)) ? "rotate-90" : ""}`}
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                  </div>
                  {account.status === "reauth_required" ? (
                    <button
                      onClick={() => {
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
                      }}
                      className="mt-2 w-full rounded-lg border border-[#3a2c16] bg-[#2a2114] px-3 py-1.5 text-[11px] font-bold text-[#efcb8a] transition-colors hover:bg-[#332714]"
                    >
                      Reconnect account
                    </button>
                  ) : null}
                  {account.lastError && account.status !== "active" ? (
                    <p className="mt-2 px-2 text-[11px] text-[#b17f7f] line-clamp-2">
                      {account.lastError}
                    </p>
                  ) : null}

                  {(expandedAccounts[account.id] ?? (activeAccountId === account.id)) ? (
                    <div className="mt-1 grid gap-0.5">
                      {FOLDERS.map((folder) => {
                        const isActive =
                          activeAccountId === account.id && activeFolder === folder.id;
                        return (
                          <button
                            key={`${account.id}:${folder.id}`}
                            onClick={() => selectAccountFolder(account.id, folder.id)}
                            disabled={account.status === "reauth_required"}
                            className={`flex items-center rounded-lg px-2 py-2 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${isActive ? "text-[#ececec]" : "text-[#888] hover:text-[#d6d6d6]"}`}
                          >
                            <span>{folder.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
          {leftPanelMenu ? (
            <div
              className="fixed z-[60] min-w-[148px] rounded-lg border border-[#2b2b2b] bg-[#141414] p-1 shadow-xl"
              style={{ left: leftPanelMenu.x, top: leftPanelMenu.y }}
            >
              <button
                onClick={() => {
                  setIsComposing(true);
                  setLeftPanelMenu(null);
                }}
                className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-[11px] font-medium text-[#d8d8d8] transition-colors hover:bg-[#1f1f1f]"
              >
                Compose
              </button>
              <button
                onClick={() => {
                  beginAddAccount();
                  setLeftPanelMenu(null);
                }}
                className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-[11px] font-medium text-[#d8d8d8] transition-colors hover:bg-[#1f1f1f]"
              >
                Add account
              </button>
            </div>
          ) : null}
        </div>
      }
      center={
        <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
          {selectedEmail ? (
            <>
              <div className="shrink-0 border-b border-[#222] px-3 py-2">
                <div className="flex items-start gap-2">
                  <button
                    onClick={() => setSelectedEmailId(null)}
                    aria-label="Back to list"
                    title="Back to list"
                    className="self-center shrink-0 text-[#777] transition-colors hover:text-[#bbb]"
                  >
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <polyline points="15 18 9 12 15 6" />
                    </svg>
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <h1 className="min-w-0 truncate text-[14px] font-semibold text-[#e8e8e8]">
                        {selectedEmail.subject}
                      </h1>
                      <div className="shrink-0 pl-2 text-[11px] font-medium text-[#666]">
                        {formatEmailDetailDate(selectedEmail.date)}
                      </div>
                    </div>
                    <p className="truncate text-[12px] text-[#bdbdbd]">
                      <span className="text-[#8f8f8f]">From:</span>{" "}
                      {selectedEmail.senderEmail
                        ? `${selectedEmail.sender} <${selectedEmail.senderEmail}>`
                        : selectedEmail.sender}
                    </p>
                    <p className="truncate text-[12px] text-[#7c7c7c]">
                      <span className="text-[#8f8f8f]">To:</span>{" "}
                      {selectedEmail.to?.trim() || selectedEmail.accountEmail || activeAccount?.email || "—"}
                    </p>
                  </div>
                </div>
              </div>
              <div className="custom-scrollbar flex-1 overflow-y-auto p-4">
                {loadingBodyEmailId === selectedEmail.id ? (
                  <div className="grid gap-3">
                    <div className="h-4 w-1/3 animate-pulse rounded bg-[#262626]" />
                    <div className="h-4 w-full animate-pulse rounded bg-[#262626]" />
                    <div className="h-4 w-5/6 animate-pulse rounded bg-[#262626]" />
                    <div className="h-4 w-4/6 animate-pulse rounded bg-[#262626]" />
                  </div>
                ) : selectedBodyError ? (
                  <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
                    <p className="text-[12px] font-semibold text-red-300">
                      Failed to load message body
                    </p>
                    <p className="mt-1 text-[12px] text-red-200/80">{selectedBodyError}</p>
                    <button
                      onClick={() => void loadSelectedBody(selectedEmail)}
                      className="mt-3 rounded-lg border border-red-400/30 bg-[#291515] px-3 py-1.5 text-[12px] font-bold text-red-200 transition-colors hover:bg-[#321818]"
                    >
                      Retry body load
                    </button>
                  </div>
                ) : selectedEmail.bodyHtml && selectedEmail.bodyHtml.trim().length > 0 ? (
                  <div className="overflow-hidden rounded-xl border border-[#2a2a2a] bg-white">
                    <iframe
                      title={`Email content: ${selectedEmail.subject}`}
                      sandbox=""
                      srcDoc={buildEmailSrcDoc(selectedEmail.bodyHtml)}
                      className="h-[68vh] w-full bg-white"
                    />
                  </div>
                ) : (
                  <div className="whitespace-pre-wrap text-[13px] font-medium leading-relaxed text-[#ccc]">
                    {selectedEmail.body?.trim() ? selectedEmail.body : "No message content."}
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
                {isRefreshingEmails ? (
                  <div className="px-4 pt-3 text-[10px] font-semibold uppercase tracking-widest text-[#666]">
                    Updating...
                  </div>
                ) : null}
                {!activeAccount && !isAllAccountsView ? (
                  <div className="p-8 text-center text-[13px] font-medium text-[#666]">
                    Select or add an account.
                  </div>
                ) : mailError ? (
                  <div className="p-5">
                    <p className="text-[12px] font-bold uppercase tracking-widest text-red-400">
                      Mail loading failed
                    </p>
                    <p className="mt-2 text-[12px] text-red-200/90">{mailError}</p>
                    <button
                      onClick={() => void fetchEmails(activeFolder, activeAccountId, { force: true })}
                      className="mt-3 rounded-lg border border-red-400/30 bg-[#291515] px-3 py-1.5 text-[12px] font-bold text-red-200 transition-colors hover:bg-[#321818]"
                    >
                      Retry
                    </button>
                  </div>
                ) : isLoadingEmails ? (
                  <div className="grid gap-2 p-4">
                    {Array.from({ length: 8 }).map((_, idx) => (
                      <div key={idx} className="grid gap-2 rounded-lg border border-[#1d1d1d] bg-[#121212] p-3">
                        <div className="h-3 w-1/3 animate-pulse rounded bg-[#2a2a2a]" />
                        <div className="h-3 w-4/5 animate-pulse rounded bg-[#252525]" />
                      </div>
                    ))}
                  </div>
                ) : emails.length === 0 ? (
                  <div className="p-8 text-center text-[13px] font-medium text-[#666]">
                    No emails here.
                  </div>
                ) : (
                  emails.map((email) => (
                    <button
                      key={email.id}
                      onClick={() => {
                        setSelectedEmailId(email.id);
                        setSelectedBodyError(null);
                        if (!email.read) {
                          setEmails((current) =>
                            current.map((item) =>
                              item.id === email.id ? { ...item, read: true } : item,
                            ),
                          );
                          if (email.accountId) {
                            void invoke("email_apply_flag", {
                              input: {
                                accountId: email.accountId,
                                folder: email.folder,
                                uid: email.uid,
                                flag: "seen",
                                value: true,
                              },
                            });
                          }
                        }
                        if (!email.body) {
                          void loadSelectedBody(email);
                        }
                      }}
                      className={`group relative w-full p-[10px] text-left transition-all hover:bg-[#111] ${selectedEmailId === email.id ? "border-l-2 border-l-[#6a6a6a] bg-[#161616]" : "border-l-2 border-l-transparent"}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="min-w-0 flex-1 truncate">
                          {email.starred ? (
                            <span
                              className="mail-flag-wave mr-2 inline-flex align-middle text-[#7a7a7a]"
                              aria-label="Flagged message"
                              title="Flagged"
                            >
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M5 22V3" />
                                <path className="mail-flag-wave__cloth" d="M5 3h12l-1.8 4L17 11H5z" />
                              </svg>
                            </span>
                          ) : null}
                          <span
                            className={`text-[14px] font-normal ${email.read ? "text-[#777777]" : "text-[#B2B2B2]"}`}
                            style={{ fontFamily: "Inter, Inter_400Regular, system-ui, sans-serif" }}
                          >
                            {email.sender}
                          </span>
                          <span
                            className="ml-3 text-[14px] font-normal text-[#626262]"
                            style={{ fontFamily: "Inter, Inter_400Regular, system-ui, sans-serif" }}
                          >
                            {email.subject}
                          </span>
                        </div>
                        <span
                          className="shrink-0 whitespace-nowrap text-[14px] font-normal text-[#626262]"
                          style={{ fontFamily: "Inter, Inter_400Regular, system-ui, sans-serif" }}
                        >
                          {formatEmailDate(email.date)}
                        </span>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </>
          )}
          {isComposing && (
            <div className="absolute inset-x-8 bottom-0 top-16 z-50 flex animate-in slide-in-from-bottom-[100%] duration-300 flex-col rounded-t-2xl border border-[#333] border-b-0 bg-[#1a1a1a] shadow-[-20px_-20px_60px_rgba(0,0,0,0.6)]">
              <div className="h-12 rounded-t-2xl border-b border-[#333] bg-[#222] px-4 flex items-center justify-between">
                <span className="text-[13px] font-bold text-[#ddd]">New Message</span>
                <button
                  onClick={() => setIsComposing(false)}
                  className="text-[#888] transition-colors hover:text-[#fff]"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <div className="flex flex-1 flex-col gap-4 p-6">
                <div className="flex items-center border-b border-[#333] pb-2 text-[13px]">
                  <label className="w-14 font-bold text-[#666]">To:</label>
                  <input
                    type="email"
                    value={composeTo}
                    onChange={(e) => setComposeTo(e.target.value)}
                    className="flex-1 bg-transparent font-medium text-[#eee] outline-none"
                    autoFocus
                  />
                </div>
                <div className="flex items-center border-b border-[#333] pb-2 text-[13px]">
                  <label className="w-14 font-bold text-[#666]">Subject:</label>
                  <input
                    type="text"
                    value={composeSubject}
                    onChange={(e) => setComposeSubject(e.target.value)}
                    className="flex-1 bg-transparent font-medium text-[#eee] outline-none"
                  />
                </div>
                <textarea
                  value={composeBody}
                  onChange={(e) => setComposeBody(e.target.value)}
                  className="custom-scrollbar flex-1 resize-none bg-transparent pt-4 text-[14px] font-medium leading-relaxed text-[#ccc] outline-none"
                />
              </div>
              <div className="flex items-center justify-between border-t border-[#333] bg-[#222] p-4">
                <div className="flex gap-3">
                  <button className="cursor-not-allowed text-[#555] hover:text-[#fff]">
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                    </svg>
                  </button>
                </div>
                <button
                  onClick={handleSend}
                  disabled={isSending}
                  className={`flex items-center gap-2 rounded-lg bg-[#2f2f2f] px-8 py-2.5 text-[13px] font-bold text-white shadow transition-colors hover:bg-[#3a3a3a] ${isSending ? "cursor-not-allowed opacity-50" : ""}`}
                >
                  {isSending && (
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                  )}
                  Send Message
                </button>
              </div>
            </div>
          )}
        </div>
      }
      right={
        <div className="h-full min-h-0" />
      }
    />
  );
}
