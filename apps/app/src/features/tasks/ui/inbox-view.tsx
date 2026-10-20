// The Inbox on the List (tasks-v3 §8, defaults b and h, 20, 20a, 82b;
// research §7; TV-U15): newest on top with manual drag (the List's own),
// "from Mike" on what someone else put here, "via Claude Desktop" on what an
// agent captured (TV-U13b), the triage keys 1 · 2 · 3 · H
// (also the bottom bar's mode row), "Snoozed · n" at the end, and a calm
// zero state that says where captures come from. This hook hands the List
// what differs; the dialogs are mounted by the page.

import { isOpenTask } from "@contracts/vocabularies";
import { Inbox, Plus } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { type BottomBarMode, useBottomBarModeOwner } from "../../../components/app/bottom-bar-mode";
import { dispatchOpenCapture } from "../../../components/app/capture-shell";
import { Button } from "../../../components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "../../../components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { EmptyState } from "../../../components/ui/empty-state";
import { Input } from "../../../components/ui/input";
import { Kbd } from "../../../components/ui/kbd";
import { NavRowDot } from "../../../components/ui/nav-row";
import { isChatOwnedLink } from "../../../lib/entity-links";
import {
  type TasksInboxSnooze,
  updatePreferences,
  usePreferencesValue,
} from "../../../lib/preferences";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { formatShortcut, SHORTCUTS } from "../../../lib/shortcuts";
import { undoToast } from "../../../lib/undo-toast";
import { useAssignees } from "../assignees";
import { positionsBefore, todayStr } from "../helpers";
import {
  declineComment,
  declineMode,
  duplicateComment,
  inboxSourceLabel,
  snoozeChoices,
  snoozeDayLabel,
  snoozedUntilLabel,
  splitSnoozed,
  TRIAGE_ACTIONS,
  type TriageAction,
  triageActionFor,
} from "../inbox-triage";
import type { Bucket, Task } from "../model";
import { bucketDotColor } from "../sidebar";
import {
  useTaskCommands,
  useTasksReader,
  useTasksSelector,
  useTasksStatus,
  useTasksUserId,
} from "../tasks-context";
import { useToday } from "../use-today";
import { DayPickerDialog } from "./day-picker-dialog";
import type { ListExtraGroup } from "./list-extensions";
import { useAgentCaptures } from "./use-agent-captures";

/** The dialog a triage action opened, for one task. */
type Open =
  | { kind: "accept"; taskId: string }
  | { kind: "decline"; taskId: string }
  | { kind: "duplicate"; taskId: string }
  | { kind: "snooze"; taskId: string }
  | { kind: "snooze-pick"; taskId: string };

const SNOOZED_KEY = "snoozed";
/** The snoozes preferences keep per workspace (`preferences.ts`). */
const MAX_SNOOZES = 500;
const captureShortcut = SHORTCUTS.find((s) => s.id === "capture");

/** First name, as rows and notes say it ("Mike"). */
function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

export function useInboxView({
  runtime,
  workspaceId,
  enabled,
  canEdit,
  selectedTaskId,
  onSelectTask,
  visibleRows,
}: {
  runtime: ModuoRuntime | null;
  workspaceId: string;
  /** The Inbox is the place open: its keys and the bar's mode apply. */
  enabled: boolean;
  canEdit: boolean;
  selectedTaskId: string | null;
  onSelectTask: (id: string | null) => void;
  /** The rows as the List shows them now (Filter, search and order applied):
   *  after an action the cursor moves to the next of these. */
  visibleRows: { readonly current: readonly Task[] };
}): {
  /** The Inbox's tasks before Filter and search: the snoozed at the end. */
  scope: (inboxTasks: readonly Task[]) => Task[];
  extraGroups: readonly ListExtraGroup[];
  sourceOf: (task: Task) => string | null;
  onViewKey: (event: React.KeyboardEvent<HTMLDivElement>, selected: Task | null) => boolean;
  note: ReactNode;
  emptyState: ReactNode;
  dialogs: ReactNode;
} {
  const today = useToday();
  const { dropTask, patchTask } = useTaskCommands();
  const read = useTasksReader();
  const me = useTasksUserId() ?? null;
  const inbox = useTasksSelector((d) => d.inbox);
  const tasks = useTasksSelector((d) => d.liveTasks);
  const buckets = useTasksSelector((d) => d.buckets);
  const commentStamps = useTasksSelector((_, snap) => snap.commentStamps);
  const { reachedServer } = useTasksStatus();
  const inboxId = inbox?.id ?? null;
  const { byId } = useAssignees();
  const myName = firstName(byId(me)?.fullName || byId(me)?.name || "you");

  // ── snoozes (synced per person) ─────────────────────────────────────────
  const prefs = usePreferencesValue().tasksInbox;
  const prefsRef = useRef(prefs);
  useLayoutEffect(() => {
    prefsRef.current = prefs;
  });
  const mySnoozes = prefs.snoozed[workspaceId] ?? NO_SNOOZES;
  const writeSnoozes = useCallback(
    (change: (mine: Record<string, TasksInboxSnooze>) => Record<string, TasksInboxSnooze>) => {
      const all = prefsRef.current.snoozed;
      const next = change({ ...(all[workspaceId] ?? {}) });
      const snoozed = { ...all };
      if (Object.keys(next).length > 0) snoozed[workspaceId] = next;
      else delete snoozed[workspaceId];
      prefsRef.current = { snoozed };
      updatePreferences({ tasksInbox: { snoozed } });
    },
    [workspaceId],
  );

  const inboxOpen = useMemo(
    () =>
      inboxId ? tasks.filter((t) => t.bucketId === inboxId && !t.parentId && isOpenTask(t)) : [],
    [tasks, inboxId],
  );
  const split = useMemo(
    () => splitSnoozed(inboxOpen, mySnoozes, today, commentStamps),
    [inboxOpen, mySnoozes, today, commentStamps],
  );
  const snoozedIds = useMemo(() => new Set(split.snoozed.map((t) => t.id)), [split.snoozed]);

  // A snooze that ended brings its task back on top (research §7) and is
  // forgotten; one whose task left the Inbox is forgotten too. Each device
  // that sees it does the same, which lands the same way.
  const wokenKey = `${split.woken.join(",")}|${split.stale.join(",")}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key names what changed.
  useEffect(() => {
    // Only once a read reached the server this session (the device copy can
    // lack a task snoozed elsewhere, which would read as stale and be lost on
    // every device), online, and never while the module still holds another
    // workspace's tasks (a switch).
    if (!reachedServer || !inboxId || inbox?.workspaceId !== workspaceId) return;
    if (split.woken.length === 0 && split.stale.length === 0) return;
    if (canEdit && split.woken.length > 0) {
      const tops = tasks.filter((t) => t.bucketId === inboxId && !t.parentId && !t.deletedAt);
      let first: string | null = null;
      for (const t of tops) if (first === null || t.position < first) first = t.position;
      const keys = positionsBefore(split.woken.length, first);
      split.woken.forEach((id, i) => {
        const position = keys[i];
        if (position) patchTask(id, { position });
      });
    }
    const gone = new Set([...split.woken, ...split.stale]);
    writeSnoozes((mine) => {
      for (const id of gone) delete mine[id];
      return mine;
    });
  }, [wokenKey, reachedServer, inboxId]);

  const [showSnoozed, setShowSnoozed] = useState(false);
  const scope = useCallback(
    (inboxTasks: readonly Task[]) => {
      const active = inboxTasks.filter((t) => !snoozedIds.has(t.id));
      // Zero Inbox (nothing open on top level): the calm state, with
      // "3 snoozed · show" until asked, rather than a list of finished rows.
      const cleared = !active.some((t) => isOpenTask(t) && !t.parentId);
      if (cleared && !showSnoozed) return [];
      return [...active, ...inboxTasks.filter((t) => snoozedIds.has(t.id))];
    },
    [snoozedIds, showSnoozed],
  );

  // Anew only when the snoozed rows change: `split` is new on any task's edit,
  // and a new group array re-measures the whole List.
  const snoozedKey = split.snoozed.map((t) => t.id).join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key names the snoozed rows.
  const extraGroups = useMemo<readonly ListExtraGroup[]>(
    () =>
      split.snoozed.length === 0
        ? []
        : [
            {
              key: SNOOZED_KEY,
              place: "trail",
              label: "Snoozed",
              taskIds: split.snoozed.map((t) => t.id),
              folded: !showSnoozed,
              whenOf: (task) => {
                const entry = mySnoozes[task.id];
                return entry ? snoozedUntilLabel(entry.until, new Date()) : null;
              },
            },
          ],
    [snoozedKey, showSnoozed, mySnoozes],
  );

  // "via Claude Desktop" on what an agent captured (TV-U13b).
  const inboxIds = useMemo(() => inboxOpen.map((t) => t.id), [inboxOpen]);
  const agentVia = useAgentCaptures(runtime, workspaceId, inboxIds, enabled);
  const sourceOf = useCallback(
    (task: Task) =>
      inboxSourceLabel(
        task,
        me,
        (id) => {
          const person = byId(id);
          return person ? firstName(person.fullName || person.name) : null;
        },
        agentVia.get(task.id) ?? null,
      ),
    [me, byId, agentVia],
  );

  // ── the actions ─────────────────────────────────────────────────────────
  const latest = useRef({ selectedTaskId, inboxOpen, split });
  useLayoutEffect(() => {
    latest.current = { selectedTaskId, inboxOpen, split };
  });
  const taskOf = useCallback(
    (id: string) => read().liveTasks.find((t) => t.id === id) ?? null,
    [read],
  );

  /** After an action the cursor moves to the next row shown (else the one above). */
  const selectNextAfter = useCallback(
    (id: string) => {
      const snoozed = new Set(latest.current.split.snoozed.map((t) => t.id));
      const rows = visibleRows.current.filter(
        (t) => !t.parentId && isOpenTask(t) && !snoozed.has(t.id),
      );
      const i = rows.findIndex((t) => t.id === id);
      const next = i < 0 ? null : (rows[i + 1] ?? rows[i - 1] ?? null);
      onSelectTask(next?.id ?? null);
    },
    [onSelectTask, visibleRows],
  );

  const [open, setOpen] = useState<Open | null>(null);
  const close = useCallback(() => setOpen(null), []);

  const unsnooze = useCallback(
    (task: Task) => {
      writeSnoozes((mine) => {
        delete mine[task.id];
        return mine;
      });
      toast(`“${task.title || "Untitled"}” is back in your Inbox`);
    },
    [writeSnoozes],
  );

  const run = useCallback(
    (action: TriageAction, task: Task) => {
      if (!canEdit) return;
      if (task.parentId) {
        toast("Triage the task itself; its subtasks go with it.");
        return;
      }
      if (action === "snooze" && snoozedIds.has(task.id)) {
        unsnooze(task);
        return;
      }
      if (action === "decline" && declineMode(task, me) === "wont-do") {
        selectNextAfter(task.id);
        void dropTask({ taskId: task.id, status: "archived" }, "Won’t do");
        return;
      }
      setOpen({ kind: action, taskId: task.id });
    },
    [canEdit, snoozedIds, me, unsnooze, selectNextAfter, dropTask],
  );

  const onViewKey = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>, selected: Task | null) => {
      if (!enabled || !selected) return false;
      const action = triageActionFor(event);
      if (!action) return false;
      run(action, selected);
      return true;
    },
    [enabled, run],
  );

  // ── the bottom bar's triage row (82b) ───────────────────────────────────
  const selectedInInbox =
    enabled && canEdit && !!selectedTaskId && inboxOpen.some((t) => t.id === selectedTaskId);
  const mode = useMemo<BottomBarMode | null>(
    () =>
      selectedInInbox
        ? {
            id: "tasks:triage",
            label: "Triage",
            actions: TRIAGE_ACTIONS.map(({ action, label, key }) => ({
              id: action,
              label,
              keyHint: key,
              run: () => {
                const id = latest.current.selectedTaskId;
                const task = id ? taskOf(id) : null;
                if (task) run(action, task);
              },
            })),
          }
        : null,
    [selectedInInbox, run, taskOf],
  );
  useBottomBarModeOwner(mode);

  // ── what each dialog does ───────────────────────────────────────────────
  const openTask = open ? taskOf(open.taskId) : null;

  const accept = (project: Bucket) => {
    const task = openTask;
    close();
    if (!task) return;
    selectNextAfter(task.id);
    void dropTask(
      {
        taskId: task.id,
        bucketId: project.id,
        ...(me && task.assigneeId !== me ? { assigneeId: me } : {}),
      },
      `Filed in ${project.name}`,
    );
  };

  const decline = async (note: string) => {
    const task = openTask;
    close();
    if (!task || !runtime) return;
    const back = task.creatorId;
    const backName = firstName(byId(back)?.fullName || byId(back)?.name || "its maker");
    selectNextAfter(task.id);
    try {
      // The note first, while the task is still yours to comment on.
      await runtime.spine.addComment({
        workspaceId,
        entityType: "task",
        entityId: task.id,
        body: declineComment(myName, note),
      });
    } catch {
      toast.error("Couldn’t add the note, so the task stays with you.");
      return;
    }
    patchTask(task.id, { assigneeId: back });
    toast(`Handed back to ${backName}`);
  };

  const markDuplicate = async (original: Task) => {
    const task = openTask;
    close();
    if (!task || !runtime) return;
    selectNextAfter(task.id);
    let moved = 0;
    try {
      // Its links move over first (a re-run finds the moved ones gone), then
      // the two are linked, and its comments are copied last, once.
      const links = await runtime.spine.listLinks({
        workspaceId,
        entityType: "task",
        entityId: task.id,
      });
      for (const link of links) {
        const fromDup = link.sourceType === "task" && link.sourceId === task.id;
        const other = fromDup
          ? { type: link.targetType, id: link.targetId }
          : { type: link.sourceType, id: link.sourceId };
        if (other.type === "task" && other.id === original.id) continue;
        // A dependency is the duplicate's own (and could close a loop on the
        // original): it stays, and goes quiet with the Won't do.
        if (link.relationKind === "blocks") continue;
        // A "Mentioned in" line is the conversation's history: it stays put.
        if (isChatOwnedLink(link)) continue;
        const here = { type: "task", id: original.id };
        await runtime.spine.createLink({
          workspaceId,
          source: fromDup ? here : other,
          target: fromDup ? other : here,
          relationKind: link.relationKind,
          origin: link.origin,
        });
        await runtime.spine.deleteLink({ workspaceId, linkId: link.id });
        moved += 1;
      }
      await runtime.spine.createLink({
        workspaceId,
        source: { type: "task", id: task.id },
        target: { type: "task", id: original.id },
        relationKind: "references",
        origin: "manual",
      });
      // Its comments, copied to the task it duplicates (with who wrote each).
      const comments = await runtime.spine.listComments({
        workspaceId,
        entityType: "task",
        entityId: task.id,
      });
      const authorOf = (c: (typeof comments)[number]) =>
        c.authorKind === "api_key"
          ? (c.authorLabel ?? "An app")
          : c.createdBy
            ? firstName(byId(c.createdBy)?.fullName || byId(c.createdBy)?.name || "Someone")
            : "Someone";
      await runtime.spine.addComment({
        workspaceId,
        entityType: "task",
        entityId: original.id,
        body: duplicateComment(
          task.title,
          comments.map((c) => ({ author: authorOf(c), body: c.body })),
        ),
      });
    } catch {
      toast.error(
        moved > 0
          ? `Couldn’t finish: ${moved === 1 ? "1 link" : `${moved} links`} moved to “${original.title || "Untitled"}”; the task stays open.`
          : "Couldn’t merge it; the task stays open.",
      );
      return;
    }
    void dropTask(
      { taskId: task.id, status: "archived" },
      `Duplicate of “${original.title || "Untitled"}” · Won’t do`,
    );
  };

  const snooze = (until: string) => {
    const task = openTask;
    close();
    if (!task) return;
    // Preferences keep at most this many per workspace (the sanitiser drops the rest).
    if (Object.keys(mySnoozes).length >= MAX_SNOOZES) {
      toast(`${MAX_SNOOZES} tasks are snoozed here already; bring some back first.`);
      return;
    }
    selectNextAfter(task.id);
    const stamp = commentStamps.get(task.id) ?? null;
    writeSnoozes((mine) => ({ ...mine, [task.id]: { until, stamp } }));
    undoToast(`Snoozed ${snoozedUntilLabel(until, new Date())}`, {
      onUndo: () =>
        writeSnoozes((mine) => {
          delete mine[task.id];
          return mine;
        }),
    });
  };

  const projects = useMemo(() => buckets.filter((b) => !b.isSystem && !b.archivedAt), [buckets]);
  const originals = useMemo(
    () =>
      openTask
        ? tasks.filter(
            (t) =>
              t.id !== openTask.id && t.parentId !== openTask.id && !t.deletedAt && isOpenTask(t),
          )
        : [],
    [tasks, openTask],
  );

  const captureHint = captureShortcut ? formatShortcut(captureShortcut) : "⌘⇧K";
  const note = "Only you see your Inbox. File a task into a project or assign it, and it moves.";
  const emptyState = (
    <EmptyState
      icon={Inbox}
      title="Inbox is clear"
      description="New captures from anywhere, email and your agents land here, newest on top."
      action={
        canEdit ? (
          <Button variant="secondary" size="sm" onClick={() => dispatchOpenCapture()}>
            <Plus aria-hidden />
            Capture a task
          </Button>
        ) : undefined
      }
      hint={
        <span className="grid justify-items-center gap-1.5">
          <span>
            <Kbd>{captureHint}</Kbd> captures from anywhere in Moduo
          </span>
          {split.snoozed.length > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground tabular-nums"
              onClick={() => setShowSnoozed(true)}
            >
              {split.snoozed.length} snoozed · show
            </Button>
          ) : null}
        </span>
      }
    />
  );

  const dialogs = (
    <>
      {/* The search dialogs mount only while open: the kit's CommandDialog
          keeps its screen-reader title on the page while closed. */}
      {open?.kind === "accept" ? (
        <FileInDialog open task={openTask} projects={projects} onPick={accept} onClose={close} />
      ) : null}
      <DeclineDialog
        open={open?.kind === "decline"}
        task={open?.kind === "decline" ? openTask : null}
        toName={
          openTask
            ? firstName(byId(openTask.creatorId)?.fullName || byId(openTask.creatorId)?.name || "")
            : ""
        }
        onDecline={(text) => void decline(text)}
        onClose={close}
      />
      {open?.kind === "duplicate" ? (
        <DuplicateDialog
          open
          task={openTask}
          candidates={originals}
          projectName={(id) => buckets.find((b) => b.id === id)?.name ?? "Inbox"}
          onPick={(original) => void markDuplicate(original)}
          onClose={close}
        />
      ) : null}
      <SnoozeDialog
        open={open?.kind === "snooze"}
        task={open?.kind === "snooze" ? openTask : null}
        onSnooze={snooze}
        onPick={() => {
          if (open) setOpen({ kind: "snooze-pick", taskId: open.taskId });
        }}
        onClose={close}
      />
      <DayPickerDialog
        open={open?.kind === "snooze-pick"}
        title={`Snooze “${openTask?.title || "Untitled"}” until…`}
        onPick={(day) => {
          const until = todayStr(day);
          if (until <= todayStr(new Date())) {
            toast("Pick a day after today.");
            return;
          }
          snooze(until);
        }}
        onClose={close}
      />
    </>
  );

  return { scope, extraGroups, sourceOf, onViewKey, note, emptyState, dialogs };
}

const NO_SNOOZES: Readonly<Record<string, TasksInboxSnooze>> = {};

/** Accept (1): "File in…", already assigned to you. */
function FileInDialog({
  open,
  task,
  projects,
  onPick,
  onClose,
}: {
  open: boolean;
  task: Task | null;
  projects: readonly Bucket[];
  onPick: (project: Bucket) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const shown = projects.filter((p) => p.name.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setQuery("");
          onClose();
        }
      }}
      title={`File “${task?.title || "Untitled"}” in…`}
      description="Pick a project. The task is yours there."
      commandProps={{ shouldFilter: false, label: "Projects" }}
    >
      <CommandInput placeholder="File in…" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>
          {projects.length === 0
            ? "No projects yet. Make one with New project in the sidebar."
            : "No project matches."}
        </CommandEmpty>
        {shown.map((p) => (
          <CommandItem
            key={p.id}
            value={p.id}
            onSelect={() => {
              setQuery("");
              onPick(p);
            }}
          >
            <NavRowDot color={bucketDotColor(p)} />
            <span className="flex-1 truncate">{p.name}</span>
          </CommandItem>
        ))}
      </CommandList>
    </CommandDialog>
  );
}

/** Decline (2) on someone else's task: a one-line note, and back it goes. */
function DeclineDialog({
  open,
  task,
  toName,
  onDecline,
  onClose,
}: {
  open: boolean;
  task: Task | null;
  toName: string;
  onDecline: (note: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const done = (fn: () => void) => {
    fn();
    setText("");
  };
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : done(onClose))}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Hand “{task?.title || "Untitled"}” back</DialogTitle>
          <DialogDescription>
            It goes back to {toName || "whoever made it"} with your note.
          </DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={text}
          placeholder="A note (optional)"
          aria-label="Note"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") done(() => onDecline(text));
          }}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => done(onClose)}>
            Cancel
          </Button>
          <Button onClick={() => done(() => onDecline(text))}>
            Hand back{toName ? ` to ${toName}` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Duplicate of… (3): pick the task it repeats. */
function DuplicateDialog({
  open,
  task,
  candidates,
  projectName,
  onPick,
  onClose,
}: {
  open: boolean;
  task: Task | null;
  candidates: readonly Task[];
  projectName: (bucketId: string) => string;
  onPick: (original: Task) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const words = query.trim().toLowerCase();
  const shown = (
    words ? candidates.filter((t) => t.title.toLowerCase().includes(words)) : candidates
  ).slice(0, 30);
  return (
    <CommandDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setQuery("");
          onClose();
        }
      }}
      title={`“${task?.title || "Untitled"}” is a duplicate of…`}
      description="Its comments and links move to the task you pick; then it's marked Won't do."
      commandProps={{ shouldFilter: false, label: "Tasks" }}
    >
      <CommandInput placeholder="Duplicate of…" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>No open task matches.</CommandEmpty>
        {shown.map((t) => (
          <CommandItem
            key={t.id}
            value={t.id}
            onSelect={() => {
              setQuery("");
              onPick(t);
            }}
          >
            <span className="flex-1 truncate">{t.title || "Untitled"}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {projectName(t.bucketId)}
            </span>
          </CommandItem>
        ))}
      </CommandList>
    </CommandDialog>
  );
}

/** Snooze (H): Tomorrow · Next week · Pick…. */
function SnoozeDialog({
  open,
  task,
  onSnooze,
  onPick,
  onClose,
}: {
  open: boolean;
  task: Task | null;
  onSnooze: (until: string) => void;
  onPick: () => void;
  onClose: () => void;
}) {
  const choices = snoozeChoices(new Date());
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Snooze “{task?.title || "Untitled"}”</DialogTitle>
          <DialogDescription>
            It comes back on top on that day, or as soon as someone comments.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1">
          {choices.map((c, i) => (
            <Button
              key={c.label}
              autoFocus={i === 0}
              variant="ghost"
              className="justify-between"
              onClick={() => onSnooze(c.until)}
            >
              {c.label}
              <span className="text-xs text-muted-foreground">
                {snoozeDayLabel(c.until, new Date())}
              </span>
            </Button>
          ))}
          <Button variant="ghost" className="justify-start" onClick={onPick}>
            Pick a day…
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
