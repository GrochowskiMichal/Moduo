// "Comments & activity" at the bottom of the detail panel (tasks-v2 §9): one
// feed, oldest first, mixing comments with the quiet activity trail (module
// contract Pillar 3: mirrors, never walls), then the composer, then the
// metadata line. Comments go through `comments_op_add`, which notifies the
// people @mentioned plus the task's participants: its assignee, its creator and
// earlier commenters (TV-D1). Text and @mentions only; no attachments yet.

import { useEffect, useMemo, useRef, useState } from "react";

import type { ModuoRuntime } from "@/lib/runtime.types";
import { commentAuthorName } from "../../spine/comments";
import { useCommentPeople } from "../../spine/hooks/use-comment-people";
import { useCommentThread } from "../../spine/hooks/use-comment-thread";
import {
  CommentBody,
  CommentCard,
  CommentComposer,
  PersonAvatar,
} from "../../spine/ui/comments-panel";
import { activityActorName, activityLine } from "../activity";
import { createdByLabel } from "../assignee-options";
import { useAssignees } from "../assignees";
import { buildTaskFeed, type FeedItem, feedTime, foldFeed } from "../feed";
import { formatTimestamp } from "../helpers";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import type { ActivityEntry, Task } from "../model";

const NO_ACTIVITY: ActivityEntry[] = [];

type Props = {
  task: Task;
  api: TasksModuleApi;
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
};

export function TaskFeed({ task, api, runtime, workspaceId }: Props) {
  const { loadActivity, activityStamp, currentUserId } = api;
  const [activity, setActivity] = useState<ActivityEntry[]>(NO_ACTIVITY);
  const [expanded, setExpanded] = useState(false);
  const people = useCommentPeople();
  const thread = useCommentThread({
    runtime,
    workspaceId,
    entityType: "task",
    entityId: task.id,
    entityLabel: task.title,
    entityIcon: "task",
  });
  const reloadThread = thread.reload;

  // biome-ignore lint/correctness/useExhaustiveDependencies: activityStamp re-reads the trail after an op
  useEffect(() => {
    let cancelled = false;
    void loadActivity(task.id)
      .then((rows) => {
        if (!cancelled) setActivity(rows);
      })
      .catch(() => {
        if (!cancelled) setActivity(NO_ACTIVITY);
      });
    return () => {
      cancelled = true;
    };
  }, [task.id, activityStamp, loadActivity]);

  // Something changed on the task: pick up comments written meanwhile too. Not
  // on mount: the thread reads itself then.
  const seenStamp = useRef(activityStamp);
  // biome-ignore lint/correctness/useExhaustiveDependencies: activityStamp is the trigger
  useEffect(() => {
    if (activityStamp === seenStamp.current) return;
    seenStamp.current = activityStamp;
    reloadThread();
  }, [activityStamp]);

  const feed = useMemo(
    () => buildTaskFeed({ task, activity, comments: thread.comments }),
    [task, activity, thread.comments],
  );
  const { lead, hidden, rest } = foldFeed(feed, expanded);
  const selfName = currentUserId ? people.nameOf(currentUserId) : null;
  const canComment = !!runtime && !!workspaceId && !task.id.startsWith("tmp-");

  const render = (item: FeedItem) => {
    switch (item.kind) {
      case "created": {
        const who = item.actorId ? people.personOf(item.actorId) : null;
        const name =
          item.actorId && item.actorId === currentUserId
            ? "You"
            : item.actorId
              ? (who?.name ?? "A former member")
              : null;
        return (
          <FeedEvent
            key={item.id}
            person={who}
            time={feedTime(item.at)}
            title={formatTimestamp(item.at)}
          >
            {name ? (
              <>
                <b className="font-medium text-foreground">{name}</b> created this
              </>
            ) : (
              "Created"
            )}
          </FeedEvent>
        );
      }
      case "activity":
        return (
          <FeedEvent
            key={item.id}
            person={item.entry.actorId ? people.personOf(item.entry.actorId) : null}
            time={feedTime(item.at)}
            title={formatTimestamp(item.at)}
          >
            <b className="font-medium text-foreground">
              {activityActorName(item.entry, currentUserId)}
            </b>{" "}
            {activityLine(item.entry)}
          </FeedEvent>
        );
      case "comment": {
        const c = item.comment;
        return (
          <CommentCard
            key={item.id}
            author={
              c.authorKind === "api_key" || !c.createdBy ? null : people.personOf(c.createdBy)
            }
            authorName={commentAuthorName(c, currentUserId, people.nameOf)}
            time={feedTime(c.createdAt)}
            timeTitle={formatTimestamp(c.createdAt)}
          >
            <CommentBody text={c.body} mentionNames={people.names} selfName={selfName} />
          </CommentCard>
        );
      }
    }
  };

  return (
    <section aria-label="Comments and activity" className="flex flex-col gap-2.5">
      {lead.map(render)}
      {hidden > 0 ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="self-start rounded-sm font-sans text-xs text-muted-foreground transition-colors duration-(--motion-fade) ease-(--ease-out) hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          Show {hidden} earlier
        </button>
      ) : null}
      {rest.map(render)}
      {thread.failed ? (
        <p className="font-sans text-xs text-muted-foreground">
          Comments didn’t load.{" "}
          <button
            type="button"
            onClick={thread.reload}
            className="underline-offset-2 hover:text-foreground hover:underline"
          >
            Retry
          </button>
        </p>
      ) : null}
      {canComment ? (
        <CommentComposer
          people={people.mentionable}
          aria-label="Comment on this task"
          onSubmit={(body, mentionedUserIds) => thread.post({ body, mentionedUserIds })}
        />
      ) : null}
      <MetaLine task={task} />
    </section>
  );
}

/** One quiet trail line: avatar, "**Name** did this", when. */
function FeedEvent({
  person,
  time,
  title,
  children,
}: {
  person: { name: string; avatarUrl: string | null } | null;
  time: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2 font-sans text-xs text-muted-foreground">
      <PersonAvatar person={person} className="mt-px" />
      <p className="min-w-0 leading-relaxed">
        {children}{" "}
        <time className="whitespace-nowrap tabular-nums" title={title}>
          · {time}
        </time>
      </p>
    </div>
  );
}

/** "Created by Maciej · Oct 6, 12:07 PM · Updated 7:20 PM". No "Rescheduled N×":
 *  the counter stopped counting at TV-D2 (TV-P0, AC1.11). */
function MetaLine({ task }: { task: Task }) {
  const { byId } = useAssignees();
  const by = createdByLabel(task, byId);
  const parts = [
    by
      ? `Created by ${by} · ${formatTimestamp(task.createdAt)}`
      : `Created ${formatTimestamp(task.createdAt)}`,
    `Updated ${feedTime(task.updatedAt)}`,
  ];
  return (
    <p className="font-sans text-2xs text-muted-foreground tabular-nums">{parts.join(" · ")}</p>
  );
}
