import type { Meta, StoryObj } from "@storybook/react";
import { toast } from "sonner";

import { Button } from "./button";
import { Toaster } from "./sonner";

const meta: Meta<typeof Toaster> = {
  title: "Components/ui/sonner",
  component: Toaster,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Variants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      <Button variant="outline" onClick={() => toast("Note saved.")}>
        Default
      </Button>
      <Button variant="outline" onClick={() => toast.success("Synced to cloud")}>
        Success
      </Button>
      <Button variant="outline" onClick={() => toast.info("New shared note")}>
        Info
      </Button>
      <Button variant="outline" onClick={() => toast.warning("Offline — changes will sync later")}>
        Warning
      </Button>
      <Button variant="outline" onClick={() => toast.error("Failed to save")}>
        Error
      </Button>
      <Button
        variant="outline"
        onClick={() => {
          const id = toast.loading("Indexing notes…");
          setTimeout(() => toast.success("Index ready", { id }), 1500);
        }}
      >
        Loading
      </Button>
      <Button
        variant="outline"
        onClick={() =>
          toast("Note moved to Trash", {
            action: { label: "Undo", onClick: () => toast("Restored.") },
          })
        }
      >
        With action
      </Button>
      <Toaster />
    </div>
  ),
};
