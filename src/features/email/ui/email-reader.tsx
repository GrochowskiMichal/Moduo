// The reader — a right-panel switcher variant (EM-4, DESIGN_BRIEF §3). Renders the
// selected thread's message stack (oldest→newest from getThread), NEWEST expanded,
// older collapsed to a sender+snippet row that expands on click. Each expanded
// message: sender chip, recipients line, detail time, and the HTML body in a
// sandboxed iframe via buildEmailSrcDoc (bodies lazy-fetched with getBody; remote
// images load by default — that is buildEmailSrcDoc's behavior). No thread → a
// quiet "Select a conversation" empty state. The iframe is the ONE sanctioned
// non-token surface (foreign HTML), sandboxed.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Download,
  Forward,
  ListChecks,
  Mail,
  Paperclip,
  Reply,
  ReplyAll,
} from "lucide-react";

import { Avatar, AvatarFallback } from "../../../components/ui/avatar";
import { Button } from "../../../components/ui/button";
import { EmptyState } from "../../../components/ui/empty-state";
import type { EmailAttachmentMeta, EmailInlineImage } from "../../../lib/runtime.types";
import type { ComposeMode } from "../compose";
import { formatEmailDetailDate } from "../utils/email-format";
import { buildEmailSrcDoc } from "../utils/email-html";
import type { EmailEnvelope, EmailThread } from "../model/email-types";

type BodyState = {
  status: "idle" | "loading" | "ready" | "error";
  body?: string;
  bodyHtml?: string | null;
  error?: string;
};

type Props = {
  thread: EmailThread | null;
  getThread: (accountId: string, threadId: string) => Promise<EmailEnvelope[]>;
  getBody: (
    accountId: string,
    folder: string,
    uid: number,
  ) => Promise<{ body: string; bodyHtml: string | null } | null>;
  /** Start a reply/forward off the current thread (EM-7). Absent on web. */
  onReply?: (mode: ComposeMode) => void;
  /** Convert the thread to a task (EM-8, the great moment). */
  onConvert?: () => void;
  /** List a message's attachments (EM-7/AC4). Absent on web. */
  listAttachments?: (
    accountId: string,
    folder: string,
    uid: number,
  ) => Promise<EmailAttachmentMeta[]>;
  /** Decode + save one attachment to disk via a native dialog (EM-7/AC4). */
  saveAttachment?: (
    accountId: string,
    folder: string,
    uid: number,
    attachmentId: string,
    defaultFilename: string,
  ) => Promise<{ saved: boolean; path: string | null }>;
  /** Small inline cid images (<2MB) to substitute into the body HTML (EM-7/AC4). */
  getInlineImages?: (
    accountId: string,
    folder: string,
    uid: number,
  ) => Promise<EmailInlineImage[]>;
};

function humanSize(bytes: number): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Replace `cid:<id>` refs in the body HTML with inline data URIs. */
function substituteCidImages(html: string, images: EmailInlineImage[]): string {
  let out = html;
  for (const img of images) {
    const dataUri = `data:${img.mime};base64,${img.dataBase64}`;
    out = out.split(`cid:${img.contentId}`).join(dataUri);
  }
  return out;
}

function initials(name: string, email: string): string {
  const src = name.trim() || email.trim();
  if (!src) return "?";
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

/** One message in the stack. Owns its own body fetch + expand toggle. */
function MessageCard({
  message,
  defaultExpanded,
  getBody,
  listAttachments,
  saveAttachment,
  getInlineImages,
}: {
  message: EmailEnvelope;
  defaultExpanded: boolean;
  getBody: Props["getBody"];
  listAttachments?: Props["listAttachments"];
  saveAttachment?: Props["saveAttachment"];
  getInlineImages?: Props["getInlineImages"];
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [body, setBody] = useState<BodyState>({ status: "idle" });
  const [attachments, setAttachments] = useState<EmailAttachmentMeta[]>([]);
  const [inlineImages, setInlineImages] = useState<EmailInlineImage[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);

  // Fetch attachment metadata once the message is expanded (bytes stay on the
  // server until a save). Inline cid parts are excluded from the chip row.
  useEffect(() => {
    if (!expanded || !listAttachments) return;
    let active = true;
    void (async () => {
      try {
        const list = await listAttachments(message.accountId, message.folder, message.uid);
        if (active) setAttachments(list.filter((a) => !a.isInline));
      } catch {
        /* attachments are best-effort */
      }
    })();
    return () => {
      active = false;
    };
  }, [expanded, listAttachments, message.accountId, message.folder, message.uid]);

  const onSave = async (att: EmailAttachmentMeta) => {
    if (!saveAttachment) return;
    setSavingId(att.id);
    try {
      await saveAttachment(message.accountId, message.folder, message.uid, att.id, att.filename);
    } catch {
      /* cancelled / failed — no-op */
    } finally {
      setSavingId(null);
    }
  };

  useEffect(() => {
    if (!expanded || body.status !== "idle") return;
    let active = true;
    setBody({ status: "loading" });
    void (async () => {
      try {
        const res = await getBody(message.accountId, message.folder, message.uid);
        if (!active) return;
        setBody({
          status: "ready",
          body: res?.body ?? "",
          bodyHtml: res?.bodyHtml ?? null,
        });
      } catch (e) {
        if (active) {
          setBody({ status: "error", error: e instanceof Error ? e.message : "Load failed" });
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [expanded, body.status, getBody, message.accountId, message.folder, message.uid]);

  // Fetch inline cid images only when the body actually references one.
  useEffect(() => {
    if (!getInlineImages) return;
    if (body.status !== "ready" || !body.bodyHtml || !body.bodyHtml.includes("cid:")) return;
    let active = true;
    void getInlineImages(message.accountId, message.folder, message.uid)
      .then((imgs) => {
        if (active) setInlineImages(imgs);
      })
      .catch(() => {
        /* inline images are best-effort */
      });
    return () => {
      active = false;
    };
  }, [getInlineImages, body.status, body.bodyHtml, message.accountId, message.folder, message.uid]);

  const srcDoc = useMemo(() => {
    if (body.status !== "ready" || !body.bodyHtml || body.bodyHtml.trim().length === 0) {
      return null;
    }
    const html = inlineImages.length
      ? substituteCidImages(body.bodyHtml, inlineImages)
      : body.bodyHtml;
    return buildEmailSrcDoc(html);
  }, [body, inlineImages]);

  return (
    <div className="rounded-lg border border-border bg-card">
      {/* Header — always visible; the toggle for collapsed messages. */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent"
      >
        <Avatar size="sm" className="mt-0.5">
          <AvatarFallback>{initials(message.sender, message.senderEmail)}</AvatarFallback>
        </Avatar>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-baseline gap-2">
            <span
              className={
                "min-w-0 flex-1 truncate text-sm " +
                (message.read ? "text-foreground" : "font-medium text-foreground")
              }
            >
              {message.sender || message.senderEmail || "Unknown sender"}
            </span>
            <time
              className="shrink-0 text-2xs tabular-nums text-muted-foreground"
              dateTime={message.date}
            >
              {formatEmailDetailDate(message.date)}
            </time>
          </div>
          {expanded ? (
            <span className="truncate text-xs text-muted-foreground">
              To: {message.to?.trim() || "—"}
            </span>
          ) : (
            <span className="truncate text-xs text-muted-foreground">{message.preview}</span>
          )}
        </div>
        <ChevronDown
          className={
            "mt-1 size-icon-sm shrink-0 text-muted-foreground transition-transform " +
            (expanded ? "rotate-180" : "")
          }
          aria-hidden
        />
      </button>

      {/* Body — only when expanded. */}
      {expanded ? (
        <div className="border-t border-border px-3 py-3">
          {attachments.length > 0 ? (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {attachments.map((att) => (
                <button
                  key={att.id}
                  type="button"
                  disabled={savingId === att.id}
                  onClick={() => void onSave(att)}
                  title={`Save ${att.filename}`}
                  className="group flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs text-foreground transition-colors hover:bg-accent disabled:opacity-60"
                >
                  <Paperclip className="size-icon-xs shrink-0 text-muted-foreground" aria-hidden />
                  <span className="max-w-48 truncate">{att.filename}</span>
                  {att.size ? (
                    <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
                      {humanSize(att.size)}
                    </span>
                  ) : null}
                  <Download
                    className="size-icon-xs shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                    aria-hidden
                  />
                </button>
              ))}
            </div>
          ) : null}
          {body.status === "loading" || body.status === "idle" ? (
            <div className="flex flex-col gap-2" aria-busy="true">
              <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
              <div className="h-3 w-full animate-pulse rounded bg-muted" />
              <div className="h-3 w-5/6 animate-pulse rounded bg-muted" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
            </div>
          ) : body.status === "error" ? (
            <p className="text-xs text-destructive" role="alert">
              Couldn&rsquo;t load this message. {body.error}
            </p>
          ) : srcDoc ? (
            // The one sanctioned non-token surface: foreign HTML, sandboxed.
            <div className="overflow-hidden rounded-md border border-border">
              <iframe
                title={`Message from ${message.sender || message.senderEmail}`}
                sandbox=""
                srcDoc={srcDoc}
                className="h-[60vh] w-full"
              />
            </div>
          ) : (
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {body.body?.trim() ? body.body : "No message content."}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export function EmailReader({
  thread,
  getThread,
  getBody,
  onReply,
  onConvert,
  listAttachments,
  saveAttachment,
  getInlineImages,
}: Props) {
  const [messages, setMessages] = useState<EmailEnvelope[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const reqRef = useRef(0);

  useEffect(() => {
    if (!thread) {
      setMessages([]);
      setStatus("idle");
      return;
    }
    const req = ++reqRef.current;
    setStatus("loading");
    setError(null);
    void (async () => {
      try {
        const msgs = await getThread(thread.accountId, thread.threadId);
        if (reqRef.current !== req) return;
        setMessages(msgs);
        setStatus("ready");
      } catch (e) {
        if (reqRef.current !== req) return;
        setError(e instanceof Error ? e.message : "Couldn't load this conversation.");
        setStatus("error");
      }
    })();
  }, [thread, getThread]);

  if (!thread) {
    return (
      <EmptyState
        icon={Mail}
        title="Select a conversation"
        description="Pick a thread to read it here."
      />
    );
  }

  const lastIndex = messages.length - 1;

  return (
    <div className="scrollbar-thin flex h-full min-h-0 flex-col gap-3 overflow-y-auto">
      <div className="flex shrink-0 items-start justify-between gap-2">
        <h2 className="min-w-0 flex-1 text-sm font-medium text-foreground">{thread.subject}</h2>
        {onReply ? (
          <div className="flex shrink-0 items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => onReply("reply")}>
              <Reply aria-hidden />
              Reply
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onReply("reply-all")}>
              <ReplyAll aria-hidden />
              All
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onReply("forward")}>
              <Forward aria-hidden />
              Forward
            </Button>
            {onConvert ? (
              <Button variant="ghost" size="sm" onClick={onConvert}>
                <ListChecks aria-hidden />
                To task
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {status === "loading" ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <div className="h-16 animate-pulse rounded-lg bg-muted" />
          <div className="h-40 animate-pulse rounded-lg bg-muted" />
        </div>
      ) : status === "error" ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : messages.length === 0 ? (
        <p className="text-sm text-muted-foreground">This conversation has no messages.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {messages.map((message, i) => (
            <MessageCard
              key={`${message.accountId}::${message.uid}::${message.folder}`}
              message={message}
              defaultExpanded={i === lastIndex}
              getBody={getBody}
              listAttachments={listAttachments}
              saveAttachment={saveAttachment}
              getInlineImages={getInlineImages}
            />
          ))}
        </div>
      )}
    </div>
  );
}
