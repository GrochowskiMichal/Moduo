// The top bar's Help button (tasks-v3 call 96), between the Focus timer and the
// bell: Docs, Keyboard shortcuts, Contact support and Report a bug. Help is
// global, so it lives in the top bar (principle 48b), and it stays for the
// alpha and beta. The shortcuts dialog keeps its own `?` key.

import { BookOpen, Bug, CircleQuestionMark, Keyboard, LifeBuoy } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { IS_DESKTOP } from "../../features/settings/about";
import { formatShortcut, SHORTCUTS } from "../../lib/shortcuts";
import { useAuth } from "../../providers/auth-provider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import { BugReportDialog, copyText, openMailto } from "./bug-report-dialog";
import { dispatchOpenShortcuts } from "./global-shortcuts-dialog";
import { DOCS_URL, mailtoUrl, SUPPORT_EMAIL } from "./help-links";

const helpShortcut = SHORTCUTS.find((s) => s.id === "help");

export function HelpMenu() {
  const { runtime } = useAuth();
  const [bugReportOpen, setBugReportOpen] = useState(false);
  // An item that opens a dialog waits for the menu to close, or the closing
  // menu takes focus back and the dialog closes at once (gotchas/ui.md).
  const afterClose = useRef<(() => void) | null>(null);

  const openDocs = () => {
    // Desktop hands the link to the system browser; web opens a new tab.
    if (runtime) void runtime.window.openExternalUrl(DOCS_URL);
    else window.open(DOCS_URL, "_blank", "noopener,noreferrer");
  };

  const contactSupport = async () => {
    if (IS_DESKTOP) {
      // The desktop app can only open web links, not a mail app.
      const copied = await copyText(SUPPORT_EMAIL);
      toast(copied ? `${SUPPORT_EMAIL} copied` : `Write to ${SUPPORT_EMAIL}`, {
        description: copied ? "Paste it into a new email, and we'll write back." : undefined,
      });
      return;
    }
    openMailto(mailtoUrl(SUPPORT_EMAIL, "Moduo support"));
    toast("Opening your email app", {
      description: `Nothing opened? Write to ${SUPPORT_EMAIL}.`,
      action: { label: "Copy address", onClick: () => void copyText(SUPPORT_EMAIL) },
    });
  };

  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger
              data-slot="help-menu-trigger"
              aria-label="Help"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-transparent text-muted-foreground transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=open]:bg-state-active data-[state=open]:text-foreground"
            >
              <CircleQuestionMark className="size-4" aria-hidden />
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Help</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          align="end"
          className="min-w-52"
          onCloseAutoFocus={(event) => {
            const run = afterClose.current;
            if (!run) return;
            afterClose.current = null;
            event.preventDefault();
            run();
          }}
        >
          <DropdownMenuItem onSelect={openDocs}>
            <BookOpen aria-hidden />
            Docs
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              afterClose.current = dispatchOpenShortcuts;
            }}
          >
            <Keyboard aria-hidden />
            Keyboard shortcuts
            {helpShortcut ? (
              <DropdownMenuShortcut>{formatShortcut(helpShortcut)}</DropdownMenuShortcut>
            ) : null}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void contactSupport()}>
            <LifeBuoy aria-hidden />
            Contact support
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              afterClose.current = () => setBugReportOpen(true);
            }}
          >
            <Bug aria-hidden />
            Report a bug
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <BugReportDialog open={bugReportOpen} onOpenChange={setBugReportOpen} />
    </>
  );
}
