/**
 * Publish-to-web header control (Wave-3 NO-9, AC10). The note header's "Publish"
 * affordance: a Globe button whose popover publishes/unpublishes and surfaces
 * the revocable public link. Published state reads primary; unpublished is a
 * quiet ghost. Tokens-only chrome.
 */

import { Check, Copy, Globe, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import type { Note } from "../model";
import { publishedChildCount } from "../publish";

type Props = {
  note: Note;
  notes: Note[];
  canEdit: boolean;
  /** Builds the public URL from a token (runtime.notesV2.publishedUrl). */
  publishedUrl: (token: string) => string;
  /** Returns the fresh token, or null on failure. */
  onPublish: () => Promise<string | null>;
  onUnpublish: () => Promise<void>;
};

export function NotePublishControl({
  note,
  notes,
  canEdit,
  publishedUrl,
  onPublish,
  onUnpublish,
}: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const isPublished = Boolean(note.publishedAt && note.publishToken);
  const url = note.publishToken ? publishedUrl(note.publishToken) : "";
  const childCount = isPublished ? publishedChildCount(note.id, notes) : 0;

  const doPublish = async () => {
    setBusy(true);
    const token = await onPublish();
    setBusy(false);
    if (token) toast("Published to the web.");
  };

  const doUnpublish = async () => {
    setBusy(true);
    await onUnpublish();
    setBusy(false);
    toast("Unpublished — the public link no longer works.");
  };

  const copy = async () => {
    if (!url) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy the link.");
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              size="sm"
              variant={isPublished ? "secondary" : "ghost"}
              className="gap-1.5"
              aria-label={isPublished ? "Published to web" : "Publish to web"}
            >
              <Globe
                className={
                  isPublished ? "size-icon-sm text-primary" : "size-icon-sm text-muted-foreground"
                }
                aria-hidden
              />
              <span className={isPublished ? "text-foreground" : "text-muted-foreground"}>
                {isPublished ? "Published" : "Publish"}
              </span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {isPublished ? "This note has a public link" : "Publish this note to the web"}
        </TooltipContent>
      </Tooltip>

      <PopoverContent align="end" className="w-80">
        {isPublished ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-foreground">Live on the web</p>
              <p className="text-xs text-muted-foreground">
                Anyone with the link can read this note
                {childCount > 0
                  ? ` and its ${childCount} nested page${childCount === 1 ? "" : "s"}`
                  : ""}
                . Search engines are asked not to index it.
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <input
                readOnly
                value={url}
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 rounded-md border border-border bg-muted px-2 py-1 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label="Public link"
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={copy}
                className="shrink-0 gap-1"
              >
                {copied ? (
                  <Check className="size-icon-sm text-success" aria-hidden />
                ) : (
                  <Copy className="size-icon-sm" aria-hidden />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <div className="flex items-center justify-between">
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-primary underline-offset-4 hover:underline"
              >
                Open public page
              </a>
              {canEdit ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={doUnpublish}
                  disabled={busy}
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                >
                  {busy ? (
                    <Loader2
                      className="size-icon-sm animate-spin motion-reduce:animate-none"
                      aria-hidden
                    />
                  ) : null}
                  Unpublish
                </Button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-foreground">Publish to web</p>
              <p className="text-xs text-muted-foreground">
                Create a read-only public link to this note
                {childCount > 0 ? " and its child pages" : ""}. You can revoke it any time.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={doPublish}
              disabled={busy || !canEdit}
              className="gap-1.5"
            >
              {busy ? (
                <Loader2
                  className="size-icon-sm animate-spin motion-reduce:animate-none"
                  aria-hidden
                />
              ) : (
                <Globe className="size-icon-sm" aria-hidden />
              )}
              Publish to web
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
