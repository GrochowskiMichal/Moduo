import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";

import { WIDGET_TYPES, type WidgetSize, type WidgetType } from "../engine/types";
import { GalleryDialog } from "./gallery-dialog";

// DB-8 (AC9) — the Add-widget gallery. Storybook render is blocked in worktrees
// (gotchas), so this is the human-capture baseline for DB-8's visual pass.

// Web availability: everything except the desktop-only email + time-tracking.
const AVAILABLE: WidgetType[] = WIDGET_TYPES.filter(
  (t) => t !== "email" && t !== "timetracking",
);

function Harness({ available }: { available: WidgetType[] }) {
  const [open, setOpen] = useState(true);
  const [log, setLog] = useState<string>("");
  return (
    <TooltipProvider>
      <div className="flex flex-col items-start gap-3 p-4">
        <Button size="sm" onClick={() => setOpen(true)}>
          Open gallery
        </Button>
        {log ? <p className="text-xs text-muted-foreground">{log}</p> : null}
        <GalleryDialog
          open={open}
          onOpenChange={setOpen}
          available={available}
          onAdd={(type: WidgetType, size: WidgetSize) => {
            // Pretend the page is full for one type to show the "new page" offer.
            if (type === "pinned") return false;
            setLog(`Added ${type} (${size})`);
            return true;
          }}
          onAddToNewPage={(type, size) => setLog(`Added ${type} (${size}) to a new page`)}
        />
      </div>
    </TooltipProvider>
  );
}

const meta: Meta<typeof Harness> = {
  title: "Features/dashboard/gallery-dialog",
  component: Harness,
  args: { available: AVAILABLE },
};

export default meta;
type Story = StoryObj<typeof meta>;

/** All web-available types, each with a size picker + Add. */
export const AllTypes: Story = { args: { available: AVAILABLE } };

/** A permission-locked / minimal workspace — only a few types offered. */
export const Filtered: Story = {
  args: { available: ["clock", "weather", "pomodoro", "countdown"] },
};
