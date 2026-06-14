import type { Email } from "../model/email-types";
import { formatEmailDate } from "../utils/email-format";

type EmailMessageListProps = {
  emails: Email[];
  selectedEmailId: string | null;
  hasActiveMailbox: boolean;
  isRefreshingEmails: boolean;
  isLoadingEmails: boolean;
  mailError: string | null;
  onRetry: () => void;
  onSelectEmail: (email: Email) => void;
};

export function EmailMessageList({
  emails,
  selectedEmailId,
  hasActiveMailbox,
  isRefreshingEmails,
  isLoadingEmails,
  mailError,
  onRetry,
  onSelectEmail,
}: EmailMessageListProps) {
  return (
    <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
      {isRefreshingEmails ? (
        <div className="px-4 pt-3 text-[10px] font-semibold uppercase tracking-widest text-[#666]">
          Updating...
        </div>
      ) : null}
      {!hasActiveMailbox ? (
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
            onClick={onRetry}
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
            onClick={() => onSelectEmail(email)}
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
  );
}
