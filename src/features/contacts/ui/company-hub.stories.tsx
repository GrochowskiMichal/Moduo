import type { Meta, StoryObj } from "@storybook/react";

import type { EntityLink, EntityRecord, EntityRef } from "@/lib/entity-links";
import { entityRefKey } from "../../spine/rollup";
import "../projectors";
import { buildCompanyRollup } from "../company";
import type { Company, Contact } from "../model";
import { CompanyHub } from "./company-hub";

const NOW = new Date("2026-06-27T12:00:00Z");
const COMPANY_REF: EntityRef = { type: "company", id: "co1" };

const COMPANY: Company = {
  id: "co1",
  workspaceId: "w",
  ownerId: "u1",
  name: "Acme Corp",
  domains: ["acme.com"],
  website: null,
  custom: {},
  notesInline: "",
  avatarUrl: null,
  createdAt: "2026-06-01T00:00:00Z",
  updatedAt: "2026-06-20T00:00:00Z",
  deletedAt: null,
};

let seq = 0;
function link(source: EntityRef, target: EntityRef, kind: EntityLink["relationKind"]): EntityLink {
  seq += 1;
  return {
    id: `l${seq}`,
    workspaceId: "w",
    sourceType: source.type,
    sourceId: source.id,
    targetType: target.type,
    targetId: target.id,
    relationKind: kind,
    origin: "manual",
    createdBy: "u1",
    createdAt: "2026-06-20T09:00:00Z",
    deletedAt: null,
  };
}
function rec(ref: EntityRef, label: string): EntityRecord {
  return { workspaceId: "w", type: ref.type, id: ref.id, label, icon: null, deletedAt: null };
}
function member(over: Partial<Contact>): Contact {
  return {
    id: "c0",
    workspaceId: "w",
    ownerId: "u1",
    name: "",
    email: null,
    emails: [],
    phone: null,
    phones: [],
    addresses: [],
    urls: [],
    dates: [],
    title: null,
    companyId: "co1",
    status: "active",
    custom: {},
    isFavorite: false,
    notesInline: "",
    avatarUrl: null,
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-20T00:00:00Z",
    deletedAt: null,
    ...over,
  };
}

const dana: EntityRef = { type: "contact", id: "c1" };
const taskA: EntityRef = { type: "task", id: "t1" };
const noteA: EntityRef = { type: "note", id: "n1" };

const POPULATED = buildCompanyRollup({
  company: COMPANY_REF,
  companyLinks: [],
  members: [member({ id: "c1", name: "Dana Lee", title: "Head of ops" })],
  memberLinks: { c1: [link(dana, taskA, "follow-up"), link(dana, noteA, "references")] },
  records: new Map([
    [entityRefKey(taskA), rec(taskA, "Send proposal")],
    [entityRefKey(noteA), rec(noteA, "Account plan")],
  ]),
});

const meta: Meta<typeof CompanyHub> = {
  title: "Contacts/CompanyHub",
  component: CompanyHub,
  parameters: { layout: "fullscreen" },
  args: { company: COMPANY, now: NOW, activity: [], currentUserId: "u1" },
};
export default meta;
type Story = StoryObj<typeof meta>;

/** People group + the union of their work rolled up to the company. */
export const Populated: Story = {
  args: { rollup: POPULATED, status: "ready" },
};

/** A fresh company with no people or linked work yet. */
export const Empty: Story = {
  args: { rollup: { people: [], unionSections: [], lastTouchAt: null, lastTouchActivity: null }, status: "ready" },
};
