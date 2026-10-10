// Help → Report a bug (tasks-v3 call 96). A short form whose report carries the
// app version, build, platform and page. It goes by email to hello@ (Maciej,
// 2026-10-10): on web the form opens the person's mail app with the report
// filled in, and they press Send. The desktop app can only open web links, so
// there it copies the report instead. Nothing is sent from Moduo itself.

import { useRouterState } from "@tanstack/react-router";
import { useId, useState } from "react";
import { toast } from "sonner";

import { IS_DESKTOP } from "../../features/settings/about";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import {
  BUG_REPORT_EMAIL,
  bugReportContext,
  bugReportSubject,
  describeBugReportContext,
  formatBugReport,
  mailtoUrl,
} from "./help-links";

/** Keeps the mailto link under the length mail apps reliably accept. */
const MAX_DESCRIPTION = 1500;

/** Copy text to the clipboard; false when the browser refuses. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Hand a `mailto:` link to the system's mail app without leaving the page. */
export function openMailto(url: string): void {
  if (typeof document === "undefined") return;
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noopener";
  link.click();
}

export function BugReportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const fieldId = useId();
  // The draft survives Cancel, so closing by accident loses nothing.
  const [description, setDescription] = useState("");
  const context = bugReportContext(pathname);
  const canSend = description.trim().length > 0;

  const send = async () => {
    if (!canSend) return;
    const report = formatBugReport(description, context);
    if (IS_DESKTOP) {
      if (!(await copyText(report))) {
        toast("Couldn't copy the report", {
          description: `Write to ${BUG_REPORT_EMAIL} and say what happened.`,
        });
        return;
      }
      toast("Report copied", { description: `Paste it into an email to ${BUG_REPORT_EMAIL}.` });
    } else {
      openMailto(mailtoUrl(BUG_REPORT_EMAIL, bugReportSubject(description), report));
      // A browser with no mail app does nothing, so say what should happen.
      toast("Opening your email app", {
        description: `Nothing opened? Copy the report and send it to ${BUG_REPORT_EMAIL}.`,
        action: { label: "Copy report", onClick: () => void copyText(report) },
      });
    }
    setDescription("");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Report a bug</DialogTitle>
          <DialogDescription>
            {IS_DESKTOP
              ? `Copy the report and email it to ${BUG_REPORT_EMAIL}.`
              : `It opens as an email to ${BUG_REPORT_EMAIL}, ready to send.`}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor={fieldId}>What happened?</Label>
            <Textarea
              id={fieldId}
              autoFocus
              rows={5}
              maxLength={MAX_DESCRIPTION}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void send();
                }
              }}
              placeholder="What you did, what you expected, and what happened instead."
            />
            <p className="text-xs text-muted-foreground">
              Attached: {describeBugReportContext(context)}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSend}>
              {IS_DESKTOP ? "Copy report" : "Email report"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
