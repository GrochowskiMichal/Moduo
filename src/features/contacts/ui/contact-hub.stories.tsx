import type { Meta, StoryObj } from "@storybook/react";

import type { EntityLink, EntityRecord, EntityRef, RelationKind } from "@/lib/entity-links";
import { entityRefKey } from "../../spine/rollup";
import type { ActivityEntry } from "../../tasks/model";
import "../projectors";
import { buildContactRollup } from "../rollup";
import type { Contact } from "../model";
import { ContactHub } from "./contact-hub";

const NOW = new Date("2026-06-27T12:00:00Z");
const FOCUS: EntityRef = { type: "contact", id: "c1" };

const CONTACT: Contact = {
  id: "c1",
  workspaceId: "w",
  ownerId: "u1",
  name: "Dana Lee",
  email: "dana@acme.com",
  emails: [{ label: "work", value: "dana@acme.com", primary: true }],
  phone: null,
  phones: [],
  addresses: [],
  urls: [],
  dates: [],
  title: "Head of Ops",
  companyId: "co1",
  status: "active",
  custom: {},
  isFavorite: false,
  notesInline: "",
  avatarUrl: null,
  createdAt: "2026-06-01T00:00:00Z",
  updatedAt: "2026-06-25T00:00:00Z",
  deletedAt: null,
};

let seq = 0;
function link(other: EntityRef, kind: RelationKind, createdAt: string): EntityLink {
  seq += 1;
  return {
    id: `l${seq}`,
    workspaceId: "w",
    sourceType: FOCUS.type,
    sourceId: FOCUS.id,
    targetType: other.type,
    targetId: other.id,
    relationKind: kind,
    origin: "manual",
    createdBy: "u1",
    createdAt,
    deletedAt: null,
  };
}
function rec(ref: EntityRef, label: string, deleted = false): EntityRecord {
  return { workspaceId: "w", type: ref.type, id: ref.id, label, icon: null, deletedAt: deleted ? "2026-06-26T00:00:00Z" : null };
}
function activity(op: string, createdAt: string, label = "Mike"): ActivityEntry {
  return {
    id: `a-${createdAt}`,
    workspaceId: "w",
    module: "contacts",
    entityType: "contact",
    entityId: "c1",
    op,
    actorType: "user",
    actorId: "u2",
    actorLabel: label,
    payload: op === "links.create" ? { relation_kind: "follow-up" } : {},
    createdAt,
  };
}

const t1: EntityRef = { type: "task", id: "t1" };
const gone: EntityRef = { type: "task", id: "tg" };
const inv: EntityRef = { type: "payment", id: "p1" };
const note: EntityRef = { type: "note", id: "n1" };

const LINKS = [
  link(t1, "follow-up", "2026-06-24T09:00:00Z"),
  link(gone, "references", "2026-06-23T09:00:00Z"),
  link(inv, "paid-by", "2026-06-22T09:00:00Z"),
  link(note, "mentions", "2026-06-21T09:00:00Z"),
];
const RECORDS = new Map<string, EntityRecord>([
  [entityRefKey(t1), rec(t1, "Send the proposal")],
  [entityRefKey(gone), rec(gone, "Removed task", true)],
  [entityRefKey(inv), rec(inv, "Invoice #1043 — $4,200")],
  [entityRefKey(note), rec(note, "Account plan")],
]);
const ACTIVITY = [
  activity("contacts.set_status", "2026-06-25T10:00:00Z", "You"),
  activity("links.create", "2026-06-24T09:00:00Z"),
];

const ROLLUP = buildContactRollup({
  focus: FOCUS,
  links: LINKS,
  records: RECORDS,
  activity: ACTIVITY,
  openTaskKeys: new Set([entityRefKey(t1)]),
});

const meta: Meta<typeof ContactHub> = {
  title: "Contacts/ContactHub",
  component: ContactHub,
  decorators: [
    (Story) => (
      <div className="h-[640px] w-[760px] overflow-hidden rounded-lg border border-border bg-background">
        <Story />
      </div>
    ),
  ],
  args: { now: NOW, currentUserId: "u2" },
};

export default meta;
type Story = StoryObj<typeof meta>;

/** The great moment: an editable header, a quiet last-touch line, grouped roll-up, activity. */
export const Populated: Story = {
  args: { contact: CONTACT, rollup: ROLLUP, hubStatus: "ready", activity: ACTIVITY, canEdit: true },
};

/** A brand-new contact — the spine's teaching empty-state, not a blank pane. */
export const EmptyRollup: Story = {
  args: {
    contact: { ...CONTACT, status: "lead" },
    rollup: buildContactRollup({ focus: FOCUS, links: [], records: new Map(), activity: [], openTaskKeys: new Set() }),
    hubStatus: "ready",
    activity: [],
    canEdit: true,
  },
};

/** Roll-up loading — skeleton rows; the header renders immediately from the cached row. */
export const Loading: Story = {
  args: { contact: CONTACT, rollup: ROLLUP, hubStatus: "loading", activity: ACTIVITY, canEdit: true },
};

/** Read-only (no edit permission): header fields + link gestures are disabled. */
export const PermissionDenied: Story = {
  args: { contact: CONTACT, rollup: ROLLUP, hubStatus: "ready", activity: ACTIVITY, canEdit: false },
};

/** A tombstoned linked entity renders dimmed as "Deleted [type]" with Remove link. */
export const Tombstone: Story = {
  args: {
    contact: CONTACT,
    rollup: buildContactRollup({
      focus: FOCUS,
      links: [link(gone, "references", "2026-06-23T09:00:00Z"), link(t1, "follow-up", "2026-06-24T09:00:00Z")],
      records: new Map([
        [entityRefKey(gone), rec(gone, "Removed task", true)],
        [entityRefKey(t1), rec(t1, "Send the proposal")],
      ]),
      activity: ACTIVITY,
      openTaskKeys: new Set([entityRefKey(t1)]),
    }),
    hubStatus: "ready",
    activity: ACTIVITY,
    canEdit: true,
  },
};
