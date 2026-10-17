import type { Meta, StoryObj } from "@storybook/react";

import type { EntityLink, EntityRecord, EntityRef, RelationKind } from "@/lib/entity-links";
import { entityRefKey, rollupSections } from "../rollup";
import { EntityHub } from "./entity-hub";

const FOCUS: EntityRef = { type: "contact", id: "acme" };

let seq = 0;
function link(other: EntityRef, kind: RelationKind): EntityLink {
  seq += 1;
  return {
    id: `l${seq}`,
    workspaceId: "w1",
    sourceType: FOCUS.type,
    sourceId: FOCUS.id,
    targetType: other.type,
    targetId: other.id,
    relationKind: kind,
    origin: "manual",
    createdBy: "u1",
    createdAt: `2026-06-25T00:00:${String(seq).padStart(2, "0")}Z`,
    deletedAt: null,
  };
}
function rec(ref: EntityRef, label: string, deleted = false): EntityRecord {
  return {
    workspaceId: "w1",
    type: ref.type,
    id: ref.id,
    label,
    icon: null,
    deletedAt: deleted ? "2026-06-25T01:00:00Z" : null,
  };
}

// A realistic Acme Corp hub: open work, money, conversations, notes, other.
const refs = {
  t1: { type: "task", id: "t1" } as EntityRef,
  t2: { type: "task", id: "t2" } as EntityRef,
  inv: { type: "payment", id: "p1" } as EntityRef,
  e1: { type: "email", id: "e1" } as EntityRef,
  e2: { type: "email", id: "e2" } as EntityRef,
  n1: { type: "note", id: "n1" } as EntityRef,
  co: { type: "company", id: "co1" } as EntityRef,
  gone: { type: "task", id: "tg" } as EntityRef,
};

const POPULATED_LINKS = [
  link(refs.t1, "blocks"),
  link(refs.t2, "spawned-from"),
  link(refs.gone, "references"),
  link(refs.inv, "paid-by"),
  link(refs.e1, "attachment"),
  link(refs.e2, "mentions"),
  link(refs.n1, "references"),
  link(refs.co, "works-at"),
];
const POPULATED_RECORDS = new Map<string, EntityRecord>(
  [
    rec(refs.t1, "Ship the launch page"),
    rec(refs.t2, "Draft the proposal"),
    rec(refs.gone, "Removed task", true),
    rec(refs.inv, "Invoice #1043 — $4,200"),
    rec(refs.e1, "Re: timeline"),
    rec(refs.e2, "Kickoff notes"),
    rec(refs.n1, "Account plan"),
    rec(refs.co, "Acme Corp"),
  ].map((r) => [entityRefKey({ type: r.type, id: r.id }), r]),
);

const POPULATED_SECTIONS = rollupSections(FOCUS, POPULATED_LINKS, POPULATED_RECORDS);

// A large "Open work" section to exercise "Show all (N)".
const manyRefs = Array.from({ length: 12 }, (_, i): EntityRef => ({ type: "task", id: `mt${i}` }));
const MANY_SECTIONS = rollupSections(
  FOCUS,
  manyRefs.map((r) => link(r, "references")),
  new Map(manyRefs.map((r, i) => [entityRefKey(r), rec(r, `Task ${i + 1}`)])),
);

const meta: Meta<typeof EntityHub> = {
  title: "Spine/EntityHub",
  component: EntityHub,
  decorators: [
    (Story) => (
      <div className="w-96 rounded-lg border border-border bg-card p-4">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

/** The roll-up: links grouped into the fixed sections, each row a snippet + kind. */
export const Populated: Story = {
  args: { status: "ready", sections: POPULATED_SECTIONS, canEdit: true },
};

/** No links yet — a quiet teaching empty state, never an error tone. */
export const Empty: Story = {
  args: { status: "ready", sections: [], canEdit: true },
};

/** Skeleton rows with reserved height — no layout shift while loading. */
export const Loading: Story = {
  args: { status: "loading", sections: [] },
};

/** A tombstoned target renders dimmed as "Deleted [type]" with the link still visible. */
export const Tombstone: Story = {
  args: {
    status: "ready",
    canEdit: true,
    sections: rollupSections(
      FOCUS,
      [link(refs.gone, "references"), link(refs.t1, "blocks")],
      new Map(
        [rec(refs.gone, "Removed task", true), rec(refs.t1, "Ship the launch page")].map((r) => [
          entityRefKey({ type: r.type, id: r.id }),
          r,
        ]),
      ),
    ),
  },
};

/** Long section collapses behind "Show all (N)" with a live count. */
export const ShowAll: Story = {
  args: { status: "ready", sections: MANY_SECTIONS, canEdit: true },
};

/** Read-only (no edit permission): link gestures are absent. */
export const ReadOnly: Story = {
  args: { status: "ready", sections: POPULATED_SECTIONS, canEdit: false },
};

/** RPC failure — a quiet retry, the link is never silently lost. */
export const ErrorState: Story = {
  args: { status: "error", sections: [], onRetry: () => {} },
};

/** Center-pane variant (Contacts), roomier spacing; same component. */
export const PageVariant: Story = {
  args: { status: "ready", sections: POPULATED_SECTIONS, canEdit: true, variant: "page" },
};
