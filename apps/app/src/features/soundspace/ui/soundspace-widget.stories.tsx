import type { Meta, StoryObj } from "@storybook/react";

import { TooltipProvider } from "@/components/ui/tooltip";

import type { WidgetInstance, WidgetSize } from "../../dashboard/engine/types";
import { WidgetFrame } from "../../dashboard/ui/widget-frame";
import { sceneFromMix, sceneToConfig } from "../model";

// Soundspace in its Home frame at each size, empty and with a mix loaded.
// Sound plays for real here: press play (or add a sound) with headphones on.

const SIZE_BOX: Record<Exclude<WidgetSize, "XL">, string> = {
  S: "h-83 w-77",
  M: "h-83 w-155",
  L: "h-168 w-155",
};

function Framed({
  size,
  config,
}: {
  size: Exclude<WidgetSize, "XL">;
  config: Record<string, unknown>;
}) {
  const widget: WidgetInstance = {
    id: `story-${size}`,
    type: "soundspace",
    size,
    x: 0,
    y: 0,
    config,
  };
  return (
    <TooltipProvider>
      <div className={SIZE_BOX[size]}>
        <WidgetFrame widget={widget} />
      </div>
    </TooltipProvider>
  );
}

const meta: Meta<typeof Framed> = {
  title: "Home/Soundspace widget",
  component: Framed,
  parameters: { layout: "centered" },
};

export default meta;
type Story = StoryObj<typeof meta>;

const RAINY = sceneToConfig(sceneFromMix("rainy", 0.7));

export const MediumEmpty: Story = { args: { size: "M", config: {} } };
export const MediumRainyStudy: Story = { args: { size: "M", config: RAINY } };
export const Large: Story = {
  args: { size: "L", config: sceneToConfig(sceneFromMix("cabin", 0.7)) },
};
export const Small: Story = { args: { size: "S", config: RAINY } };
