// One entity's comment thread: read it, post to it (CT-5's `comments_op_add`,
// which notifies the @mentioned people and the entity's participants), reload.
// Shared by Notes' Comments panel and the Tasks detail feed. A reply that lands
// after the entity changed is dropped (request counter), and so is one that
// lands after unmount (gotchas/ui.md "reqRef … bump it in the cleanup").

import { useCallback, useEffect, useRef, useState } from "react";

import type { ModuoRuntime, SpineComment } from "@/lib/runtime.types";

const NO_COMMENTS: SpineComment[] = [];

export type CommentThread = {
  comments: SpineComment[];
  loading: boolean;
  /** The last read failed (the list keeps what it had). */
  failed: boolean;
  reload: () => void;
  /** Post a comment; resolves when it's saved and the thread has reloaded. Throws on failure. */
  post: (input: { body: string; mentionedUserIds: string[] }) => Promise<void>;
};

export function useCommentThread({
  runtime,
  workspaceId,
  entityType,
  entityId,
  entityLabel,
  entityIcon,
}: {
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  entityType: string;
  entityId: string;
  /** The label the notification card shows ("Untitled" when empty). */
  entityLabel: string;
  entityIcon: string | null;
}): CommentThread {
  const [comments, setComments] = useState<SpineComment[]>(NO_COMMENTS);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const reqRef = useRef(0);
  const aliveRef = useRef(false);
  const labelRef = useRef(entityLabel);
  labelRef.current = entityLabel;

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

  const reload = useCallback(() => void read(), [read]);

  return { comments, loading, failed, reload, post };
}
