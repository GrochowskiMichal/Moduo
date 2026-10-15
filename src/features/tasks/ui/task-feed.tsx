// The one feed at the bottom of the detail panel (Tasks v3 §9, default q;
// research views-board-detail §9): comments and the quiet activity trail in
// one list, oldest first, then the composer, then the metadata line.
//
// - "All · Comments" in the header, remembered per person on this device.
// - One person's changes within 10 minutes merge ("changed due, priority and
//   2 more", click to see each); runs of changes between comments fold into
//   "Show 12 earlier changes".
// - Comments: edit your own ("edited"), delete with an 8 s Undo and no
//   tombstone (yours, or anyone's with Full access to the project), reactions
//   (any emoji, your quick row first; CV-7c) that never notify. No threads.
// Comments go through the spine's ops (`comments_op_*`); the thread re-reads
// whenever the store sees one of this task's comments change (an edit, a
// reaction, a delete elsewhere).

import { Ellipsis, Pencil, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FeedItem as FeedLine } from "@/components/ui/feed";
import { IconButton } from "@/components/ui/icon-button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import type { ModuoRuntime, SpineComment } from "@/lib/runtime.types";
import { undoToast } from "@/lib/undo-toast";
import { commentAuthorName, editableComment } from "../../spine/comments";
import { useCommentPeople } from "../../spine/hooks/use-comment-people";
import { type CommentThread, useCommentThread } from "../../spine/hooks/use-comment-thread";
import { useReferences } from "../../spine/references/context";
import { referencesInText } from "../../spine/references/text";
import { useCommentReactions } from "../../spine/ui/comment-reactions";
import {
  CommentBody,
  CommentCard,
  CommentComposer,
  type ComposerTeam,
  PersonAvatar,
} from "../../spine/ui/comments-panel";
import { activityActorName, activityLine } from "../activity";
import { createdByLabel } from "../assignee-options";
import { useAssignees } from "../assignees";
import {
  buildTaskFeed,
  type FeedFilter,
  type FeedItem,
  type FeedRow,
  feedTime,
  foldLabel,
  mergedLine,
  shapeFeed,
} from "../feed";
import { formatTimestamp } from "../helpers";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import type { ActivityEntry, Task } from "../model";

const NO_ACTIVITY: ActivityEntry[] = [];

type Props = {
  task: Task;
  api: TasksModuleApi;
  runtime: ModuoRuntime | null;
  workspaceId: string | null;
  /** Full access to the task's project: delete anyone's comment (the server decides). */
  canRemoveAny?: boolean;
};

// ── the remembered filter ─────────────────────────────────────────────────────

const FILTER_KEY = "moduo:task-feed-filter";

function readFilter(userId: string | null): FeedFilter {
  try {
    const v = localStorage.getItem(`${FILTER_KEY}:${userId ?? "anon"}`);
    return v === "comments" ? "comments" : "all";
  } catch {
    return "all";
  }
}

function writeFilter(userId: string | null, filter: FeedFilter) {
  try {
    localStorage.setItem(`${FILTER_KEY}:${userId ?? "anon"}`, filter);
  } catch {
    // A private window or blocked storage: the switch still works for this view.
  }
}

export function TaskFeed({ task, api, runtime, workspaceId, canRemoveAny = false }: Props) {
  const { loadActivity, activityStamp, currentUserId } = api;
  const [activity, setActivity] = useState<ActivityEntry[]>(NO_ACTIVITY);
  const [filter, setFilterState] = useState<FeedFilter>(() => readFilter(currentUserId));
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const people = useCommentPeople();
  // TV-D13: `@Design` in a comment tells Design's members once.
  const teams = useMemo<ComposerTeam[]>(
    () => api.teams.map((t) => ({ id: t.id, name: t.name, mark: t.mark, color: t.color })),
    [api.teams],
  );
  const thread = useCommentThread({
    runtime,
    workspaceId,
    entityType: "task",
    entityId: task.id,
    entityLabel: task.title,
    entityIcon: "task",
    currentUserId,
  });
  const reloadThread = thread.reload;

  const setFilter = (next: FeedFilter) => {
    setFilterState(next);
    writeFilter(currentUserId, next);
  };

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

  // Something changed on the task, or one of its comments changed anywhere
  // (an edit, a reaction, a delete; the store hears them live): read the
  // thread again. Not on mount: the thread reads itself then.
  const commentStamp = api.commentStamps?.get(task.id) ?? "";
  const seen = useRef({ activityStamp, commentStamp });
  // biome-ignore lint/correctness/useExhaustiveDependencies: the stamps are the trigger
  useEffect(() => {
    const last = seen.current;
    if (last.activityStamp === activityStamp && last.commentStamp === commentStamp) return;
    seen.current = { activityStamp, commentStamp };
    reloadThread();
  }, [activityStamp, commentStamp]);

  const feed = useMemo(
    () => buildTaskFeed({ task, activity, comments: thread.comments }),
    [task, activity, thread.comments],
  );
  const rows = shapeFeed(feed, filter, opened);
  const selfName = currentUserId ? people.nameOf(currentUserId) : null;
  const canComment = !!runtime && !!workspaceId && !task.id.startsWith("tmp-");
  // `@` in a comment names things too (RF-1): the registry, under its RLS,
  // never this task itself. Stored as references, never titles.
  const taskId = task.id;
  const referenceSearch = useMemo(
    () =>
      runtime && workspaceId
        ? {
            search: async (query: string) => {
              const records = await runtime.spine.searchEntities({
                workspaceId,
                query,
                limit: 7,
              });
              return records
                .filter((r) => !(r.type === "task" && r.id === taskId))
                .map((r) => ({ ref: { type: r.type, id: r.id }, label: r.label, icon: r.icon }));
            },
          }
        : undefined,
    [runtime, workspaceId, taskId],
  );

  const open = (id: string) => setOpened((prev) => new Set(prev).add(id));

  const render = (row: FeedRow) => {
    switch (row.kind) {
      case "line":
        return <TrailLine key={row.id} item={row.item} currentUserId={currentUserId} />;
      case "merged":
        return (
          <MergedLine
            key={row.id}
            entries={row.entries}
            at={row.at}
            currentUserId={currentUserId}
            expanded={opened.has(row.id)}
            onExpand={() => open(row.id)}
          />
        );
      case "fold":
        return (
          <Button
            key={row.id}
            variant="ghost"
            size="sm"
            onClick={() => open(row.id)}
            className="-ms-2 self-start font-sans text-xs font-normal text-muted-foreground"
          >
            {foldLabel(row.count)}
          </Button>
        );
      case "comment":
        return (
          <CommentItem
            key={row.id}
            comment={row.comment}
            thread={thread}
            currentUserId={currentUserId}
            canRemoveAny={canRemoveAny}
            selfName={selfName}
            referenceSearch={referenceSearch}
            teams={teams}
          />
        );
    }
  };

  return (
    <section aria-label="Comments and activity" className="flex flex-col gap-2.5">
      <div className="flex min-h-(--ctrl-h-sm) items-center justify-between gap-2">
        <h3 className="font-sans text-sm font-medium text-foreground">Activity</h3>
        <SegmentedControl
          size="sm"
          aria-label="Show"
          value={filter}
          onValueChange={(v) => setFilter(v === "comments" ? "comments" : "all")}
          items={[
            { value: "all", label: "All" },
            { value: "comments", label: "Comments" },
          ]}
        />
      </div>
      {rows.map(render)}
      {filter === "comments" && rows.length === 0 && !thread.loading ? (
        <p className="font-sans text-xs text-muted-foreground">No comments yet.</p>
      ) : null}
      {thread.failed ? (
        <p className="font-sans text-xs text-muted-foreground">
          Comments didn’t load.{" "}
          <Button
            variant="ghost"
            size="sm"
            onClick={thread.reload}
            className="-my-1 px-1.5 font-sans text-xs font-normal text-muted-foreground"
          >
            Retry
          </Button>
        </p>
      ) : null}
      {canComment ? (
        <CommentComposer
          people={people.mentionable}
          aria-label="Comment on this task"
          placeholder="Leave a comment…  @ to mention · / for dates"
          references={referenceSearch}
          teams={teams}
          onSubmit={(body, mentionedUserIds, mentionedTeamIds) =>
            thread.post({ body, mentionedUserIds, mentionedTeamIds })
          }
        />
      ) : null}
      <MetaLine task={task} />
    </section>
  );
}

// ── trail lines ───────────────────────────────────────────────────────────────

function TrailLine({ item, currentUserId }: { item: FeedItem; currentUserId: string | null }) {
  const people = useCommentPeople();
  if (item.kind === "created") {
    const who = item.actorId ? people.personOf(item.actorId) : null;
    const name =
      item.actorId && item.actorId === currentUserId
        ? "You"
        : item.actorId
          ? (who?.name ?? "A former member")
          : null;
    return (
      <FeedEvent person={who} time={feedTime(item.at)} title={formatTimestamp(item.at)}>
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
  if (item.kind === "activity") {
    return (
      <FeedEvent
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
  }
  return null;
}

/** One person's changes within 10 minutes: one line, each change on a click. */
function MergedLine({
  entries,
  at,
  currentUserId,
  expanded,
  onExpand,
}: {
  entries: ActivityEntry[];
  at: string;
  currentUserId: string | null;
  expanded: boolean;
  onExpand: () => void;
}) {
  const people = useCommentPeople();
  const first = entries[0] as ActivityEntry;
  if (expanded) {
    return (
      <>
        {entries.map((entry) => (
          <TrailLine
            key={entry.id}
            item={{ kind: "activity", id: entry.id, at: entry.createdAt, entry }}
            currentUserId={currentUserId}
          />
        ))}
      </>
    );
  }
  return (
    <FeedEvent
      person={first.actorId ? people.personOf(first.actorId) : null}
      time={feedTime(at)}
      title={formatTimestamp(at)}
    >
      <b className="font-medium text-foreground">{activityActorName(first, currentUserId)}</b>{" "}
      <button
        type="button"
        onClick={onExpand}
        aria-label={`${mergedLine(entries)}. Show each change`}
        className="hit-min inline rounded-sm text-left underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {mergedLine(entries)}
      </button>
    </FeedEvent>
  );
}

/** One quiet trail line: avatar, "**Name** did this", when (the kit's FeedItem). */
function FeedEvent({
  person,
  time,
  title,
  children,
}: {
  person: { id?: string; name: string; avatarUrl: string | null } | null;
  time: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <FeedLine avatar={<PersonAvatar person={person} />} time={time} timeTitle={title}>
      {children}
    </FeedLine>
  );
}

// ── comments ──────────────────────────────────────────────────────────────────

function CommentItem({
  comment,
  thread,
  currentUserId,
  canRemoveAny,
  selfName,
  referenceSearch,
  teams,
}: {
  comment: SpineComment;
  thread: CommentThread;
  currentUserId: string | null;
  canRemoveAny: boolean;
  selfName: string | null;
  referenceSearch: React.ComponentProps<typeof CommentComposer>["references"];
  teams: ComposerTeam[];
}) {
  const people = useCommentPeople();
  // `@Design` reads as a mention too (TV-D13).
  const mentionNames = useMemo(
    () => [...people.names, ...teams.map((t) => t.name)],
    [people.names, teams],
  );
  const [editing, setEditing] = useState(false);
  const mine =
    comment.authorKind === "user" && !!currentUserId && comment.createdBy === currentUserId;
  const canRemove = mine || canRemoveAny;
  // What the body names, so an edit starts from `@Title` (not a stored URI).
  const refs = useMemo(
    () => (editing ? referencesInText(comment.body) : []),
    [editing, comment.body],
  );
  const stateOf = useReferences(refs);

  const remove = () => {
    void thread
      .remove(comment.id)
      .then(() => {
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

  // CV-7c: the kit's reactions with your quick row (any emoji, never a notice).
  const reactions = useCommentReactions({ comment, thread, currentUserId, nameOf: people.nameOf });
  const author =
    comment.authorKind === "api_key" || !comment.createdBy
      ? null
      : people.personOf(comment.createdBy);

  if (editing) {
    const initial = editableComment(
      comment.body,
      (ref) => {
        const state = stateOf(ref);
        return state?.status === "ready" ? state.facts.title : null;
      },
      people.mentionable,
    );
    return (
      <CommentComposer
        people={people.mentionable}
        aria-label="Edit comment"
        references={referenceSearch}
        initial={initial}
        submitLabel="Save"
        autoFocus
        onCancel={() => setEditing(false)}
        teams={teams}
        onSubmit={async (body, mentionedUserIds, mentionedTeamIds) => {
          await thread.edit({ commentId: comment.id, body, mentionedUserIds, mentionedTeamIds });
          setEditing(false);
        }}
      />
    );
  }

  return (
    <CommentCard
      author={author}
      authorName={commentAuthorName(comment, currentUserId, people.nameOf)}
      time={feedTime(comment.createdAt)}
      timeTitle={formatTimestamp(comment.createdAt)}
      meta={comment.editedAt ? <span title={formatTimestamp(comment.editedAt)}>edited</span> : null}
      actions={
        <>
          {reactions.button}
          {mine || canRemove ? (
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
                {canRemove ? (
                  <DropdownMenuItem variant="destructive" onSelect={remove}>
                    <Trash2 aria-hidden />
                    Delete
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </>
      }
      footer={reactions.chips}
    >
      <CommentBody text={comment.body} mentionNames={mentionNames} selfName={selfName} />
    </CommentCard>
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
