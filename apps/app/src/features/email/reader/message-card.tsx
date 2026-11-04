// One message in the reader's conversation stack (MR-10): header, the body
// (sanitized HTML in the sandboxed iframe, or text with quoted history
// collapsed, AC16), "Show original" (the raw source), the attachments strip
// and, for an invite, the invite card slot.

import { type ReactNode, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type { MailAttachment, MailMessage } from "@/lib/runtime.types.mail-engine";

import { EMAIL_IFRAME_HEIGHT_MESSAGE } from "../utils/email-html";
import { AttachmentStrip } from "./attachments";
import { buildReaderDoc, type ReaderImagesInput } from "./sanitize";

const IFRAME_MAX_PX = 20000;
const IFRAME_FALLBACK_PX = 320;

const DEFAULT_IMAGES: ReaderImagesInput = {
  policy: "block",
  senderIsContact: false,
  senderAllowed: false,
  loadedForMessage: false,
};

export type MessageCardProps = {
  message: MailMessage;
  threadId?: string;
  expanded?: boolean;
  onToggle?: () => void;
  images?: ReaderImagesInput;
  trackerBlocking?: boolean;
  /** Fetches the raw RFC 822 source; absent hides "Show original". */
  loadOriginal?: (messageId: string) => Promise<string>;
  fileUrl?: (a: MailAttachment) => string | null;
  previewUrl?: (a: MailAttachment) => string | null;
  /** Fetches the attachment's file (preview and open). */
  onAttachment?: (a: MailAttachment) => void;
  invite?: ReactNode;
};

function HtmlBody({
  message,
  images,
  trackerBlocking,
}: Required<Pick<MessageCardProps, "message" | "images" | "trackerBlocking">>) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  const [loadOnce, setLoadOnce] = useState(false);
  const doc = buildReaderDoc(
    message.id,
    message.html ?? "",
    { ...images, loadedForMessage: images.loadedForMessage || loadOnce },
    trackerBlocking,
  );
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!ref.current || event.source !== ref.current.contentWindow) return;
      const data = event.data as { type?: unknown; height?: unknown } | null;
      if (!data || data.type !== EMAIL_IFRAME_HEIGHT_MESSAGE) return;
      const h = data.height;
      if (typeof h === "number" && Number.isFinite(h) && h > 0)
        setHeight(Math.min(Math.ceil(h) + 2, IFRAME_MAX_PX));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  return (
    <div className="flex flex-col gap-2">
      {doc.remoteBlocked > 0 || doc.trackers > 0 ? (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {doc.trackers > 0 ? <span>{doc.trackers} trackers blocked</span> : null}
          {doc.remoteBlocked > 0 ? (
            <Button size="sm" variant="ghost" onClick={() => setLoadOnce(true)}>
              Load images
            </Button>
          ) : null}
        </div>
      ) : null}
      {/* The one sanctioned non-token surface: foreign HTML, sandboxed with
          only the nonce-pinned height reporter; never add allow-same-origin.
          Height is runtime geometry, so the inline style is fine. */}
      <iframe
        ref={ref}
        title={`Message from ${message.from.name || message.from.email}`}
        sandbox="allow-scripts"
        srcDoc={doc.srcDoc}
        className="block w-full rounded-md border border-hairline"
        style={{ height: height ?? IFRAME_FALLBACK_PX }}
      />
    </div>
  );
}

function TextBody({ text, quoteOffset }: { text: string; quoteOffset: number | null }) {
  const [showQuote, setShowQuote] = useState(false);
  const cut = quoteOffset !== null && quoteOffset > 0 && quoteOffset < text.length;
  const head = cut ? text.slice(0, quoteOffset).trimEnd() : text;
  const quote = cut ? text.slice(quoteOffset) : "";
  return (
    <div className="flex flex-col gap-2 text-sm text-foreground">
      <p className="whitespace-pre-wrap">{head}</p>
      {cut ? (
        showQuote ? (
          <p className="whitespace-pre-wrap border-l border-hairline pl-3 text-muted-foreground">
            {quote}
          </p>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="self-start"
            onClick={() => setShowQuote(true)}
          >
            Show quoted text
          </Button>
        )
      ) : null}
    </div>
  );
}

export function MessageCard({
  message,
  threadId = "",
  expanded = true,
  onToggle,
  images = DEFAULT_IMAGES,
  trackerBlocking = true,
  loadOriginal,
  fileUrl,
  previewUrl,
  onAttachment,
  invite,
}: MessageCardProps) {
  const [original, setOriginal] = useState<string | null>(null);
  const [originalError, setOriginalError] = useState<string | null>(null);
  const showOriginal = async () => {
    if (!loadOriginal) return;
    setOriginalError(null);
    try {
      setOriginal(await loadOriginal(message.id));
    } catch (e) {
      setOriginalError(e instanceof Error ? e.message : String(e));
    }
  };
  const date = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(message.dateMs);

  return (
    <article
      aria-label={`Message from ${message.from.name || message.from.email}`}
      data-message-id={message.id}
      className="flex flex-col gap-3 border-b border-hairline px-4 py-3"
    >
      <header className="flex items-baseline gap-2">
        <button
          type="button"
          onClick={onToggle}
          className="min-w-0 flex-1 truncate text-left text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {message.from.name || message.from.email}
          {!expanded ? (
            <span className="ml-2 font-normal text-muted-foreground">{message.snippet}</span>
          ) : null}
        </button>
        <time className="shrink-0 text-xs text-muted-foreground">{date}</time>
      </header>
      {expanded ? (
        <>
          {invite}
          {message.html ? (
            <HtmlBody message={message} images={images} trackerBlocking={trackerBlocking} />
          ) : (
            <TextBody text={message.text ?? message.snippet} quoteOffset={message.quoteOffset} />
          )}
          <AttachmentStrip
            attachments={message.attachments}
            threadId={threadId}
            messageId={message.id}
            fileUrl={fileUrl}
            previewUrl={previewUrl}
            onPreview={onAttachment}
          />
          {loadOriginal ? (
            <div className="flex flex-col gap-2">
              {original === null ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="self-start"
                  onClick={() => void showOriginal()}
                >
                  Show original
                </Button>
              ) : (
                <pre
                  aria-label="Original message"
                  className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-hairline p-2 font-mono text-xs text-muted-foreground"
                >
                  {original}
                </pre>
              )}
              {originalError ? (
                <p role="alert" className="text-xs text-destructive">
                  {originalError}
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </article>
  );
}
