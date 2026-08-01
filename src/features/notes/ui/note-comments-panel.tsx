/**
 * Notes right panel — Comments variant (NO-7, AC9): a note-level comment thread
 * with quote-comments and people @mentions.
 *
 * Quote-comments need no schema change — the quoted snippet rides in the comment
 * body as a leading markdown blockquote (see `comments/quote.ts`); clicking a
 * rendered quote asks the page to scroll the editor to it (best-effort; edited-
 * away text degrades to quote-only). @mentions notify via `addComment`'s
 * `mentionedUserIds`. View-only members may comment (spec edge case).
 */

import { AtSign, Quote as QuoteIcon, Send, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { useMentionSearch } from "@/features/spine/hooks/use-mention-search";
import type { MentionPersonCandidate } from "@/features/spine/mention";
import type { ModuoRuntime, SpineComment } from "@/lib/runtime.types";
import { formatQuoteComment, parseQuoteComment } from "../comments/quote";

type Props = {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  noteId: string;
  noteLabel: string;
  /** Any member with notes access may comment (view-only included, per spec). */
  canComment: boolean;
  currentUserId: string | null;
  /** Capture the editor's current text selection as a quote (page-provided). */
  getSelectionQuote: () => string | null;
  /** Scroll the editor to a quoted snippet; no-op if edited away (page). */
  onScrollToQuote: (quote: string) => void;
};

/** Is `@label` still present in the text at a word boundary? Boundary-matched
 * so mentioning "@Anna" doesn't also notify a bystander "Ann" (validator M1). */
function mentionStillPresent(text: string, label: string): boolean {
  const needle = `@${label}`;
  let from = 0;
  for (;;) {
    const i = text.indexOf(needle, from);
    if (i < 0) return false;
    const after = text[i + needle.length];
    if (after === undefined || !/\w/.test(after)) return true;
    from = i + 1;
  }
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function MentionPicker({
  runtime,
  workspaceId,
  currentUserId,
  open,
  onOpenChange,
  onPick,
}: {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  currentUserId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onPick: (id: string, label: string) => void;
}) {
  const { query, setQuery, candidates, loading } = useMentionSearch({
    runtime,
    workspaceId,
    trigger: "mention",
    currentUserId,
    includePeople: true,
    includeEntities: false,
    enabled: open,
  });
  const people = candidates.filter((c): c is MentionPersonCandidate => c.kind === "person");
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <IconButton icon={AtSign} label="Mention someone" size="sm" variant="ghost" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-1">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
          placeholder="Mention…"
          aria-label="Search people"
          className="mb-1 w-full rounded-md bg-muted px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <div className="max-h-56 overflow-y-auto scrollbar-thin">
          {loading ? (
            <p className="px-2 py-2 text-xs text-muted-foreground">Searching…</p>
          ) : people.length === 0 ? (
            <p className="px-2 py-2 text-xs text-muted-foreground">No people.</p>
          ) : (
            people.map((p) => (
              <button
                key={p.memberId}
                type="button"
                onClick={() => onPick(p.memberId, p.label)}
                className="block w-full truncate rounded-md px-2 py-1.5 text-left text-sm text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {p.label}
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function NoteCommentsPanel({
  runtime,
  workspaceId,
  noteId,
  noteLabel,
  canComment,
  currentUserId,
  getSelectionQuote,
  onScrollToQuote,
}: Props) {
  const [comments, setComments] = useState<SpineComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [quote, setQuote] = useState<string | null>(null);
  const [mentions, setMentions] = useState<{ id: string; label: string }[]>([]);
  const [posting, setPosting] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const load = useCallback(() => {
    if (!runtime || !workspaceId) {
      setComments([]);
      setLoading(false);
      return undefined;
    }
    let active = true;
    setLoading(true);
    void runtime.spine
      .listComments({ workspaceId, entityType: "note", entityId: noteId })
      .then((rows) => {
        if (active) {
          setComments(rows);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setComments([]);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [runtime, workspaceId, noteId]);

  useEffect(() => {
    setText("");
    setQuote(null);
    setMentions([]);
    return load();
  }, [load]);

  const grabQuote = () => {
    const sel = getSelectionQuote();
    if (sel && sel.trim()) setQuote(sel.trim());
    else toast.info("Select text in the note first, then quote it.");
  };

  const addMention = (id: string, label: string) => {
    setMentions((prev) => (prev.some((m) => m.id === id) ? prev : [...prev, { id, label }]));
    setText((t) => `${t}${t && !t.endsWith(" ") ? " " : ""}@${label} `);
    setPickerOpen(false);
  };

  const post = async () => {
    if (!runtime || !workspaceId) return;
    const body = formatQuoteComment(quote, text);
    if (!body.trim()) return;
    setPosting(true);
    try {
      // Only notify people still referenced in the final text (@name kept),
      // matched at a word boundary (validator M1).
      const kept = mentions.filter((m) => mentionStillPresent(text, m.label)).map((m) => m.id);
      await runtime.spine.addComment({
        workspaceId,
        entityType: "note",
        entityId: noteId,
        body,
        mentionedUserIds: kept,
        entityLabel: noteLabel || "Untitled",
        entityIcon: "note",
      });
      setText("");
      setQuote(null);
      setMentions([]);
      load();
    } catch (e) {
      toast.error("Couldn’t post the comment", {
        description: e instanceof Error ? e.message : undefined,
      });
    } finally {
      setPosting(false);
    }
  };

  const canPost = !posting && formatQuoteComment(quote, text).trim().length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto scrollbar-thin pb-3">
        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : comments.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No comments yet.</p>
        ) : (
          comments.map((c) => {
            const parsed = parseQuoteComment(c.body);
            const mine = c.createdBy && c.createdBy === currentUserId;
            return (
              <div key={c.id} className="rounded-lg border border-border bg-card px-3 py-2">
                {parsed.quote ? (
                  <button
                    type="button"
                    onClick={() => onScrollToQuote(parsed.quote!)}
                    className="mb-1.5 flex w-full gap-1.5 rounded-md border-l-2 border-border bg-muted/50 px-2 py-1 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    title="Jump to the quoted text"
                  >
                    <QuoteIcon className="mt-0.5 size-3 shrink-0" aria-hidden />
                    <span className="line-clamp-3">{parsed.quote}</span>
                  </button>
                ) : null}
                <p className="whitespace-pre-wrap break-words text-sm text-foreground">
                  {parsed.text}
                </p>
                <p className="mt-1 text-2xs text-muted-foreground">
                  {mine ? "You" : "Teammate"} · {relativeTime(c.createdAt)}
                </p>
              </div>
            );
          })
        )}
      </div>

      {canComment ? (
        <div className="shrink-0 space-y-1.5 border-t border-border pt-2">
          {quote ? (
            <div className="flex items-start gap-1.5 rounded-md border-l-2 border-primary/40 bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
              <QuoteIcon className="mt-0.5 size-3 shrink-0" aria-hidden />
              <span className="line-clamp-2 min-w-0 flex-1">{quote}</span>
              <IconButton
                icon={X}
                label="Remove quote"
                size="sm"
                variant="ghost"
                className="-my-1 shrink-0"
                onClick={() => setQuote(null)}
              />
            </div>
          ) : null}
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Add a comment…"
            rows={2}
            className="resize-none"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                void post();
              }
            }}
          />
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex items-center gap-0.5">
              <IconButton
                icon={QuoteIcon}
                label="Quote selected text"
                size="sm"
                variant="ghost"
                // Keep the editor's selection alive when this panel button is
                // pressed (don't steal focus before we read it) — validator M2.
                onMouseDown={(e) => e.preventDefault()}
                onClick={grabQuote}
              />
              <MentionPicker
                runtime={runtime}
                workspaceId={workspaceId}
                currentUserId={currentUserId}
                open={pickerOpen}
                onOpenChange={setPickerOpen}
                onPick={addMention}
              />
            </div>
            <Button size="sm" className="gap-1.5" disabled={!canPost} onClick={() => void post()}>
              <Send className="size-icon-sm" aria-hidden />
              Comment
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
