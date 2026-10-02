import type { Meta, StoryObj } from "@storybook/react";
import type { ContactImportResult } from "../import";
import type { Company, Contact } from "../model";
import { ContactImportDialog, type ImportDialogSeed } from "./contact-import-dialog";

// One existing contact so the preview shows a real email-match merge.
const EXISTING_CONTACTS: Contact[] = [
  {
    id: "c1",
    workspaceId: "w",
    ownerId: "u",
    name: "Dana Lee",
    email: "dana@acme.com",
    emails: [{ label: "work", value: "dana@acme.com", primary: true }],
    phone: null,
    phones: [],
    addresses: [],
    urls: [],
    dates: [],
    title: "Head of ops",
    companyId: null,
    status: "active",
    custom: {},
    isFavorite: false,
    notesInline: "",
    avatarUrl: null,
    createdAt: "2026-06-01T00:00:00Z",
    updatedAt: "2026-06-20T00:00:00Z",
    deletedAt: null,
  },
];
const EXISTING_COMPANIES: Company[] = [];

// A CSV with one of each fate: merge (existing email), create, duplicate
// (repeat email in-file), and error (no name).
const SEED: ImportDialogSeed = {
  fileName: "contacts.csv",
  headers: ["Name", "Email", "Status"],
  rows: [
    ["Dana Lee", "dana@acme.com", ""],
    ["Mara Quinn", "mara@beta.io", "Lead"],
    ["Mara Dup", "mara@beta.io", ""],
    ["", "ghost@x.io", ""],
  ],
};

const noopImport = async (): Promise<ContactImportResult> => ({
  created: 0,
  merged: 0,
  createdIds: [],
  mergedIds: [],
});

const meta: Meta<typeof ContactImportDialog> = {
  title: "Contacts/ContactImportDialog",
  component: ContactImportDialog,
  parameters: { layout: "centered" },
  args: {
    open: true,
    onOpenChange: () => {},
    existingContacts: EXISTING_CONTACTS,
    existingCompanies: EXISTING_COMPANIES,
    onImport: noopImport,
  },
};
export default meta;
type Story = StoryObj<typeof meta>;

/** Step 2 — match CSV columns to contact fields (auto-guessed). */
export const Mapping: Story = {
  args: { seed: { ...SEED, step: "map" } },
};

/** Step 3 — dedupe preview: every row's fate before anything is saved. */
export const DedupePreview: Story = {
  args: { seed: { ...SEED, step: "preview" } },
};
