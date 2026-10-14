import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import type { AttachmentRecord, ModuoRuntime } from "@/lib/runtime.types";
import type { UploadView } from "@/lib/uploads/queue";
import { AttachmentStrip, type AttachmentStripProps } from "./attachment-strip";
import { AttachmentViewer } from "./attachment-viewer";

// The attachment strip under a task's description (comp §5 `.attstrip`) and
// every tile state (AT2-2, AT2-4). Visual captures are a deliberate human run
// (tests/visual/attachments.spec.ts).

const MB = 1048576;
const GB = 1073741824;

/** A flat picture standing in for a screenshot (no network in stories). */
function picture(fill: string, accent: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='110'><rect width='160' height='110' fill='${fill}'/><rect x='12' y='14' width='90' height='10' rx='3' fill='${accent}'/><rect x='12' y='32' width='130' height='6' rx='3' fill='${accent}' opacity='.5'/><rect x='12' y='46' width='110' height='6' rx='3' fill='${accent}' opacity='.5'/></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function rec(id: string, over: Partial<AttachmentRecord> = {}): AttachmentRecord {
  return {
    id,
    entityType: "task",
    entityId: "t1",
    uploaderId: "u1",
    fileName: `${id}.png`,
    mime: "image/png",
    sizeBytes: 420_000,
    width: 2880,
    height: 1800,
    status: "ready",
    deletedAt: null,
    createdAt: "2026-10-09T10:00:00Z",
    objectPath: `w/${id}/original.png`,
    previewPath: `w/${id}/preview.png`,
    previewMime: "image/png",
    ...over,
  };
}

const RECORDS: AttachmentRecord[] = [
  rec("black-background"),
  rec("settings-panel"),
  rec("spec", {
    fileName: "Landing brief v3.pdf",
    mime: "application/pdf",
    sizeBytes: 2.4 * MB,
    previewPath: null,
    width: null,
    height: null,
  }),
];

const PREVIEWS = new Map([
  ["w/black-background/preview.png", picture("dimgray", "gainsboro")],
  ["w/settings-panel/preview.png", picture("darkslategray", "silver")],
]);

function upload(id: string, over: Partial<UploadView>): UploadView {
  return {
    id,
    userId: "u1",
    target: { workspaceId: "w", entityType: "task", entityId: "t1" },
    batchId: "b1",
    fileName: `${id}.png`,
    mime: "image/png",
    sizeBytes: 3 * MB,
    preview: null,
    previewMime: null,
    width: null,
    height: null,
    attachmentId: null,
    objectPath: null,
    previewPath: null,
    begunAt: null,
    originalSent: false,
    previewSent: false,
    attempts: 0,
    refusals: 0,
    nextRetryAt: 0,
    state: "queued",
    problem: null,
    createdAt: 1,
    loaded: 0,
    total: 3 * MB,
    ...over,
  };
}

const noop = () => {};
const BASE: AttachmentStripProps = {
  records: RECORDS,
  previews: PREVIEWS,
  uploads: [],
  almostFull: null,
  canEdit: true,
  isOwner: true,
  onAddFiles: noop,
  onOpen: noop,
  onRetry: noop,
  onDismiss: noop,
  onDismissAlmostFull: noop,
  onUpgrade: noop,
};

const meta: Meta<typeof AttachmentStrip> = {
  title: "Attachments/AttachmentStrip",
  component: AttachmentStrip,
  decorators: [
    (Story) => (
      <div className="w-(--width-rail) p-4">
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof AttachmentStrip>;

export const Ready: Story = { args: BASE };

export const Empty: Story = { args: { ...BASE, records: [] } };

export const ReadOnly: Story = { args: { ...BASE, canEdit: false } };

export const Uploading: Story = {
  args: {
    ...BASE,
    uploads: [
      upload("clip", {
        fileName: "screen-recording.mov",
        mime: "video/quicktime",
        sizeBytes: 38 * MB,
        state: "uploading",
        loaded: 14 * MB,
        total: 38 * MB,
      }),
      upload("next", { fileName: "notes.txt", mime: "text/plain", sizeBytes: 12_000 }),
    ],
  },
};

/** Every problem state: its caption and its one way forward (AT2-4). */
export const Problems: Story = {
  args: {
    ...BASE,
    records: RECORDS.slice(0, 1),
    uploads: [
      upload("offline", {
        fileName: "whiteboard.jpg",
        mime: "image/jpeg",
        state: "waiting",
        problem: { kind: "offline" },
      }),
      upload("dropped", {
        fileName: "export.zip",
        mime: "application/zip",
        state: "waiting",
        problem: { kind: "interrupted" },
      }),
      upload("failed", {
        fileName: "report.pdf",
        mime: "application/pdf",
        state: "failed",
        problem: { kind: "failed" },
      }),
      upload("full", {
        fileName: "mockup.png",
        state: "waiting",
        problem: { kind: "storage_full", usedBytes: 2 * GB, totalBytes: 2 * GB, tier: "free" },
      }),
      upload("big", {
        batchId: "b2",
        fileName: "demo.mov",
        mime: "video/quicktime",
        sizeBytes: 30 * MB,
        state: "rejected",
        problem: { kind: "too_large", sizeBytes: 30 * MB, perFileBytes: 20 * MB, tier: "free" },
      }),
    ],
    almostFull: { usedBytes: 1.93 * GB, totalBytes: 2 * GB },
  },
};

export const ProblemsAsMember: Story = {
  args: { ...Problems.args, isOwner: false },
};

const viewerRuntime = {
  attachments: {
    signedUrls: async (paths: string[]) =>
      new Map(paths.map((p) => [p, PREVIEWS.get(p.replace("original", "preview")) ?? ""])),
  },
} as unknown as ModuoRuntime;

function ViewerDemo({ start }: { start: number }) {
  const [index, setIndex] = useState<number | null>(start);
  return (
    <AttachmentViewer
      runtime={viewerRuntime}
      records={RECORDS}
      previews={PREVIEWS}
      index={index}
      onIndexChange={setIndex}
      canEdit
      onDelete={noop}
    />
  );
}

export const Viewer: Story = { render: () => <ViewerDemo start={0} /> };

export const ViewerFile: Story = { render: () => <ViewerDemo start={2} /> };
