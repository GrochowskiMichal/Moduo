import type { ConnectionStatus, MailboxProvider, SavedAccount } from "../model/email-types";

type EmailCredentials = {
  email: string;
  password: string;
};

type CustomHosts = {
  imapHost: string;
  smtpHost: string;
  imapPort: string;
  smtpPort: string;
};

type EmailConnectionSetupProps = {
  connectionStatus: ConnectionStatus;
  accounts: SavedAccount[];
  activeAccountId: string | null;
  provider: MailboxProvider | null;
  authError: string | null;
  creds: EmailCredentials;
  customHosts: CustomHosts;
  loadAccounts: (preferredAccountId?: string | null) => Promise<void>;
  handleProviderSelect: (provider: MailboxProvider) => void;
  handleConnect: () => Promise<void>;
  setProvider: (provider: MailboxProvider | null) => void;
  setCreds: (creds: EmailCredentials) => void;
  setCustomHosts: (hosts: CustomHosts) => void;
};

export function EmailConnectionSetup({
  connectionStatus,
  accounts,
  activeAccountId,
  provider,
  authError,
  creds,
  customHosts,
  loadAccounts,
  handleProviderSelect,
  handleConnect,
  setProvider,
  setCreds,
  setCustomHosts,
}: EmailConnectionSetupProps) {
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
                onChange={(event) =>
                  setCreds({ ...creds, email: event.target.value })
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
                onChange={(event) =>
                  setCreds({ ...creds, password: event.target.value })
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
                      onChange={(event) =>
                        setCustomHosts({ ...customHosts, imapHost: event.target.value })
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
                      onChange={(event) =>
                        setCustomHosts({ ...customHosts, imapPort: event.target.value })
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
                      onChange={(event) =>
                        setCustomHosts({ ...customHosts, smtpHost: event.target.value })
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
                      onChange={(event) =>
                        setCustomHosts({ ...customHosts, smtpPort: event.target.value })
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
                onClick={() => void handleConnect()}
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
