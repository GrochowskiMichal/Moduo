// The app's capture (tasks-v3 calls 90/90a/90b; SH-1). It opens as Task, filed
// to the Inbox; the type chip lists the registered types with their top-bar
// numbers, and ⌘ + a number switches the type inside the capture. "Only Task"
// shows the shell with a single registered type: ⌘2–7 do nothing there.
import type { Meta, StoryObj } from "@storybook/react";
import { useEffect } from "react";

import { CAPTURE_TYPES } from "../../lib/capture-registry";
import { Button } from "../ui/button";
import { CaptureShell, dispatchOpenCapture } from "./capture-shell";

function Demo({ onlyTask }: { onlyTask: boolean }) {
  // Open on load, the way ⌘⇧K would.
  useEffect(() => {
    const id = window.setTimeout(() => dispatchOpenCapture(), 0);
    return () => window.clearTimeout(id);
  }, []);
  return (
    <div className="flex flex-col items-start gap-3 p-6">
      <p className="text-sm text-muted-foreground">
        ⌘⇧K or the button opens the capture. Inside it, ⌘2 makes a note, ⌘3 a task, ⌘4 an event and
        ⌘6 a contact.
      </p>
      <Button variant="outline" size="sm" onClick={() => dispatchOpenCapture()}>
        Open the capture
      </Button>
      <CaptureShell types={onlyTask ? CAPTURE_TYPES.slice(0, 1) : CAPTURE_TYPES} />
    </div>
  );
}

const meta: Meta<typeof Demo> = {
  title: "App/CaptureShell",
  component: Demo,
  parameters: { layout: "fullscreen" },
  args: { onlyTask: false },
};
export default meta;

type Story = StoryObj<typeof Demo>;

/** Every registered type: Task, plus the one-line Note, Event and Contact. */
export const Default: Story = {};

/** Only Task registered: the chip lists one type and ⌘2–7 do nothing. */
export const OnlyTask: Story = { args: { onlyTask: true } };
