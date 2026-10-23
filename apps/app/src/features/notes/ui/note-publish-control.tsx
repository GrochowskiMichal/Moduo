/**
 * Publish to web (Wave-3 NO-9, AC10): the popover that publishes/unpublishes a
 * note and surfaces its revocable public link. A row's `⋯ → Publish…` opens it
 * on the row; a published note's meta line carries a quiet "Public" chip that
 * opens it in place, so a public note never looks like a private one.
 * Before publishing it names the sub-pages the link would take with it.
 */

import { Check, Copy, Globe, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "../../../components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "../../../components/ui/popover";
import { cn } from "../../../lib/utils";
import type { Note } from "../model";
import { selectPublishCandidates, selectPublishSubtree } from "../publish";
import { META_CHIP } from "../shell/note-meta-line";
import { displayTitle } from "../title";

type Props = {
  note: Note;
  notes: Note[];
  canEdit: boolean;
  /** Builds the public URL from a token (runtime.notesV2.publishedUrl). */
  publishedUrl: (token: string) => string;
  /** Returns the fresh token, or null on failure. */
  onPublish: () => Promise<string | null>;
  onUnpublish: () => Promise<void>;
  /** Controlled popover (the refreshed shell opens it from a `⋯ → Publish…`). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** `parent`: opened from a row's menu, anchored to the row. `chip`: the
   * meta line's "Public" chip opens it. */
  anchor?: "chip" | "parent";
};

/** Names this many sub-pages, then "and N more". */
const NAMED_PAGES = 3;

/** "Launch checklist, Feedback loop and 2 more" */
export function namePages(pages: Note[]): string {
  const names = pages.slice(0, NAMED_PAGES).map((n) => displayTitle(n.title));
  const rest = pages.length - names.length;
  if (rest > 0) return `${names.join(", ")} and ${rest} more`;
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function NotePublishControl({
  note,
  notes,
  canEdit,
  publishedUrl,
  onPublish,
  onUnpublish,
  open: openProp,
  onOpenChange,
  anchor = "chip",
}: Props) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
  };
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const isPublished = Boolean(note.publishedAt && note.publishToken);
  const url = note.publishToken ? publishedUrl(note.publishToken) : "";
  // The root comes first in both lists; the rest are the sub-pages.
  const subpages = (
    isPublished ? selectPublishSubtree(note.id, notes) : selectPublishCandidates(note.id, notes)
  ).slice(1);
  const childCount = subpages.length;

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
      {anchor === "parent" ? (
        <PopoverAnchor asChild>
          <span aria-hidden className="pointer-events-none absolute inset-0" />
        </PopoverAnchor>
      ) : (
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Public on the web: show the link"
            className={cn(META_CHIP, "flex items-center gap-1")}
          >
            <Globe aria-hidden className="size-icon-xs" />
            Public
          </button>
        </PopoverTrigger>
      )}

      <PopoverContent align={anchor === "chip" ? "start" : "end"} className="w-80">
        {isPublished ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-foreground">Live on the web</p>
              <p className="text-xs text-muted-foreground">
                Anyone with the link can read this note
                {childCount > 0
                  ? ` and its ${childCount === 1 ? "subpage" : `${childCount} subpages`} (${namePages(subpages)})`
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
                Create a read-only public link to this note. You can revoke it any time.
              </p>
              {childCount > 0 ? (
                <p className="text-xs text-foreground">
                  {childCount === 1 ? "Its subpage goes" : `Its ${childCount} subpages go`} public
                  with it: {namePages(subpages)}.
                </p>
              ) : null}
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
