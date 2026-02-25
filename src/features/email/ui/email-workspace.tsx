import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FeaturePanelsShell } from "../../../components/app/feature-panels-shell";

type ConnectionStatus = "disconnected" | "connecting" | "connected";
type MailboxProvider = "gmail" | "outlook" | "icloud";
type FolderType = "inbox" | "sent" | "drafts" | "trash";

interface Email {
  id: string;
  sender: string;
  senderEmail: string;
  subject: string;
  preview: string;
  body: string;
  date: string;
  read: boolean;
  folder: string;
  tags?: string[];
}

type AccountStatus = "active" | "reauth_required" | "error";

interface SavedAccount {
  id: string;
  provider: MailboxProvider;
  email: string;
  lastSyncAt: string | null;
  status: AccountStatus;
  lastError: string | null;
}

const FOLDERS: Array<{ id: FolderType; label: string; icon: "inbox" | "send" | "file" | "trash-2" }> = [
  { id: "inbox", label: "Inbox", icon: "inbox" },
  { id: "sent", label: "Sent", icon: "send" },
  { id: "drafts", label: "Drafts", icon: "file" },
  { id: "trash", label: "Trash", icon: "trash-2" },
];

const PROVIDER_LABEL: Record<MailboxProvider, string> = {
  gmail: "Google",
  outlook: "Outlook",
  icloud: "iCloud",
};

export function EmailWorkspace() {
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("disconnected");
  const [provider, setProvider] = useState<MailboxProvider | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [mailError, setMailError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<SavedAccount[]>([]);
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);

  const [creds, setCreds] = useState({ email: "", password: "" });
  const [activeFolder, setActiveFolder] = useState<FolderType>("inbox");
  const [selectedEmailId, setSelectedEmailId] = useState<string | null>(null);
  const [isComposing, setIsComposing] = useState(false);

  const [emails, setEmails] = useState<Email[]>([]);
  const [isLoadingEmails, setIsLoadingEmails] = useState(false);

  // Compose state
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [isSending, setIsSending] = useState(false);
  const activeAccount = accounts.find((account) => account.id === activeAccountId) ?? null;

  const toErrorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

  const loadAccounts = async (preferredAccountId?: string | null) => {
    const nextAccounts = (await invoke("email_accounts_list")) as SavedAccount[];
    setAccounts(nextAccounts);

    if (nextAccounts.length === 0) {
      setActiveAccountId(null);
      setConnectionStatus("disconnected");
      setEmails([]);
      setSelectedEmailId(null);
      setMailError(null);
      return;
    }

    const preferredId = preferredAccountId ?? activeAccountId;
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
    setConnectionStatus("connecting");
    setAuthError(null);

    try {
      const nextAccount = (await invoke("email_account_connect_and_save", {
        input: {
          provider,
          email: creds.email.trim(),
          password: creds.password,
        },
      })) as SavedAccount;
      setCreds({ email: "", password: "" });
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

  const fetchEmails = async (folder: FolderType, accountId = activeAccountId) => {
    if (!accountId) {
      setEmails([]);
      setMailError(null);
      return;
    }

    setIsLoadingEmails(true);
    setMailError(null);
    try {
      const res = (await invoke("email_fetch_saved", {
        accountId,
        folder,
      })) as Email[];
      setEmails(res);
      await loadAccounts(accountId);
    } catch (e: any) {
      setMailError(toErrorMessage(e));
      setEmails([]);
      await loadAccounts(accountId);
    } finally {
      setIsLoadingEmails(false);
    }
  };

  useEffect(() => {
    let active = true;
    const bootstrap = async () => {
      try {
        await loadAccounts();
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
    if (connectionStatus === "connected" && activeAccount) {
      if (activeAccount.status === "reauth_required") {
        setMailError("Account requires reconnect. Re-enter app password.");
        setEmails([]);
        return;
      }
      void fetchEmails(activeFolder, activeAccount.id);
      setSelectedEmailId(null);
    }
  }, [activeFolder, activeAccountId, connectionStatus]);

  const handleSend = async () => {
    if (!activeAccountId || !composeTo || !composeBody) return;
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
        void fetchEmails("sent");
      }
    } catch (e: any) {
      setMailError(toErrorMessage(e));
      await loadAccounts(activeAccountId);
    } finally {
      setIsSending(false);
    }
  };

  const handleDisconnectAccount = async (accountId: string) => {
    await invoke("email_account_disconnect", { accountId });
    await loadAccounts(activeAccountId === accountId ? null : activeAccountId);
  };

  const selectedEmail = emails.find((e) => e.id === selectedEmailId);

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
      <div className="flex h-full w-full flex-col items-center justify-center bg-[#0C0C0C] bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#1a1a1a] to-[#0C0C0C]">
        <div className="w-[480px] rounded-3xl border border-[#222] bg-[#111] p-10 shadow-2xl backdrop-blur-xl transition-all">
          <div className="mb-8 text-center">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#2a2a2a] text-[#d0d0d0] border border-[#3a3a3a] shadow-inner">
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
            <h1 className="text-2xl font-black tracking-tight text-[#f3f3f3] mb-2">
              Connect Your Mailbox
            </h1>
            <p className="text-[14px] text-[#888] font-medium leading-relaxed">
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
              className="mb-4 w-full rounded-xl border border-[#2b2b2b] bg-[#151515] px-4 py-2 text-[12px] font-bold text-[#d8d8d8] transition-colors hover:bg-[#1b1b1b]"
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
            <div className="flex flex-col gap-4">
              <button
                onClick={() => handleProviderSelect("gmail")}
                className="group relative flex w-full items-center justify-between rounded-xl border border-[#333] bg-[#161616] p-4 transition-all hover:bg-[#1a1a1a] hover:border-[#444] hover:shadow-lg"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-sm">
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
                    <span className="text-[14px] font-bold text-[#f3f3f3]">
                      Google Workspace
                    </span>
                    <span className="text-[12px] font-medium text-[#777]">
                      Connect Gmail
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-center rounded-full bg-[#222] p-2 text-[#888] transition-colors group-hover:bg-[#333] group-hover:text-white">
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
                className="group relative flex w-full items-center justify-between rounded-xl border border-[#333] bg-[#161616] p-4 transition-all hover:bg-[#1a1a1a] hover:border-[#444] hover:shadow-lg"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#9a9a9a] shadow-sm text-white">
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
                    <span className="text-[14px] font-bold text-[#f3f3f3]">
                      Microsoft Outlook
                    </span>
                    <span className="text-[12px] font-medium text-[#777]">
                      Office 365 & Outlook
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-center rounded-full bg-[#222] p-2 text-[#888] transition-colors group-hover:bg-[#333] group-hover:text-white">
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
                className="group relative flex w-full items-center justify-between rounded-xl border border-[#333] bg-[#161616] p-4 transition-all hover:bg-[#1a1a1a] hover:border-[#444] hover:shadow-lg"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#E5E5EA] shadow-sm text-black">
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
                    <span className="text-[14px] font-bold text-[#f3f3f3]">
                      Apple iCloud
                    </span>
                    <span className="text-[12px] font-medium text-[#777]">
                      Connect iCloud Mail
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-center rounded-full bg-[#222] p-2 text-[#888] transition-colors group-hover:bg-[#333] group-hover:text-white">
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
                  className="w-full bg-[#161616] border border-[#333] focus:border-[#555] outline-none px-4 py-3 rounded-xl text-[14px] text-[#eee]"
                  placeholder="you@domain.com"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold uppercase tracking-widest text-[#555] mb-2 flex items-center justify-between">
                  <span>App Password (Not Standard Password!)</span>
                  <div className="relative group cursor-help flex items-center">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      className="text-[#888] hover:text-[#bbb] transition-colors"
                    >
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="16" x2="12" y2="12" />
                      <line x1="12" y1="8" x2="12.01" y2="8" />
                    </svg>
                    <div className="absolute bottom-full right-0 mb-3 w-[280px] bg-[#1a1a1a] border border-[#333] text-[#ccc] text-[12px] p-4 rounded-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50 shadow-2xl normal-case font-medium whitespace-pre-wrap leading-relaxed">
                      {provider === "gmail" && (
                        <>
                          <span className="text-white font-bold block mb-2">
                            Google App Password:
                          </span>
                          1. Go to Google Account Security
                          <br />
                          2. Ensure 2-Step Verification is ON
                          <br />
                          3. Search for "App Passwords"
                          <br />
                          4. Select App: "Other" (Name: Moduo)
                          <br />
                          5. Paste the 16-character code here
                        </>
                      )}
                      {provider === "outlook" && (
                        <>
                          <span className="text-white font-bold block mb-2">
                            Outlook App Password:
                          </span>
                          1. Go to Microsoft Account Security
                          <br />
                          2. Ensure 2-Step Verification is ON
                          <br />
                          3. Open "Advanced security options"
                          <br />
                          4. Click "Create a new app password"
                          <br />
                          5. Paste the generated code here
                        </>
                      )}
                      {provider === "icloud" && (
                        <>
                          <span className="text-white font-bold block mb-2">
                            iCloud App-Specific Password:
                          </span>
                          1. Go to appleid.apple.com
                          <br />
                          2. Go to "Sign-In and Security"
                          <br />
                          3. Select "App-Specific Passwords"
                          <br />
                          4. Click "Generate an app-specific password"
                          <br />
                          5. Paste the generated code here
                        </>
                      )}
                      <div className="absolute top-full right-1 border-8 border-transparent border-t-[#333]">
                        <div className="absolute -top-2.5 -left-2 border-[7px] border-transparent border-t-[#1a1a1a]" />
                      </div>
                    </div>
                  </div>
                </label>
                <input
                  type="password"
                  value={creds.password}
                  onChange={(e) =>
                    setCreds({ ...creds, password: e.target.value })
                  }
                  className="w-full bg-[#161616] border border-[#333] focus:border-[#555] outline-none px-4 py-3 rounded-xl text-[14px] text-[#eee]"
                  placeholder="••••••••••••"
                />
              </div>
              <div className="flex gap-3 mt-4">
                <button
                  onClick={() => setProvider(null)}
                  className="flex-1 py-3 text-[#f3f3f3] text-[13px] font-bold hover:bg-[#222] rounded-xl transition-colors shrink-0 max-w-24"
                >
                  Back
                </button>
                <button
                  onClick={handleConnect}
                  className="flex-1 py-3 bg-[#2f2f2f] hover:bg-[#3a3a3a] text-white rounded-xl font-bold text-[13px] flex justify-center shadow-lg transition-colors"
                >
                  Connect
                </button>
              </div>
            </div>
          )}

          <div className="mt-8 text-center border-t border-[#222] pt-6">
            <p className="text-[11px] font-bold uppercase tracking-widest text-[#555] flex items-center justify-center gap-2">
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

  const renderFolderIcon = (icon: (typeof FOLDERS)[number]["icon"]) => (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {icon === "inbox" && (
        <>
          <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
          <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
        </>
      )}
      {icon === "send" && (
        <>
          <line x1="22" y1="2" x2="11" y2="13" />
          <polygon points="22 2 15 22 11 13 2 9 22 2" />
        </>
      )}
      {icon === "file" && (
        <>
          <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
          <polyline points="13 2 13 9 20 9" />
        </>
      )}
      {icon === "trash-2" && (
        <>
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          <line x1="10" y1="11" x2="10" y2="17" />
          <line x1="14" y1="11" x2="14" y2="17" />
        </>
      )}
    </svg>
  );

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
  };

  // Connected Mail Client View
  return (
    <FeaturePanelsShell
      feature="email"
      left={
        <div className="flex h-full min-h-0 flex-col">
          <button
            onClick={() => setIsComposing(true)}
            className="flex items-center justify-center gap-2 rounded-xl bg-[#2f2f2f] py-2.5 text-[13px] font-bold text-white shadow transition-colors hover:bg-[#3a3a3a]"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
            Compose
          </button>

          <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
            <p className="mb-2 px-2 text-[10px] font-black uppercase tracking-widest text-[#555]">
              Accounts & folders
            </p>
            <div className="grid gap-2">
              {accounts.map((account) => (
                <div key={account.id} className="rounded-xl border border-[#252525] bg-[#121212] p-2">
                  <button
                    onClick={() => setActiveAccountId(account.id)}
                    className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left transition-colors ${activeAccountId === account.id ? "bg-[#1f1f1f] text-[#ececec]" : "text-[#b0b0b0] hover:bg-[#171717]"}`}
                  >
                    <span className="truncate text-[12px] font-bold">{account.email}</span>
                    <span className="text-[10px] font-bold uppercase tracking-wide text-[#6f6f6f]">
                      {PROVIDER_LABEL[account.provider]}
                    </span>
                  </button>

                  <div className="mt-1 flex items-center justify-between px-2 text-[10px] font-bold uppercase tracking-widest">
                    <span
                      className={
                        account.status === "active"
                          ? "text-[#b0b0b0]"
                          : account.status === "reauth_required"
                            ? "text-amber-400/90"
                            : "text-rose-400/90"
                      }
                    >
                      {account.status.replace("_", " ")}
                    </span>
                    <button
                      onClick={() => void handleDisconnectAccount(account.id)}
                      className="text-[#7f7f7f] transition-colors hover:text-[#f4b4b4]"
                    >
                      Disconnect
                    </button>
                  </div>
                  {account.status === "reauth_required" ? (
                    <button
                      onClick={() => {
                        setProvider(account.provider);
                        setCreds({ email: account.email, password: "" });
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

                  <div className="mt-2 grid gap-1">
                    {FOLDERS.map((folder) => {
                      const isActive =
                        activeAccountId === account.id && activeFolder === folder.id;
                      return (
                        <button
                          key={`${account.id}:${folder.id}`}
                          onClick={() => selectAccountFolder(account.id, folder.id)}
                          disabled={account.status === "reauth_required"}
                          className={`flex items-center gap-3 rounded-lg px-3 py-2 text-[12px] font-bold transition-all disabled:cursor-not-allowed disabled:opacity-50 ${isActive ? "bg-[#222] text-[#d0d0d0]" : "text-[#888] hover:bg-[#181818] hover:text-[#d6d6d6]"}`}
                        >
                          {renderFolderIcon(folder.icon)}
                          <span>{folder.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={beginAddAccount}
            className="mt-4 rounded-xl border border-dashed border-[#333] px-3 py-2 text-[12px] font-bold text-[#bbbbbb] transition-colors hover:border-[#4a4a4a] hover:bg-[#151515]"
          >
            + Add new account
          </button>
        </div>
      }
      center={
        <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
          {selectedEmail ? (
            <>
              <div className="h-12 shrink-0 border-b border-[#222] px-3 flex items-center justify-between">
                <button
                  onClick={() => setSelectedEmailId(null)}
                  className="text-[11px] font-bold text-[#777] transition-colors hover:text-[#bbb]"
                >
                  Back to list
                </button>
                <div className="text-[11px] font-bold text-[#666]">{selectedEmail.date}</div>
              </div>
              <div className="custom-scrollbar flex-1 overflow-y-auto p-4">
                <h1 className="mb-4 text-[18px] font-black tracking-tight text-[#f3f3f3]">
                  {selectedEmail.subject}
                </h1>
                <div className="mb-4 text-[12px] text-[#888]">
                  <div className="font-bold text-[#ddd]">{selectedEmail.sender}</div>
                  <div>{selectedEmail.senderEmail}</div>
                </div>
                <div className="whitespace-pre-wrap text-[13px] font-medium leading-relaxed text-[#ccc]">
                  {selectedEmail.body}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex h-16 items-center justify-between border-b border-[#222] px-1">
                <div className="min-w-0">
                  <h2 className="truncate text-[15px] font-black tracking-tight text-[#f3f3f3] capitalize">
                    {activeFolder}
                  </h2>
                  <p className="truncate text-[11px] font-medium text-[#666]">
                    {activeAccount?.email ?? "No account selected"}
                  </p>
                </div>
                <button
                  onClick={() => void fetchEmails(activeFolder)}
                  disabled={!activeAccount}
                  className="text-[#666] transition-colors hover:text-[#aaa] disabled:opacity-40"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                </button>
              </div>
              <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
                {!activeAccount ? (
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
                      onClick={() => void fetchEmails(activeFolder)}
                      className="mt-3 rounded-lg border border-red-400/30 bg-[#291515] px-3 py-1.5 text-[12px] font-bold text-red-200 transition-colors hover:bg-[#321818]"
                    >
                      Retry
                    </button>
                  </div>
                ) : isLoadingEmails ? (
                  <div className="mt-[100px] flex flex-col items-center justify-center p-8 text-[#555]">
                    <div className="mb-4 h-8 w-8 animate-spin rounded-full border-4 border-[#333] border-t-[#6a6a6a]" />
                    <p className="text-[12px] font-bold uppercase tracking-widest">Fetching Envelope...</p>
                  </div>
                ) : emails.length === 0 ? (
                  <div className="p-8 text-center text-[13px] font-medium text-[#666]">
                    No emails here.
                  </div>
                ) : (
                  emails.map((email) => (
                    <button
                      key={email.id}
                      onClick={() => setSelectedEmailId(email.id)}
                      className={`group relative w-full border-b border-[#1a1a1a] p-4 text-left transition-all hover:bg-[#111] ${selectedEmailId === email.id ? "border-l-2 border-l-[#6a6a6a] bg-[#161616]" : "border-l-2 border-l-transparent"}`}
                    >
                      {!email.read && (
                        <div className="absolute left-2 top-4 h-2 w-2 rounded-full bg-[#8a8a8a]" />
                      )}
                      <div className="mb-1 flex items-baseline justify-between">
                        <span
                          className={`truncate pr-2 text-[13px] ${!email.read ? "font-black text-[#fff]" : "font-bold text-[#bbb]"}`}
                        >
                          {email.sender}
                        </span>
                        <span className="whitespace-nowrap text-[11px] font-medium text-[#666]">
                          {email.date}
                        </span>
                      </div>
                      <h4
                        className={`mb-1 truncate text-[13px] ${!email.read ? "font-bold text-[#eee]" : "font-medium text-[#999]"}`}
                      >
                        {email.subject}
                      </h4>
                      <p className="line-clamp-2 text-[12px] leading-relaxed text-[#666]">
                        {email.preview}
                      </p>
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
