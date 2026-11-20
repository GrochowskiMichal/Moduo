/**
 * Notes right panel — Comments (NO-7, rebuilt for NR-8 anchored threads,
 * reworked 2026-10-24).
 *
 * Threads anchored to text are listed in document order, each a quiet block
 * (no box that lights up by itself): the commented text as a quote line you
 * can click to jump to it, its comments, Reply and Resolve. The thread you're
 * in is a soft tint, matching its stronger highlight in the note. Every
 * comment has a ⋯ with Edit (yours) and Delete (yours, or anyone's if you can
 * edit the note), with Undo. Deleting a thread's last comment takes its
 * highlight out of the note. A thread whose text was deleted moves to
 * "Detached"; resolved threads fold under "Resolved". Comments on the note as
 * a whole come last, with the composer at the bottom. @mentions notify.
 */

import { Check, ChevronRight, Ellipsis, Pencil, Quote as QuoteIcon, Trash2 } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";
import { commentAuthorName, editableComment, relativeTime } from "@/features/spine/comments";
import { useCommentPeople } from "@/features/spine/hooks/use-comment-people";
import { type CommentThread, useCommentThread } from "@/features/spine/hooks/use-comment-thread";
import { WithCommentReactions } from "@/features/spine/ui/comment-reactions";
import { CommentBody, CommentCard, CommentComposer } from "@/features/spine/ui/comments-panel";
import type { ModuoRuntime, SpineComment } from "@/lib/runtime.types";
import { undoToast } from "@/lib/undo-toast";
import { cn } from "@/lib/utils";

import { anchorStore, useNoteAnchors } from "../comments/anchor-store";
import { type CommentThreadGroup, groupThreads } from "../comments/anchors";
import { parseQuoteComment } from "../comments/quote";

type Props = {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  noteId: string;
  noteLabel: string;
  /** Any member with notes access may comment (view-only included, per spec). */
  canComment: boolean;
  /** Can edit the note: may delete anyone's comment on it. */
  canModerate?: boolean;
  currentUserId: string | null;
  /** Scroll the editor to a quoted snippet (older quote-comments). */
  onScrollToQuote: (quote: string) => void;
};

export function NoteCommentsPanel({
  runtime,
  workspaceId,
  noteId,
  noteLabel,
  canComment,
  canModerate = false,
  currentUserId,
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
  const [showResolved, setShowResolved] = useState(false);
  const selfName = currentUserId ? people.nameOf(currentUserId) : null;

  const groups = useMemo(
    () => groupThreads(thread.comments, anchors.docOrder),
    [thread.comments, anchors.docOrder],
  );

  // Tell the editor which threads are open (only their marks highlight) and
  // how many comments each holds (the margin's counts).
  useEffect(() => {
    if (thread.loading) return;
    const live = [...groups.open, ...groups.detached];
    anchorStore.setOpenThreads(noteId, new Set(live.map((g) => g.anchorId)));
    anchorStore.setCounts(noteId, new Map(live.map((g) => [g.anchorId, g.comments.length])));
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

  // Resolving takes the highlight out of the doc, so it needs an editor that
  // can write it (a viewer reads and replies; an editor resolves).
  const canResolve = canComment && anchorStore.actions(noteId)?.editable === true;

  const anchoredText = (anchorId: string) => anchorStore.actions(noteId)?.textOf(anchorId) ?? "";

  /** After a delete: an anchored thread with no comments left loses its mark. */
  const onDeleted = (c: SpineComment) => {
    if (!c.anchorId) return;
    const left = thread.comments.filter((x) => x.anchorId === c.anchorId && x.id !== c.id);
    if (left.length === 0) anchorStore.actions(noteId)?.unanchor(c.anchorId);
  };

  const renderComment = (c: SpineComment) => (
    <NoteComment
      key={c.id}
      comment={c}
      thread={thread}
      currentUserId={currentUserId}
      canReact={canComment}
      canRemoveAny={canModerate}
      selfName={selfName}
      onScrollToQuote={onScrollToQuote}
      onDeleted={onDeleted}
    />
  );

  const renderThread = (g: CommentThreadGroup, kind: "open" | "detached" | "resolved") => {
    const focused = anchors.focused === g.anchorId;
    const text = kind === "open" ? anchoredText(g.anchorId) : "";
    return (
      <section
        key={g.anchorId}
        aria-label="Comment thread"
        className={cn(
          "space-y-2 rounded-md px-2 py-2 transition-colors duration-(--motion-fade) ease-(--ease-out)",
          focused && "bg-state-hover",
        )}
      >
        <div className="flex items-start gap-1.5">
          <button
            type="button"
            disabled={kind !== "open"}
            onClick={() => focusThread(g.anchorId)}
            className="flex min-w-0 flex-1 border-l-2 border-(--comment-mark-line) pl-2 text-left text-xs text-muted-foreground enabled:hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            title={kind === "open" ? "Show in the note" : undefined}
          >
            <span className="line-clamp-2">
              {kind === "open"
                ? text || "The commented text"
                : kind === "detached"
                  ? "The text this was on was deleted."
                  : "Resolved"}
            </span>
          </button>
          {kind !== "resolved" && canResolve ? (
            <Button
              variant="ghost"
              size="sm"
              className="-my-1 shrink-0 gap-1 px-1.5 text-xs text-muted-foreground"
              onClick={() => void resolve(g.anchorId)}
            >
              <Check aria-hidden className="size-icon-xs" />
              Resolve
            </Button>
          ) : null}
        </div>
        {g.comments.map(renderComment)}
        {kind !== "resolved" && canComment ? (
          focused ? (
            <CommentComposer
              people={people.mentionable}
              placeholder="Reply…"
              onSubmit={(body, mentionedUserIds) =>
                thread.post({ body, mentionedUserIds, anchorId: g.anchorId })
              }
            />
          ) : (
            <button
              type="button"
              onClick={() => anchorStore.focus(noteId, g.anchorId)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Reply
            </button>
          )
        ) : null}
      </section>
    );
  };

  const pending =
    anchors.pending && !thread.comments.some((c) => c.anchorId === anchors.pending)
      ? anchors.pending
      : null;

  const anyThreads = groups.open.length + groups.detached.length + groups.resolved.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="pane-scroll min-h-0 flex-1 space-y-1 overflow-y-auto pb-3">
        {pending && canComment ? (
          <section
            aria-label="New comment thread"
            className="space-y-2 rounded-md bg-state-hover px-2 py-2"
          >
            <div className="border-l-2 border-(--comment-mark-line) pl-2 text-xs text-muted-foreground">
              <span className="line-clamp-2">{anchoredText(pending) || "The selected text"}</span>
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
              <div className="px-2 pt-2">
                <button
                  type="button"
                  aria-expanded={showResolved}
                  onClick={() => setShowResolved((v) => !v)}
                  className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  <ChevronRight
                    className={cn(
                      "size-3 transition-transform duration-(--motion-fade) ease-(--ease-out)",
                      showResolved && "rotate-90",
                    )}
                    aria-hidden
                  />
                  Resolved ({groups.resolved.length})
                </button>
                {showResolved ? (
                  <div className="mt-1 -mx-2 space-y-1">
                    {groups.resolved.map((g) => renderThread(g, "resolved"))}
                  </div>
                ) : null}
              </div>
            ) : null}
            {groups.noteLevel.length > 0 ? (
              anyThreads ? (
                <Group title="On the note">
                  <div className="space-y-2 px-2">{groups.noteLevel.map(renderComment)}</div>
                </Group>
              ) : (
                <div className="space-y-2 px-2">{groups.noteLevel.map(renderComment)}</div>
              )
            ) : null}
            {thread.comments.length === 0 && !pending ? (
              <p className="px-2 py-6 text-center text-sm text-pretty text-muted-foreground">
                {canComment
                  ? "No comments yet. Comment on the whole note below, or select text (⌘⌥M) to comment on a line."
                  : "No comments yet."}
              </p>
            ) : null}
          </>
        )}
      </div>

      {canComment ? (
        <div className="shrink-0 pt-2">
          <CommentComposer
            people={people.mentionable}
            placeholder="Comment on the note…"
            onSubmit={(body, mentionedUserIds) => thread.post({ body, mentionedUserIds })}
          />
        </div>
      ) : null}
    </div>
  );
}

/** One comment: its card, reactions, and a ⋯ with Edit and Delete. */
function NoteComment({
  comment,
  thread,
  currentUserId,
  canReact,
  canRemoveAny,
  selfName,
  onScrollToQuote,
  onDeleted,
}: {
  comment: SpineComment;
  thread: CommentThread;
  currentUserId: string | null;
  canReact: boolean;
  canRemoveAny: boolean;
  selfName: string | null;
  onScrollToQuote: (quote: string) => void;
  onDeleted: (comment: SpineComment) => void;
}) {
  const people = useCommentPeople();
  const [editing, setEditing] = useState(false);
  const mine =
    comment.authorKind === "user" && !!currentUserId && comment.createdBy === currentUserId;
  const canRemove = mine || canRemoveAny;
  const parsed = parseQuoteComment(comment.body);

  const remove = () => {
    void thread
      .remove(comment.id)
      .then(() => {
        onDeleted(comment);
        undoToast("Comment deleted", {
          onUndo: () => {
            void thread.restore(comment.id).catch((e: unknown) => {
              toast.error(e instanceof Error ? e.message : "Couldn’t bring the comment back.");
            });
          },
        });
      })
      .catch((e: unknown) => {
        toast.error(e instanceof Error ? e.message : "Couldn’t delete the comment.");
      });
  };

  if (editing) {
    return (
      <CommentComposer
        people={people.mentionable}
        aria-label="Edit comment"
        initial={editableComment(comment.body, () => null, people.mentionable)}
        submitLabel="Save"
        autoFocus
        onCancel={() => setEditing(false)}
        onSubmit={async (body, mentionedUserIds) => {
          await thread.edit({ commentId: comment.id, body, mentionedUserIds });
          setEditing(false);
        }}
      />
    );
  }

  return (
    // CV-7c: the same reactions as task comments and chat (CH49).
    <WithCommentReactions
      comment={comment}
      thread={thread}
      currentUserId={currentUserId}
      nameOf={people.nameOf}
      canReact={canReact}
    >
      {(reactions) => (
        <CommentCard
          actions={
            <>
              {reactions.button}
              {canRemove ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton icon={Ellipsis} label="Comment actions" tooltip={null} size="sm" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    {mine ? (
                      <DropdownMenuItem onSelect={() => setEditing(true)}>
                        <Pencil aria-hidden />
                        Edit
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem variant="destructive" onSelect={remove}>
                      <Trash2 aria-hidden />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </>
          }
          footer={reactions.chips}
          author={
            comment.authorKind === "api_key" || !comment.createdBy
              ? null
              : people.personOf(comment.createdBy)
          }
          // An app's comment shows the plug mark, not the "?" (MOD-149).
          app={comment.authorKind === "api_key"}
          authorName={commentAuthorName(comment, currentUserId, people.nameOf)}
          time={relativeTime(comment.createdAt)}
          timeTitle={new Date(comment.createdAt).toLocaleString()}
          meta={comment.editedAt ? <span>edited</span> : null}
        >
          {parsed.quote ? (
            <button
              type="button"
              onClick={() => onScrollToQuote(parsed.quote!)}
              className="mb-1.5 flex w-full gap-1.5 border-l-2 border-border pl-2 text-left text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
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
              workspaceId={comment.workspaceId}
            />
          ) : null}
        </CommentCard>
      )}
    </WithCommentReactions>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-1 pt-2">
      <h3 className="px-2 text-xs font-medium text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}
