// Reactions on a task or note comment (CV-7c, CH16a, CH49): the kit's reaction
// component with your quick row, the same as on chat messages. Any emoji;
// never a notification. Gives the two pieces a comment card places: the ☺
// button (its actions) and the chips (its footer).

import { canonicalReactionKey } from "@contracts/vocabularies";
import type { ReactNode } from "react";
import { toast } from "sonner";

import { ReactionButton, Reactions } from "@/components/ui/reactions";
import type { SpineComment } from "@/lib/runtime.types";

import { dispatchOpenSettings } from "../../settings/settings-events";
import type { CommentThread } from "../hooks/use-comment-thread";
import { useQuickReactions } from "../hooks/use-quick-reactions";
import { groupReactions, reactedBy, reactionName } from "../reactions";

export function useCommentReactions({
  comment,
  thread,
  currentUserId,
  nameOf,
  canReact = true,
  onAnyEmoji,
}: {
  comment: SpineComment;
  thread: Pick<CommentThread, "react">;
  currentUserId: string | null;
  nameOf: (userId: string) => string | null;
  /** Off where you may not react: the chips still say who did. */
  canReact?: boolean;
  /** The full picker (CV-7b's seam): opens it for this comment. */
  onAnyEmoji?: () => void;
}): { button: ReactNode; chips: ReactNode } {
  const { row } = useQuickReactions(currentUserId);
  const groups = groupReactions(comment.reactions, currentUserId, nameOf);
  const mine = new Set(groups.filter((g) => g.mine).map((g) => g.key));

  const react = (picked: string, on: boolean) => {
    const key = canonicalReactionKey(picked);
    void thread.react(comment.id, key, on).catch((e: unknown) => {
      toast.error(e instanceof Error ? e.message : "Couldn’t save the reaction.");
    });
  };

  const button = canReact ? (
    <ReactionButton
      keys={row}
      mine={mine}
      labelOf={reactionName}
      onPick={react}
      onCustomize={() => dispatchOpenSettings({ section: "chat" })}
      onAnyEmoji={onAnyEmoji}
    />
  ) : null;

  const chips =
    groups.length > 0 ? (
      <Reactions
        className="mt-1.5"
        disabled={!canReact}
        onToggle={react}
        items={groups.map((g) => ({
          key: g.key,
          count: g.count,
          mine: g.mine,
          label: reactionName(g.key),
          who: reactedBy(g.people),
        }))}
      />
    ) : null;

  return { button, chips };
}

/** The same, for a list that renders comments inline (no component per row). */
export function WithCommentReactions({
  children,
  ...args
}: Parameters<typeof useCommentReactions>[0] & {
  children: (r: { button: ReactNode; chips: ReactNode }) => ReactNode;
}) {
  return <>{children(useCommentReactions(args))}</>;
}
