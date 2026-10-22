import type { FocusTimerMode } from "@contracts/vocabularies";
import type { Meta, StoryObj } from "@storybook/react";
import { type ReactNode, useState } from "react";

import {
  __resetFocusEngineForTest,
  attachFocusUser,
  bindFocusTask,
  startFocus,
} from "../../focus/engine";
import { makeTask } from "../helpers";
import type { Task, TaskSession } from "../model";
import { queueEntry } from "../testing/fake-tasks";
import { FocusView } from "./focus-view";
import { BUCKETS, INBOX, StoryTasks, TeamWorkspace } from "./tasks-stories-fixtures";

// The Focus screen (TV-F7; prototype round-2a frames 1–3): running Per task,
// Pomodoro, Timer off, and nothing lined up. Visual captures are a deliberate
// human run (tests/visual/focus.spec.ts).

const WS = "w1";
const ME = "storybook-user";

function task(id: string, title: string, over: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: WS, bucketId: "b-app", title, position: id }),
    id,
    assigneeId: ME,
    ...over,
  };
}

const NOW = task("draft", "Draft the launch announcement", {
  description:
    "<p>One post for the blog, cut down for the newsletter and LinkedIn. Lead with what changes for people already on the old plans.</p><p>Keep it under 400 words and link the changelog.</p>",
  estimateMinutes: 45,
  priority: "high",
});
const SUBTASKS = [
  task("monogram", "Refine the monogram", { parentId: "draft", status: "done" }),
  task("wordmark", "Refine the wordmark", { parentId: "draft", description: "<p>Kerning.</p>" }),
  task("card", "Mock up on a business card", { parentId: "draft" }),
];
const UP_NEXT = [
  task("typo", "Fix signup email typo", { bucketId: "b-landing", estimateMinutes: 10 }),
  task("pricing", "Finalize pricing page copy", { estimateMinutes: 30 }),
  task("nav", "Fix mobile nav overlap", { bucketId: "b-landing", estimateMinutes: 15 }),
];

function at(hour: number, minute = 0): string {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

const TODAY = [
  task("logo", "Logo concepts round 2"),
  task("review", "Review the onboarding copy", { bucketId: "b-landing" }),
];
const SESSIONS: TaskSession[] = [
  {
    id: "s1",
    workspaceId: WS,
    taskId: "logo",
    userId: ME,
    startsAt: at(9, 30),
    endsAt: at(10, 30),
    updatedAt: at(8),
  },
  {
    id: "s2",
    workspaceId: WS,
    taskId: "review",
    userId: ME,
    startsAt: at(15),
    endsAt: at(16),
    updatedAt: at(8),
  },
];

/** What the store reads: the tasks, my line-up in order, and today's sessions. */
function seedFor(queued: Task[], all: Task[], sessions: TaskSession[] = []) {
  return {
    buckets: [INBOX, ...BUCKETS],
    tasks: all,
    queue: queued.map((t, i) =>
      queueEntry(t.id, ME, { workspaceId: WS, position: String.fromCharCode(97 + i) }),
    ),
    sessions,
  };
}

/** A session on the Now task with `timer`, set up before the screen draws. */
function Session({ timer, children }: { timer: FocusTimerMode | null; children: ReactNode }) {
  useState(() => {
    __resetFocusEngineForTest({ alert: () => {} });
    attachFocusUser(ME);
    if (timer) {
      bindFocusTask({ id: NOW.id, title: NOW.title, bucketName: "Moduo App", workspaceId: WS });
      startFocus(timer);
    }
    return null;
  });
  return <>{children}</>;
}

function Screen({ timer, empty = false }: { timer: FocusTimerMode | null; empty?: boolean }) {
  const queued = empty ? [] : [NOW, ...UP_NEXT];
  const all = empty ? TODAY : [NOW, ...SUBTASKS, ...UP_NEXT];
  return (
    <Session timer={timer}>
      <StoryTasks seed={seedFor(queued, all, empty ? SESSIONS : [])} userId={ME} workspaceId={WS}>
        <div className="h-screen bg-background p-4">
          <FocusView
            workspaceId={WS}
            runtime={null}
            canEdit
            bucketNameById={(id) => BUCKETS.find((b) => b.id === id)?.name ?? "Inbox"}
            selectedTaskId={null}
            onSelectTask={() => {}}
            onOpenTask={() => {}}
            panelTaskId={null}
            onRequestCapture={() => {}}
            dndMode="internal"
          />
        </div>
      </StoryTasks>
    </Session>
  );
}

const meta = {
  title: "Tasks/FocusView",
  component: Screen,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <TeamWorkspace>
        <Story />
      </TeamWorkspace>
    ),
  ],
} satisfies Meta<typeof Screen>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Lined up, nothing started: the card offers Start. */
export const Ready: Story = { args: { timer: null } };
/** Per task: one pill on the card, Pause inside it. */
export const RunningPerTask: Story = { args: { timer: "per_task" } };
/** Pomodoro: the rhythm pill sits in the header beside ⋯; none on the card. */
export const Pomodoro: Story = { args: { timer: "pomodoro" } };
/** Timer off: no pill at all; Done and Skip still work. */
export const TimerOff: Story = { args: { timer: "off" } };
/** Nothing lined up: the three ways in, with today's scheduled tasks as rows. */
export const NothingLinedUp: Story = { args: { timer: null, empty: true } };
