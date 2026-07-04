// The reader — a right-panel switcher variant (EM-4, DESIGN_BRIEF §3). Renders the
// selected thread's message stack (oldest→newest from getThread), NEWEST expanded,
// older collapsed to a sender+snippet row that expands on click. Each expanded
// message: sender chip, recipients line, detail time, and the HTML body in a
// sandboxed iframe via buildEmailSrcDoc (bodies lazy-fetched with getBody; remote
// images load by default — that is buildEmailSrcDoc's behavior). No thread → a
// quiet "Select a conversation" empty state. The iframe is the ONE sanctioned
// non-token surface (foreign HTML), sandboxed.

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Mail } from "lucide-react";

import { Avatar, AvatarFallback } from "../../../components/ui/avatar";
import { EmptyState } from "../../../components/ui/empty-state";
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
};

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
}: {
  message: EmailEnvelope;
  defaultExpanded: boolean;
  getBody: Props["getBody"];
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [body, setBody] = useState<BodyState>({ status: "idle" });

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

  const srcDoc = useMemo(
    () =>
      body.status === "ready" && body.bodyHtml && body.bodyHtml.trim().length > 0
        ? buildEmailSrcDoc(body.bodyHtml)
        : null,
    [body],
  );

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

export function EmailReader({ thread, getThread, getBody }: Props) {
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
      <h2 className="shrink-0 text-sm font-medium text-foreground">{thread.subject}</h2>

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
            />
          ))}
        </div>
      )}
    </div>
  );
}
