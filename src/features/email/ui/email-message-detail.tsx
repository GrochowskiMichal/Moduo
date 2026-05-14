import type { Email } from "../model/email-types";
import { formatEmailDetailDate } from "../utils/email-format";
import { buildEmailSrcDoc } from "../utils/email-html";

type EmailMessageDetailProps = {
  email: Email;
  accountEmail?: string | null;
  loadingBodyEmailId: string | null;
  selectedBodyError: string | null;
  onBack: () => void;
  onRetryBody: (email: Email) => void;
};

export function EmailMessageDetail({
  email,
  accountEmail,
  loadingBodyEmailId,
  selectedBodyError,
  onBack,
  onRetryBody,
}: EmailMessageDetailProps) {
  return (
    <>
      <div className="shrink-0 border-b border-[#222] px-3 py-2">
        <div className="flex items-start gap-2">
          <button
            onClick={onBack}
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
                {email.subject}
              </h1>
              <div className="shrink-0 pl-2 text-[11px] font-medium text-[#666]">
                {formatEmailDetailDate(email.date)}
              </div>
            </div>
            <p className="truncate text-[12px] text-[#bdbdbd]">
              <span className="text-[#8f8f8f]">From:</span>{" "}
              {email.senderEmail
                ? `${email.sender} <${email.senderEmail}>`
                : email.sender}
            </p>
            <p className="truncate text-[12px] text-[#7c7c7c]">
              <span className="text-[#8f8f8f]">To:</span>{" "}
              {email.to?.trim() || email.accountEmail || accountEmail || "—"}
            </p>
          </div>
        </div>
      </div>
      <div className="custom-scrollbar flex-1 overflow-y-auto p-4">
        {loadingBodyEmailId === email.id ? (
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
              onClick={() => onRetryBody(email)}
              className="mt-3 rounded-lg border border-red-400/30 bg-[#291515] px-3 py-1.5 text-[12px] font-bold text-red-200 transition-colors hover:bg-[#321818]"
            >
              Retry body load
            </button>
          </div>
        ) : email.bodyHtml && email.bodyHtml.trim().length > 0 ? (
          <div className="overflow-hidden rounded-xl border border-[#2a2a2a] bg-white">
            <iframe
              title={`Email content: ${email.subject}`}
              sandbox=""
              srcDoc={buildEmailSrcDoc(email.bodyHtml)}
              className="h-[68vh] w-full bg-white"
            />
          </div>
        ) : (
          <div className="whitespace-pre-wrap text-[13px] font-medium leading-relaxed text-[#ccc]">
            {email.body?.trim() ? email.body : "No message content."}
          </div>
        )}
      </div>
    </>
  );
}
