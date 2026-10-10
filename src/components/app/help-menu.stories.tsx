import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";

import { BugReportDialog } from "./bug-report-dialog";
import { GlobalShortcutsDialog } from "./global-shortcuts-dialog";
import { HelpMenu } from "./help-menu";

const meta: Meta<typeof HelpMenu> = {
  title: "Components/app/help-menu",
  component: HelpMenu,
  tags: ["autodocs"],
};

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * The top bar's Help button. Its menu: Docs · Keyboard shortcuts (?) ·
 * Contact support · Report a bug. The shortcuts dialog is mounted beside it,
 * as in the app chrome.
 */
export const Default: Story = {
  render: () => (
    <div className="flex justify-end p-4">
      <HelpMenu />
      <GlobalShortcutsDialog />
    </div>
  ),
};

/** Report a bug, open: the form and the app version it attaches. */
export const BugReport: Story = {
  render: function BugReportStory() {
    const [open, setOpen] = useState(true);
    return <BugReportDialog open={open} onOpenChange={setOpen} />;
  },
};
