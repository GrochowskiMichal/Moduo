type EmailComposePanelProps = {
  composeTo: string;
  composeSubject: string;
  composeBody: string;
  isSending: boolean;
  onClose: () => void;
  onSend: () => void;
  setComposeTo: (value: string) => void;
  setComposeSubject: (value: string) => void;
  setComposeBody: (value: string) => void;
};

export function EmailComposePanel({
  composeTo,
  composeSubject,
  composeBody,
  isSending,
  onClose,
  onSend,
  setComposeTo,
  setComposeSubject,
  setComposeBody,
}: EmailComposePanelProps) {
  return (
    <div className="absolute inset-x-8 bottom-0 top-16 z-50 flex animate-in slide-in-from-bottom-[100%] duration-300 flex-col rounded-t-2xl border border-[#333] border-b-0 bg-[#1a1a1a] shadow-[-20px_-20px_60px_rgba(0,0,0,0.6)]">
      <div className="h-12 rounded-t-2xl border-b border-[#333] bg-[#222] px-4 flex items-center justify-between">
        <span className="text-[13px] font-bold text-[#ddd]">New Message</span>
        <button
          onClick={onClose}
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
            onChange={(event) => setComposeTo(event.target.value)}
            className="flex-1 bg-transparent font-medium text-[#eee] outline-none"
            autoFocus
          />
        </div>
        <div className="flex items-center border-b border-[#333] pb-2 text-[13px]">
          <label className="w-14 font-bold text-[#666]">Subject:</label>
          <input
            type="text"
            value={composeSubject}
            onChange={(event) => setComposeSubject(event.target.value)}
            className="flex-1 bg-transparent font-medium text-[#eee] outline-none"
          />
        </div>
        <textarea
          value={composeBody}
          onChange={(event) => setComposeBody(event.target.value)}
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
          onClick={onSend}
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
  );
}
