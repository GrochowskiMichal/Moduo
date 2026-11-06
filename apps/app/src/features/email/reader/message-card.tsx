// One message in the reader's conversation stack (MR-10, specs/mail-v3.md §8):
// the header (avatar, name, the to-line with Show addresses, reply / reply all
// / forward for this message), the body (sanitized HTML in the sandboxed
// iframe under the tracker bar, or text with quoted history collapsed, AC16;
// the pending states while the body isn't on this Mac), the attachments strip,
// the invite card slot and, when the ⋯ menu asks, the raw source.

import { Forward, Reply, ReplyAll } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { initialsOf } from "@/lib/initials";
import type { MailAttachment, MailMessage } from "@/lib/runtime.types.mail-engine";

import { EMAIL_IFRAME_HEIGHT_MESSAGE } from "../utils/email-html";
import { AttachmentStrip } from "./attachments";
import { bodyIsPending, BodyPending } from "./body-pending";
import { recipientsOf, toLine } from "./reader-format";
import { buildReaderDoc, type ReaderImagesInput } from "./sanitize";
import { TrackerBar } from "./tracker-bar";

const IFRAME_MAX_PX = 20000;
const IFRAME_FALLBACK_PX = 320;

const DEFAULT_IMAGES: ReaderImagesInput = {
  policy: "block",
  senderIsContact: false,
  senderAllowed: false,
  loadedForMessage: false,
};

export type MessageAction = "reply" | "reply-all" | "forward";

export type MessageCardProps = {
  message: MailMessage;
  threadId?: string;
  expanded?: boolean;
  onToggle?: () => void;
  images?: ReaderImagesInput;
  trackerBlocking?: boolean;
  /** Your addresses: they read "you" in the to-line. */
  selfAddresses?: ReadonlySet<string>;
  /** This message's account is offline (the pending body's copy). */
  offline?: boolean;
  /** Reply, reply all or forward this message; absent hides the buttons. */
  onAction?: (action: MessageAction, messageId: string) => void;
  /** "Always" on the tracker bar: remember this sender's images on this Mac. */
  onAlwaysImages?: (address: string) => void;
  /** HTML mail drawn on Moduo's dark surface (dark mode); the bar offers Original colours. */
  darkSurface?: boolean;
  /** The ⋯ menu's "Show original" asked for this message's raw source. */
  showOriginal?: boolean;
  /** Fetches the raw RFC 822 source. */
  loadOriginal?: (messageId: string) => Promise<string>;
  fileUrl?: (a: MailAttachment) => string | null;
  previewUrl?: (a: MailAttachment) => string | null;
  /** Fetches the attachment's file (preview and open). */
  onAttachment?: (a: MailAttachment) => void;
  invite?: ReactNode;
};

const senderName = (m: MailMessage) => m.from.name || m.from.email;

function useIframeHeight(ref: React.RefObject<HTMLIFrameElement | null>) {
  const [height, setHeight] = useState<number | null>(null);
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
  }, [ref]);
  return height;
}

function HtmlBody({
  message,
  images,
  trackerBlocking,
  darkSurface,
  onAlwaysImages,
}: Required<Pick<MessageCardProps, "message" | "images" | "trackerBlocking">> &
  Pick<MessageCardProps, "darkSurface" | "onAlwaysImages">) {
  const ref = useRef<HTMLIFrameElement>(null);
  const height = useIframeHeight(ref);
  const [loadOnce, setLoadOnce] = useState(false);
  const [original, setOriginal] = useState(false);
  const dark = !!darkSurface && !original;
  const doc = buildReaderDoc(
    message.id,
    message.html ?? "",
    { ...images, loadedForMessage: images.loadedForMessage || loadOnce },
    trackerBlocking,
    dark,
  );
  return (
    <div className="flex flex-col gap-2">
      <TrackerBar
        trackers={doc.trackers}
        imagesBlocked={doc.remoteBlocked}
        senderName={senderName(message)}
        onLoadImages={() => setLoadOnce(true)}
        onAlways={onAlwaysImages ? () => onAlwaysImages(message.from.email) : undefined}
        colours={darkSurface ? { original, onToggle: () => setOriginal((o) => !o) } : null}
      />
      {/* The one sanctioned non-token surface: foreign HTML, sandboxed with
          only the nonce-pinned height reporter; never add allow-same-origin.
          Height is runtime geometry, so the inline style is fine. */}
      <iframe
        ref={ref}
        title={`Message from ${senderName(message)}`}
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

function Original({
  messageId,
  loadOriginal,
}: {
  messageId: string;
  loadOriginal: (messageId: string) => Promise<string>;
}) {
  const [raw, setRaw] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The loader is rebuilt every render; fetch once per message.
  const load = useRef(loadOriginal);
  load.current = loadOriginal;
  useEffect(() => {
    let gone = false;
    load.current(messageId).then(
      (r) => !gone && setRaw(r),
      (e: unknown) => !gone && setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      gone = true;
    };
  }, [messageId]);
  if (error)
    return (
      <p role="alert" className="text-xs text-destructive">
        {error}
      </p>
    );
  if (raw === null) return null;
  return (
    <pre
      aria-label="Original message"
      className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md border border-hairline p-2 font-mono text-xs text-muted-foreground"
    >
      {raw}
    </pre>
  );
}

function SenderAvatar({ message, small }: { message: MailMessage; small?: boolean }) {
  return (
    <Avatar aria-hidden size={small ? "sm" : "default"}>
      <AvatarFallback>{initialsOf(senderName(message))}</AvatarFallback>
    </Avatar>
  );
}

function ToLine({ message, self }: { message: MailMessage; self: ReadonlySet<string> }) {
  const [addresses, setAddresses] = useState(false);
  const recipients = recipientsOf(message, self);
  return (
    <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
      <span className="min-w-0 truncate" data-to-line="">
        to {toLine(recipients, addresses)}
      </span>
      <span aria-hidden>·</span>
      <button
        type="button"
        className="min-h-6 shrink-0 rounded-sm outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
        aria-expanded={addresses}
        onClick={() => setAddresses((a) => !a)}
      >
        {addresses ? "Hide addresses" : "Show addresses"}
      </button>
    </div>
  );
}

const MESSAGE_ACTIONS: { action: MessageAction; label: string; icon: typeof Reply }[] = [
  { action: "reply", label: "Reply to this message", icon: Reply },
  { action: "reply-all", label: "Reply all to this message", icon: ReplyAll },
  { action: "forward", label: "Forward this message", icon: Forward },
];

function OpenHeader({
  message,
  self,
  date,
  onToggle,
  onAction,
}: {
  message: MailMessage;
  self: ReadonlySet<string>;
  date: string;
  onToggle?: () => void;
  onAction?: MessageCardProps["onAction"];
}) {
  return (
    <header className="flex items-start gap-2.5">
      <SenderAvatar message={message} />
      <div className="flex min-w-0 flex-1 flex-col">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded
          className="min-h-6 min-w-0 truncate text-left text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {senderName(message)}
          {message.from.name ? (
            <span className="ml-1.5 font-normal text-muted-foreground">{message.from.email}</span>
          ) : null}
        </button>
        <ToLine message={message} self={self} />
      </div>
      {onAction ? (
        <div
          className="flex shrink-0 items-center gap-0.5"
          role="group"
          aria-label="Message actions"
        >
          {MESSAGE_ACTIONS.map((a) => (
            <IconButton
              key={a.action}
              icon={a.icon}
              label={a.label}
              onClick={() => onAction(a.action, message.id)}
            />
          ))}
        </div>
      ) : null}
      <time className="shrink-0 pt-0.5 text-xs text-muted-foreground">{date}</time>
    </header>
  );
}

function ClosedHeader({
  message,
  date,
  onToggle,
}: {
  message: MailMessage;
  date: string;
  onToggle?: () => void;
}) {
  return (
    <header>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={false}
        className="flex w-full min-w-0 items-center gap-2 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <SenderAvatar message={message} small />
        <span className="shrink-0 font-medium text-foreground">{senderName(message)}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{message.snippet}</span>
        <time className="shrink-0 text-xs text-muted-foreground">{date}</time>
      </button>
    </header>
  );
}

function MessageBody(props: MessageCardProps & { images: ReaderImagesInput }) {
  const { message } = props;
  if (bodyIsPending(message)) return <BodyPending message={message} offline={!!props.offline} />;
  if (message.html)
    return (
      <HtmlBody
        message={message}
        images={props.images}
        trackerBlocking={props.trackerBlocking ?? true}
        darkSurface={props.darkSurface}
        onAlwaysImages={props.onAlwaysImages}
      />
    );
  return <TextBody text={message.text ?? message.snippet} quoteOffset={message.quoteOffset} />;
}

const NO_SELF: ReadonlySet<string> = new Set();

export function MessageCard(props: MessageCardProps) {
  const { message, threadId = "", expanded = true, onToggle, images = DEFAULT_IMAGES } = props;
  const date = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(message.dateMs);
  const pending = bodyIsPending(message);

  return (
    <article
      aria-label={`Message from ${senderName(message)}`}
      data-message-id={message.id}
      className="flex flex-col gap-3 border-b border-hairline px-4 py-3"
    >
      {expanded ? (
        <OpenHeader
          message={message}
          self={props.selfAddresses ?? NO_SELF}
          date={date}
          onToggle={onToggle}
          onAction={props.onAction}
        />
      ) : (
        <ClosedHeader message={message} date={date} onToggle={onToggle} />
      )}
      {expanded ? (
        <>
          {props.invite}
          <MessageBody {...props} images={images} />
          {pending ? null : (
            <AttachmentStrip
              attachments={message.attachments}
              threadId={threadId}
              messageId={message.id}
              fileUrl={props.fileUrl}
              previewUrl={props.previewUrl}
              onPreview={props.onAttachment}
            />
          )}
          {props.showOriginal && props.loadOriginal ? (
            <Original messageId={message.id} loadOriginal={props.loadOriginal} />
          ) : null}
        </>
      ) : null}
    </article>
  );
}
