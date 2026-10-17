// The long-wait mark (Libraries.dev `thinking-orbs`), piloted on Settings →
// Advanced → Export data. Use the toolbar's Theme and Accent to check the ink,
// and the Motion control here to see it freeze the way Settings → Preferences
// makes it freeze.
import type { Meta, StoryObj } from "@storybook/react";
import { Download, Loader2 } from "lucide-react";
import { useEffect } from "react";

import { Button } from "./button";
import { WaitOrb } from "./wait-orb";

type MotionSetting = "system" | "reduced" | "full";

/** Pins `data-motion` on <html> while the story is open, like Settings does. */
function useMotionSetting(setting: MotionSetting) {
  useEffect(() => {
    const root = document.documentElement;
    if (setting === "system") root.removeAttribute("data-motion");
    else root.setAttribute("data-motion", setting);
    return () => root.removeAttribute("data-motion");
  }, [setting]);
}

type Args = { motion: MotionSetting };

const meta: Meta<Args> = {
  title: "Components/ui/wait-orb",
  tags: ["autodocs"],
  argTypes: {
    motion: { control: "inline-radio", options: ["system", "reduced", "full"] },
  },
  args: { motion: "system" },
};

export default meta;
type Story = StoryObj<Args>;

function ExportButtonDemo({ motion }: Args) {
  useMotionSetting(motion);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button">
          <Download className="size-3.5" aria-hidden />
          Export data
        </Button>
        <Button type="button" disabled>
          <WaitOrb on="primary" />
          Preparing…
        </Button>
        <span className="text-xs text-muted-foreground">Rest, then preparing (the pilot)</span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled>
          <WaitOrb on="primary" size="tuned" />
          Preparing…
        </Button>
        <span className="text-xs text-muted-foreground">At the orb's own 20 px size</span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" disabled>
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Preparing…
        </Button>
        <span className="text-xs text-muted-foreground">Today's spinner</span>
      </div>
    </div>
  );
}

function OnASurfaceDemo({ motion }: Args) {
  useMotionSetting(motion);
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <WaitOrb />
        Preparing your export…
      </div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <WaitOrb state="searching" />
        Searching all mail on the server…
      </div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <WaitOrb state="connecting" />
        Connecting…
      </div>
    </div>
  );
}

/** The pilot: the export button while it prepares, against today's spinner. */
export const ExportButton: Story = { render: (args) => <ExportButtonDemo {...args} /> };

/** Beside a status line on a card, for the other long waits it could cover. */
export const OnASurface: Story = { render: (args) => <OnASurfaceDemo {...args} /> };
