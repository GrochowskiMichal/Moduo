import type { Meta, StoryObj } from "@storybook/react";
import { Circle, GripVertical, Inbox } from "lucide-react";
import type * as React from "react";
import { cn } from "@/lib/utils";
import {
  DRAG_SOURCE,
  DROP_TARGET,
  DragOverlaySurface,
  InsertionLine,
  NestPreview,
} from "./drag-visuals";
import { Eyebrow } from "./eyebrow";

const meta: Meta<typeof InsertionLine> = {
  title: "Components/ui/drag-visuals",
  component: InsertionLine,
  decorators: [
    (Story) => (
      <div className="w-[560px] rounded-lg bg-card p-4">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

/** The row indent the list nests by; the line and the preview start here. */
const INDENT = 30;

function Row({ children, className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "relative flex h-(--row-h) items-center gap-2.5 rounded-md px-2 font-sans text-base text-foreground",
        className,
      )}
      {...props}
    >
      <Circle aria-hidden className="size-icon shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <Eyebrow tone="muted" className="px-2 pt-3 pb-1">
      {children}
    </Eyebrow>
  );
}

/** Every piece, in the states the Tasks comp draws. */
export const AllPieces: Story = {
  render: () => (
    <div className="flex flex-col">
      <Label>Reorder: insertion line between two rows</Label>
      <Row>Desktop auto-updater: GitHub-driven changelog</Row>
      <Row>
        <InsertionLine edge="top" indent={INDENT} />
        Make the GitHub Actions Windows build faster
      </Row>

      <Label>Nest: target tints, indented preview</Label>
      <Row className={DROP_TARGET}>Landing subpages per feature tab</Row>
      <NestPreview indent={INDENT}>Add technical documentation and update README</NestPreview>

      <Label>Drag source, left in place</Label>
      <Row className={DRAG_SOURCE}>Add technical documentation and update README</Row>

      <Label>Drop target in a rail</Label>
      <div
        className={cn(
          "flex h-(--row-h) items-center gap-2.5 rounded-md px-2 font-sans text-base text-foreground",
          DROP_TARGET,
        )}
      >
        <Inbox aria-hidden className="size-icon-sm text-muted-foreground" />
        Inbox
      </div>

      <Label>Drag overlay (follows the pointer)</Label>
      <div className="flex gap-6 px-2 pt-2 pb-3">
        <DragOverlaySurface className="w-64">
          <GripVertical aria-hidden className="size-icon-sm shrink-0 text-muted-foreground" />
          <span className="truncate">Add technical documentation</span>
        </DragOverlaySurface>
        <DragOverlaySurface className="w-64" count={3}>
          <GripVertical aria-hidden className="size-icon-sm shrink-0 text-muted-foreground" />
          <span className="truncate">Fix the trial 401 on boot</span>
        </DragOverlaySurface>
      </div>
    </div>
  ),
};

/** The line at the bottom edge and at depth 0, for a drop after the last row
 *  or at the top level. */
export const InsertionLineEdges: Story = {
  render: () => (
    <div className="flex flex-col">
      <Row>First row</Row>
      <Row>
        Last row
        <InsertionLine edge="bottom" indent={8} />
      </Row>
    </div>
  ),
};
