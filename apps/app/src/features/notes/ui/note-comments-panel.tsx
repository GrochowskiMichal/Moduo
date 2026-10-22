/**
 * Notes right panel — Comments (NO-7, rebuilt for NR-8 anchored threads).
 *
 * Threads anchored to text are listed in document order; each shows the text
 * it is anchored to, its comments, a reply box and Resolve (which clears the
 * highlight). A thread whose text was deleted moves to "Detached" and stays
 * readable. Resolved threads fold away under "Resolved". The note-level
 * thread stays at the end for general remarks: every older comment, quote-
 * comments included, shows there unchanged (quotes ride in the body, see
 * `comments/quote.ts`). @mentions notify via `addComment` in every thread.
 * View-only members may comment and reply (spec edge case); anchoring new text
 * needs edit access, since the highlight lives in the document.
 */

import { Check, ChevronRight, Quote as QuoteIcon, X } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { IconButton } from "@/components/ui/icon-button";
import { commentAuthorName, relativeTime } from "@/features/spine/comments";
import { useCommentPeople } from "@/features/spine/hooks/use-comment-people";
import { useCommentThread } from "@/features/spine/hooks/use-comment-thread";
import { WithCommentReactions } from "@/features/spine/ui/comment-reactions";
import { CommentBody, CommentCard, CommentComposer } from "@/features/spine/ui/comments-panel";
import type { ModuoRuntime, SpineComment } from "@/lib/runtime.types";

import { anchorStore, useNoteAnchors } from "../comments/anchor-store";
import { type CommentThreadGroup, groupThreads } from "../comments/anchors";
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
    currentUserId,
  });
  const people = useCommentPeople();
  const anchors = useNoteAnchors(noteId);
  const [quote, setQuote] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const selfName = currentUserId ? people.nameOf(currentUserId) : null;

  const groups = useMemo(
    () => groupThreads(thread.comments, anchors.docOrder),
    [thread.comments, anchors.docOrder],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: a quote belongs to the note it was taken from
  useEffect(() => setQuote(null), [noteId]);

  // Tell the editor which threads are open, so only their marks highlight.
  useEffect(() => {
    if (thread.loading) return;
    const open = new Set([...groups.open, ...groups.detached].map((g) => g.anchorId));
    anchorStore.setOpenThreads(noteId, open);
  }, [noteId, thread.loading, groups]);

  // A thread anchored but never posted to: take its mark back out when the
  // panel goes away (switching views, notes, or closing).
  useEffect(
    () => () => {
      const { pending } = anchorStore.get(noteId);
      if (!pending) return;
      anchorStore.actions(noteId)?.unanchor(pending);
      anchorStore.setPending(noteId, null);
    },
    [noteId],
  );

  const grabQuote = () => {
    const sel = getSelectionQuote();
    if (sel?.trim()) setQuote(sel.trim());
    else toast.info("Select text in the note first, then quote it.");
  };

  const focusThread = (anchorId: string) => {
    anchorStore.focus(noteId, anchorId);
    anchorStore.actions(noteId)?.scrollTo(anchorId);
  };

  const resolve = async (anchorId: string) => {
    if (!runtime?.spine.resolveCommentThread || !workspaceId) return;
    try {
      await runtime.spine.resolveCommentThread({
        workspaceId,
        noteId,
        anchorId,
        resolved: true,
      });
      anchorStore.actions(noteId)?.unanchor(anchorId);
      if (anchorStore.get(noteId).focused === anchorId) anchorStore.focus(noteId, null);
      thread.reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't resolve the thread.");
    }
  };

  const renderComment = (c: SpineComment) => {
    const parsed = parseQuoteComment(c.body);
    return (
      // CV-7c: the same reactions as task comments and chat (CH49).
      <WithCommentReactions
        key={c.id}
        comment={c}
        thread={thread}
        currentUserId={currentUserId}
        nameOf={people.nameOf}
        canReact={canComment}
      >
        {(reactions) => (
          <CommentCard
            actions={reactions.button}
            footer={reactions.chips}
            author={
              c.authorKind === "api_key" || !c.createdBy ? null : people.personOf(c.createdBy)
            }
            // An app's comment shows the plug mark, not the "?" (MOD-149).
            app={c.authorKind === "api_key"}
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
              <CommentBody
                text={parsed.text}
                mentionNames={people.names}
                selfName={selfName}
                workspaceId={c.workspaceId}
              />
            ) : null}
          </CommentCard>
        )}
      </WithCommentReactions>
    );
  };

  // Resolving takes the highlight out of the doc, so it needs an editor that
  // can write it (a viewer reads and replies; an editor resolves).
  const canResolve = canComment && anchorStore.actions(noteId)?.editable === true;

  const anchoredText = (anchorId: string) => anchorStore.actions(noteId)?.textOf(anchorId) ?? "";

  const renderThread = (g: CommentThreadGroup, kind: "open" | "detached" | "resolved") => {
    const focused = anchors.focused === g.anchorId;
    const text = kind === "open" ? anchoredText(g.anchorId) : "";
    return (
      <section
        key={g.anchorId}
        aria-label="Comment thread"
        className={`space-y-2 rounded-lg border p-2 ${focused ? "border-ring" : "border-border"}`}
      >
        <div className="flex items-start gap-1.5">
          <button
            type="button"
            disabled={kind !== "open"}
            onClick={() => focusThread(g.anchorId)}
            className="flex min-w-0 flex-1 gap-1.5 rounded-md border-l-2 border-warning bg-muted/50 px-2 py-1 text-left text-xs text-muted-foreground enabled:hover:bg-state-hover enabled:hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title={kind === "open" ? "Show in the note" : undefined}
          >
            <span className="line-clamp-2">
              {kind === "open"
                ? text || "…"
                : kind === "detached"
                  ? "The text this was on was deleted."
                  : "Resolved"}
            </span>
          </button>
          {kind !== "resolved" && canResolve ? (
            <IconButton
              icon={Check}
              label="Resolve"
              className="-my-0.5 shrink-0"
              onClick={() => void resolve(g.anchorId)}
            />
          ) : null}
        </div>
        {g.comments.map(renderComment)}
        {kind !== "resolved" && canComment && focused ? (
          <CommentComposer
            people={people.mentionable}
            placeholder="Reply…  @ to mention"
            onSubmit={(body, mentionedUserIds) =>
              thread.post({ body, mentionedUserIds, anchorId: g.anchorId })
            }
          />
        ) : null}
        {kind !== "resolved" && canComment && !focused ? (
          <button
            type="button"
            onClick={() => anchorStore.focus(noteId, g.anchorId)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Reply
          </button>
        ) : null}
      </section>
    );
  };

  const pending =
    anchors.pending && !thread.comments.some((c) => c.anchorId === anchors.pending)
      ? anchors.pending
      : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="pane-scroll min-h-0 flex-1 space-y-3 overflow-y-auto pb-3">
        {pending && canComment ? (
          <section
            aria-label="New comment thread"
            className="space-y-2 rounded-lg border border-ring p-2"
          >
            <div className="flex gap-1.5 rounded-md border-l-2 border-warning bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
              <span className="line-clamp-2">{anchoredText(pending) || "…"}</span>
            </div>
            <CommentComposer
              people={people.mentionable}
              placeholder="Comment on this…  @ to mention"
              autoFocus
              onCancel={() => {
                anchorStore.actions(noteId)?.unanchor(pending);
                anchorStore.setPending(noteId, null);
              }}
              onSubmit={async (body, mentionedUserIds) => {
                await thread.post({ body, mentionedUserIds, anchorId: pending });
                anchorStore.setPending(noteId, null);
              }}
            />
          </section>
        ) : null}

        {thread.loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            {groups.open.map((g) => renderThread(g, "open"))}
            {groups.detached.length > 0 ? (
              <Group title="Detached">
                {groups.detached.map((g) => renderThread(g, "detached"))}
              </Group>
            ) : null}
            {groups.resolved.length > 0 ? (
              <div>
                <button
                  type="button"
                  aria-expanded={showResolved}
                  onClick={() => setShowResolved((v) => !v)}
                  className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  <ChevronRight
                    className={`size-3 transition-transform ${showResolved ? "rotate-90" : ""}`}
                    aria-hidden
                  />
                  Resolved ({groups.resolved.length})
                </button>
                {showResolved ? (
                  <div className="mt-2 space-y-3">
                    {groups.resolved.map((g) => renderThread(g, "resolved"))}
                  </div>
                ) : null}
              </div>
            ) : null}
            {groups.open.length + groups.detached.length + groups.resolved.length > 0 &&
            groups.noteLevel.length > 0 ? (
              <Group title="On the note">{groups.noteLevel.map(renderComment)}</Group>
            ) : (
              groups.noteLevel.map(renderComment)
            )}
            {thread.comments.length === 0 && !pending ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No comments yet. Select text and choose Comment to start a thread.
              </p>
            ) : null}
          </>
        )}
      </div>

      {canComment ? (
        <div className="shrink-0 pt-2">
          <CommentComposer
            people={people.mentionable}
            placeholder="Comment on the note…  @ to mention"
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

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}
