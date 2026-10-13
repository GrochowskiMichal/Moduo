// One entity's comment thread: read it, post to it (CT-5's `comments_op_add`,
// which notifies the @mentioned people and the entity's participants), edit,
// delete with Undo and react (TV-U13), reload. Shared by Notes' Comments panel
// and the Tasks detail feed. A reply that lands after the entity changed is
// dropped (request counter), and so is one that lands after unmount
// (gotchas/ui.md "reqRef … bump it in the cleanup").

import type { CommentReaction } from "@contracts/vocabularies";
import { useCallback, useEffect, useRef, useState } from "react";

import type { CommentReactionMark, ModuoRuntime, SpineComment } from "@/lib/runtime.types";

const NO_COMMENTS: SpineComment[] = [];

export type CommentThread = {
  comments: SpineComment[];
  loading: boolean;
  /** The last read failed (the list keeps what it had). */
  failed: boolean;
  reload: () => void;
  /** Post a comment; resolves when it's saved and the thread has reloaded. Throws on failure. */
  post: (input: { body: string; mentionedUserIds: string[] }) => Promise<void>;
  /** Edit your own comment; shown at once, put back if refused. Throws on failure. */
  edit: (input: { commentId: string; body: string; mentionedUserIds: string[] }) => Promise<void>;
  /** Delete a comment (it leaves the thread at once); throws, and puts it back, on failure. */
  remove: (commentId: string) => Promise<void>;
  /** Undo a delete; throws on failure. */
  restore: (commentId: string) => Promise<void>;
  /** Add or take back one of my reactions; shown at once. Throws on failure. */
  react: (commentId: string, reaction: CommentReaction, on: boolean) => Promise<void>;
};

/** A comment's reactions with mine toggled. Pure. */
export function toggledReactions(
  reactions: readonly CommentReactionMark[],
  userId: string,
  reaction: CommentReaction,
  on: boolean,
): CommentReactionMark[] {
  const rest = reactions.filter((r) => !(r.userId === userId && r.reaction === reaction));
  return on ? [...rest, { userId, reaction }] : rest;
}

export function useCommentThread({
  runtime,
  workspaceId,
  entityType,
  entityId,
  entityLabel,
  entityIcon,
  currentUserId = null,
}: {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  entityType: string;
  entityId: string;
  /** The label the notification card shows ("Untitled" when empty). */
  entityLabel: string;
  entityIcon: string | null;
  /** Me, for showing my own reaction before the server answers. */
  currentUserId?: string | null;
}): CommentThread {
  const [comments, setComments] = useState<SpineComment[]>(NO_COMMENTS);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const reqRef = useRef(0);
  const aliveRef = useRef(false);
  const labelRef = useRef(entityLabel);
  labelRef.current = entityLabel;
  const commentsRef = useRef(comments);
  commentsRef.current = comments;

  const read = useCallback((): Promise<void> => {
    if (!aliveRef.current) return Promise.resolve();
    const req = ++reqRef.current;
    if (!runtime || !workspaceId) {
      setComments(NO_COMMENTS);
      setLoading(false);
      return Promise.resolve();
    }
    return runtime.spine
      .listComments({ workspaceId, entityType, entityId })
      .then((rows) => {
        if (req !== reqRef.current) return;
        setComments(rows);
        setFailed(false);
        setLoading(false);
      })
      .catch(() => {
        if (req !== reqRef.current) return;
        setFailed(true);
        setLoading(false);
      });
  }, [runtime, workspaceId, entityType, entityId]);

  useEffect(() => {
    aliveRef.current = true;
    setComments(NO_COMMENTS);
    setLoading(true);
    setFailed(false);
    void read();
    return () => {
      // Drop any reply still in flight for this entity (switch or unmount).
      aliveRef.current = false;
      reqRef.current += 1;
    };
  }, [read]);

  const post = useCallback(
    async ({ body, mentionedUserIds }: { body: string; mentionedUserIds: string[] }) => {
      if (!runtime || !workspaceId) throw new Error("Not signed in.");
      await runtime.spine.addComment({
        workspaceId,
        entityType,
        entityId,
        body,
        mentionedUserIds,
        entityLabel: labelRef.current.trim() || "Untitled",
        entityIcon,
      });
      await read();
    },
    [runtime, workspaceId, entityType, entityId, entityIcon, read],
  );

  /** Show `next` for one comment now; a newer read replaces it. */
  const showComment = useCallback(
    (commentId: string, next: (c: SpineComment) => SpineComment | null) => {
      // A read in flight would put back what it read before this change.
      reqRef.current += 1;
      setComments((list) =>
        list.flatMap((c) => {
          if (c.id !== commentId) return [c];
          const shown = next(c);
          return shown ? [shown] : [];
        }),
      );
    },
    [],
  );

  const edit = useCallback(
    async ({
      commentId,
      body,
      mentionedUserIds,
    }: {
      commentId: string;
      body: string;
      mentionedUserIds: string[];
    }) => {
      if (!runtime) throw new Error("Not signed in.");
      const before = commentsRef.current.find((c) => c.id === commentId);
      showComment(commentId, (c) => ({ ...c, body, editedAt: new Date().toISOString() }));
      try {
        const saved = await runtime.spine.editComment({ commentId, body, mentionedUserIds });
        showComment(commentId, (c) => ({ ...saved, reactions: c.reactions }));
      } catch (e) {
        if (before) showComment(commentId, () => before);
        throw e;
      }
    },
    [runtime, showComment],
  );

  const remove = useCallback(
    async (commentId: string) => {
      if (!runtime) throw new Error("Not signed in.");
      showComment(commentId, () => null);
      try {
        await runtime.spine.deleteComment({ commentId });
      } catch (e) {
        await read();
        throw e;
      }
    },
    [runtime, showComment, read],
  );

  const restore = useCallback(
    async (commentId: string) => {
      if (!runtime) throw new Error("Not signed in.");
      await runtime.spine.restoreComment({ commentId });
      await read();
    },
    [runtime, read],
  );

  const react = useCallback(
    async (commentId: string, reaction: CommentReaction, on: boolean) => {
      if (!runtime) throw new Error("Not signed in.");
      const before = commentsRef.current.find((c) => c.id === commentId);
      if (currentUserId) {
        showComment(commentId, (c) => ({
          ...c,
          reactions: toggledReactions(c.reactions, currentUserId, reaction, on),
        }));
      }
      try {
        const reactions = await runtime.spine.reactToComment({ commentId, reaction, on });
        showComment(commentId, (c) => ({ ...c, reactions }));
      } catch (e) {
        if (before) showComment(commentId, (c) => ({ ...c, reactions: before.reactions }));
        throw e;
      }
    },
    [runtime, currentUserId, showComment],
  );

  const reload = useCallback(() => void read(), [read]);

  return { comments, loading, failed, reload, post, edit, remove, restore, react };
}
