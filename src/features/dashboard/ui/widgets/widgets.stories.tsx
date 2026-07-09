import type { Meta, StoryObj } from "@storybook/react";
import { useEffect } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { NeedsAttentionItem } from "@/features/contacts/needs-attention";
import type { ReconnectItem } from "@/features/contacts/reconnect";
import type { RecentNoteRow } from "@/features/notes/recent";
import type { NotificationItem } from "@/features/spine/notifications";
import type { RecentLinkItem } from "@/features/spine/recent";
import type { TasksModuleBundle } from "@/features/tasks/model";
import type { HabitRow } from "@/lib/runtime.types";

import {
  DashboardDataContext,
  loadedSource,
  makeMockDashboardData,
  type DashboardData,
} from "../../context/dashboard-data-context";
import type { WidgetInstance, WidgetSize } from "../../engine/types";
import type { WidgetType } from "../../engine/types";
import type { WidgetDensity } from "../../widget-density";
import { WidgetFrame } from "../widget-frame";

// DB-5 (AC2/AC7/AC13, visual layer): the 9 module widgets in their frames, plus a
// density knob to show content responding while spans hold. Storybook render is
// blocked in worktrees (gotchas) — these are the human-capture baselines for DB-8.

const ISO = "2026-07-09T09:00:00.000Z";

const SAMPLE_LINKS = [
  {
    id: "l1",
    relationKind: "references",
    origin: "manual",
    createdAt: ISO,
    source: { type: "task", id: "t1", label: "Ship the dashboard", icon: null, tombstoned: false },
    target: { type: "note", id: "n1", label: "DB-5 spec", icon: null, tombstoned: false },
  },
  {
    id: "l2",
    relationKind: "references",
    origin: "suggest",
    createdAt: ISO,
    source: { type: "contact", id: "c1", label: "Jane Rivera", icon: null, tombstoned: false },
    target: { type: "company", id: "co1", label: "Acme", icon: null, tombstoned: false },
  },
] as unknown as RecentLinkItem[];

const SAMPLE_NEEDS_ATTENTION = [
  { contactId: "c1", name: "Jane Rivera", status: "active", reason: "overdue-followup", detail: "2 days overdue" },
  { contactId: "c2", name: "Sam Okafor", status: "lead", reason: "stale-lead", detail: "no touch 31 days" },
  { contactId: "c3", name: "Priya Patel", status: "active", reason: "no-touch", detail: "18 days" },
] as unknown as NeedsAttentionItem[];

const SAMPLE_RECONNECT: ReconnectItem[] = [
  { contactId: "c4", name: "Diego Alvarez", lastTouchAt: ISO, daysSince: 42 },
  { contactId: "c5", name: "Mina Lee", lastTouchAt: ISO, daysSince: 60 },
];

const SAMPLE_NOTES: RecentNoteRow[] = [
  { id: "n1", title: "DB-5 spec", bodyText: "Registry + widgets…", updatedAt: ISO, isArchived: false, publishedAt: ISO },
  { id: "n2", title: "Weekly sync", bodyText: "Agenda and notes", updatedAt: ISO, isArchived: false, publishedAt: null },
];

const SAMPLE_NOTIFICATIONS = [
  {
    id: "no1",
    source: "spine",
    workspaceId: "ws-mock",
    actorId: "u2",
    actorName: "Sam",
    targetType: "task",
    targetId: "t1",
    op: "comment.add",
    payload: {},
    createdAt: ISO,
    readAt: null,
  },
] as unknown as NotificationItem[];

const SAMPLE_TASKS = {
  buckets: [],
  tags: [],
  tagLinks: [],
  taskRelations: [],
  tasks: [
    { id: "t1", title: "Ship the dashboard", status: "todo", committedFor: null, commitOrder: 0, position: "a0", deletedAt: null },
    { id: "t2", title: "Review the widget PR", status: "todo", committedFor: null, commitOrder: 1, position: "a1", deletedAt: null },
    { id: "t3", title: "Write the test checklist", status: "in_progress", committedFor: null, commitOrder: 2, position: "a2", deletedAt: null },
  ],
} as unknown as TasksModuleBundle;

const SAMPLE_HABITS: HabitRow[] = [
  { id: "h1", workspaceId: "ws-mock", name: "Meditate", emoji: "🧘", position: "a0000", checks: ["2026-07-07", "2026-07-08", "2026-07-09"], createdAt: ISO, updatedAt: ISO },
  { id: "h2", workspaceId: "ws-mock", name: "Read", emoji: "📚", position: "a0001", checks: ["2026-07-08"], createdAt: ISO, updatedAt: ISO },
  { id: "h3", workspaceId: "ws-mock", name: "Run", emoji: "🏃", position: "a0002", checks: [], createdAt: ISO, updatedAt: ISO },
];

const MOCK_DATA: DashboardData = makeMockDashboardData({
  recentLinks: loadedSource(SAMPLE_LINKS),
  needsAttention: loadedSource(SAMPLE_NEEDS_ATTENTION),
  reconnect: loadedSource(SAMPLE_RECONNECT),
  recentNotes: loadedSource(SAMPLE_NOTES),
  notifications: loadedSource(SAMPLE_NOTIFICATIONS),
  tasks: loadedSource(SAMPLE_TASKS),
  habits: loadedSource(SAMPLE_HABITS),
});

const CELL: Record<WidgetSize, { width: number; height: number }> = {
  S: { width: 200, height: 190 },
  M: { width: 400, height: 190 },
  L: { width: 400, height: 392 },
  XL: { width: 812, height: 190 },
};

function frame(type: WidgetType, size: WidgetSize): WidgetInstance {
  return { id: `${type}-${size}`, type, size, x: 0, y: 0, config: {} };
}

function Gallery({ density }: { density: WidgetDensity }) {
  // useDensity reads the <html> attribute — set it for the story.
  useEffect(() => {
    const prev = document.documentElement.getAttribute("data-density");
    document.documentElement.setAttribute("data-density", density);
    return () => {
      if (prev) document.documentElement.setAttribute("data-density", prev);
      else document.documentElement.removeAttribute("data-density");
    };
  }, [density]);

  const items: Array<[WidgetType, WidgetSize]> = [
    ["tasks", "L"],
    ["calendar", "M"],
    ["needs-attention", "S"],
    ["reconnect", "S"],
    ["recently-linked", "M"],
    ["activity", "M"],
    ["notes", "M"],
    ["email", "M"],
    ["timetracking", "S"],
    // DB-6 / DB-7:
    ["habits", "L"],
    ["clock", "S"],
    ["pomodoro", "S"],
    ["countdown", "S"],
    ["weather", "S"],
    ["quick-capture", "S"],
    ["pinned", "S"],
  ];

  return (
    <TooltipProvider>
      <DashboardDataContext.Provider value={MOCK_DATA}>
        <div className="flex flex-wrap items-start gap-3 bg-background p-4">
          {items.map(([type, size]) => (
            <div key={`${type}-${size}`} style={{ width: CELL[size].width, height: CELL[size].height }}>
              <WidgetFrame widget={frame(type, size)} />
            </div>
          ))}
        </div>
      </DashboardDataContext.Provider>
    </TooltipProvider>
  );
}

const meta: Meta<typeof Gallery> = {
  title: "Features/dashboard/widgets",
  component: Gallery,
  args: { density: "comfortable" },
};

export default meta;
type Story = StoryObj<typeof meta>;

/** The catalog at a comfortable density. */
export const Comfortable: Story = { args: { density: "comfortable" } };

/** Compact density — the same cells show one more row each (AC13). */
export const Compact: Story = { args: { density: "compact" } };

/** Dense density — Linear/Notion-level; the most rows per cell (AC13). */
export const Dense: Story = { args: { density: "dense" } };
