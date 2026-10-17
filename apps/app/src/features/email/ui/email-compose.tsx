// The compose surface (EM-7, AC10). A modal for new / reply / reply-all / forward:
// from-account picker, to / cc / bcc (with a Cc/Bcc reveal), subject, a bounded
// rich-text body (→ HTML + a derived plain-text alternative), and attachments via
// the native file picker. Send hands an EmailSendInput up to the 10s undo-send hold
// (useEmailCompose). Tokens-only; the body is a Lexical editor (spec assumption 13).

import { Paperclip, X } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { IconButton } from "../../../components/ui/icon-button";
import { Input } from "../../../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import type { EmailSendInput, ModuoRuntime } from "../../../lib/runtime.types";
import { stripEntityRefAttrs } from "../../spine/editor/entity-rich-html";
import {
  type ComposeAttachmentDraft,
  type ComposeDraft,
  type ComposeMode,
  htmlToPlainText,
  splitAddresses,
} from "../compose";
import type { SavedAccount } from "../model/email-types";
import { type ComposeEditorHandle, EmailComposeEditor } from "./email-compose-editor";

const MODE_TITLE: Record<ComposeMode, string> = {
  new: "New message",
  reply: "Reply",
  "reply-all": "Reply all",
  forward: "Forward",
};

function humanSize(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type Props = {
  draft: ComposeDraft;
  accounts: SavedAccount[];
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  onSend: (input: EmailSendInput, draftForUndo: ComposeDraft) => void;
  onClose: () => void;
};

export function EmailCompose({ draft, accounts, runtime, workspaceId, onSend, onClose }: Props) {
  const [accountId, setAccountId] = useState(draft.accountId || accounts[0]?.id || "");
  const [to, setTo] = useState(draft.to);
  const [cc, setCc] = useState(draft.cc);
  const [bcc, setBcc] = useState(draft.bcc);
  const [showCcBcc, setShowCcBcc] = useState(Boolean(draft.cc || draft.bcc));
  const [subject, setSubject] = useState(draft.subject);
  const [attachments, setAttachments] = useState<ComposeAttachmentDraft[]>(draft.attachments);
  const [toError, setToError] = useState(false);
  const editorRef = useRef<ComposeEditorHandle | null>(null);

  const attach = async () => {
    if (!runtime) return;
    try {
      const picked = await runtime.email.pickAttachments();
      if (picked.length) {
        setAttachments((prev) => [
          ...prev,
          ...picked.map((p) => ({
            path: p.path,
            filename: p.filename,
            mimeType: p.mimeType,
            size: p.size,
          })),
        ]);
      }
    } catch {
      /* cancelled / unavailable */
    }
  };

  const removeAttachment = (path: string) =>
    setAttachments((prev) => prev.filter((a) => a.path !== path));

  const submit = () => {
    const toList = splitAddresses(to);
    if (toList.length === 0) {
      setToError(true);
      return;
    }
    const content = editorRef.current?.getContent();
    // Flatten entity-ref chips to plain `<span>Label</span>` before sending — the
    // recipient reads the label; Moduo's internal entity ids never leave (DF-23).
    const bodyHtml = stripEntityRefAttrs(content?.html ?? draft.bodyHtml);
    const textBody = content?.text ?? htmlToPlainText(bodyHtml);
    const input: EmailSendInput = {
      accountId,
      to: toList,
      cc: splitAddresses(cc),
      bcc: splitAddresses(bcc),
      subject,
      htmlBody: bodyHtml,
      textBody,
      inReplyTo: draft.inReplyTo,
      references: draft.references,
      attachments: attachments.map((a) => ({
        filename: a.filename,
        mimeType: a.mimeType,
        path: a.path,
      })),
      fromName: null,
    };
    const restored: ComposeDraft = {
      ...draft,
      accountId,
      to,
      cc,
      bcc,
      subject,
      bodyHtml,
      attachments,
    };
    onSend(input, restored);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex max-h-[85vh] w-[42rem] max-w-[92vw] flex-col gap-3">
        <DialogHeader>
          <DialogTitle>{MODE_TITLE[draft.mode]}</DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {/* From */}
          {accounts.length > 1 ? (
            <div className="flex items-center gap-2">
              <span className="w-14 shrink-0 text-xs text-muted-foreground">From</span>
              <Select value={accountId} onValueChange={setAccountId}>
                <SelectTrigger className="h-9 flex-1">
                  <SelectValue placeholder="Account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {/* To */}
          <div className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-xs text-muted-foreground">To</span>
            <Input
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setToError(false);
              }}
              placeholder="name@example.com"
              className="h-9 flex-1"
              aria-invalid={toError || undefined}
            />
            {!showCcBcc ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => setShowCcBcc(true)}
              >
                Cc/Bcc
              </Button>
            ) : null}
          </div>

          {showCcBcc ? (
            <>
              <div className="flex items-center gap-2">
                <span className="w-14 shrink-0 text-xs text-muted-foreground">Cc</span>
                <Input value={cc} onChange={(e) => setCc(e.target.value)} className="h-9 flex-1" />
              </div>
              <div className="flex items-center gap-2">
                <span className="w-14 shrink-0 text-xs text-muted-foreground">Bcc</span>
                <Input
                  value={bcc}
                  onChange={(e) => setBcc(e.target.value)}
                  className="h-9 flex-1"
                />
              </div>
            </>
          ) : null}

          {/* Subject */}
          <div className="flex items-center gap-2">
            <span className="w-14 shrink-0 text-xs text-muted-foreground">Subject</span>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="h-9 flex-1"
            />
          </div>

          {/* Body — Lexical rich text (spec assumption 13): bounded toolbar → HTML
              + derived plain text, seeded from the draft (signature + quoted). */}
          <EmailComposeEditor
            initialHtml={draft.bodyHtml}
            handleRef={editorRef}
            runtime={runtime}
            workspaceId={workspaceId}
          />

          {/* Attachments */}
          {attachments.length > 0 ? (
            <div className="flex flex-col gap-1">
              {attachments.map((a) => (
                <div
                  key={a.path}
                  className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5"
                >
                  <Paperclip className="size-icon-xs shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-xs text-foreground">
                    {a.filename}
                  </span>
                  {a.size ? (
                    <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
                      {humanSize(a.size)}
                    </span>
                  ) : null}
                  <IconButton
                    icon={X}
                    label={`Remove ${a.filename}`}
                    size="sm"
                    onClick={() => removeAttachment(a.path)}
                  />
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-2 sm:justify-between">
          <Button type="button" variant="ghost" size="sm" onClick={attach}>
            <Paperclip aria-hidden />
            Attach
          </Button>
          <div className="flex items-center gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Discard
            </Button>
            <Button type="button" onClick={submit}>
              Send
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
