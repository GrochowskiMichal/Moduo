/**
 * Notes right panel — Comments variant (NO-7, AC9): a note-level comment thread
 * with quote-comments and people @mentions, on the spine's shared comment
 * pieces (`spine/ui/comments-panel.tsx`, tasks-v2 decision 12).
 *
 * Quote-comments need no schema change — the quoted snippet rides in the comment
 * body as a leading markdown blockquote (see `comments/quote.ts`); clicking a
 * rendered quote asks the page to scroll the editor to it (best-effort; edited-
 * away text degrades to quote-only). @mentions notify via `addComment`'s
 * `mentionedUserIds`. View-only members may comment (spec edge case).
 */

import { Quote as QuoteIcon, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { IconButton } from "@/components/ui/icon-button";
import { commentAuthorName, relativeTime } from "@/features/spine/comments";
import { useCommentPeople } from "@/features/spine/hooks/use-comment-people";
import { useCommentThread } from "@/features/spine/hooks/use-comment-thread";
import { CommentBody, CommentCard, CommentComposer } from "@/features/spine/ui/comments-panel";
import type { ModuoRuntime } from "@/lib/runtime.types";
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
  const thread = useCommentThread({
    runtime,
    workspaceId,
    entityType: "note",
    entityId: noteId,
    entityLabel: noteLabel,
    entityIcon: "note",
  });
  const people = useCommentPeople();
  const [quote, setQuote] = useState<string | null>(null);
  const selfName = currentUserId ? people.nameOf(currentUserId) : null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: a quote belongs to the note it was taken from
  useEffect(() => setQuote(null), [noteId]);

  const grabQuote = () => {
    const sel = getSelectionQuote();
    if (sel?.trim()) setQuote(sel.trim());
    else toast.info("Select text in the note first, then quote it.");
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="pane-scroll min-h-0 flex-1 space-y-3 overflow-y-auto pb-3">
        {thread.loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : thread.comments.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No comments yet.</p>
        ) : (
          thread.comments.map((c) => {
            const parsed = parseQuoteComment(c.body);
            return (
              <CommentCard
                key={c.id}
                author={
                  c.authorKind === "api_key" || !c.createdBy ? null : people.personOf(c.createdBy)
                }
                authorName={commentAuthorName(c, currentUserId, people.nameOf)}
                time={relativeTime(c.createdAt)}
                timeTitle={new Date(c.createdAt).toLocaleString()}
              >
                {parsed.quote ? (
                  <button
                    type="button"
                    onClick={() => onScrollToQuote(parsed.quote!)}
                    className="mb-1.5 flex w-full gap-1.5 rounded-md border-l-2 border-border bg-muted/50 px-2 py-1 text-left text-xs text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    title="Jump to the quoted text"
                  >
                    <QuoteIcon className="mt-0.5 size-3 shrink-0" aria-hidden />
                    <span className="line-clamp-3">{parsed.quote}</span>
                  </button>
                ) : null}
                {parsed.text ? (
                  <CommentBody text={parsed.text} mentionNames={people.names} selfName={selfName} />
                ) : null}
              </CommentCard>
            );
          })
        )}
      </div>

      {canComment ? (
        <div className="shrink-0 pt-2">
          <CommentComposer
            people={people.mentionable}
            placeholder="Add a comment…  @ to mention"
            prepareBody={(text) => formatQuoteComment(quote, text)}
            leading={
              quote ? (
                <div className="flex items-start gap-1.5 rounded-md border-l-2 border-primary/40 bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
                  <QuoteIcon className="mt-0.5 size-3 shrink-0" aria-hidden />
                  <span className="line-clamp-2 min-w-0 flex-1">{quote}</span>
                  <IconButton
                    icon={X}
                    label="Remove quote"
                    className="-my-1 shrink-0"
                    onClick={() => setQuote(null)}
                  />
                </div>
              ) : null
            }
            tools={
              <IconButton
                icon={QuoteIcon}
                label="Quote selected text"
                // Keep the editor's selection alive when this panel button is
                // pressed (don't steal focus before we read it) — validator M2.
                onMouseDown={(e) => e.preventDefault()}
                onClick={grabQuote}
              />
            }
            onSubmit={async (body, mentionedUserIds) => {
              await thread.post({ body, mentionedUserIds });
              setQuote(null);
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
