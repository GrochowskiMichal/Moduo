// DB-6 — "Quick capture" widget (the connective-tissue widget). A text box that
// drops a task into the Inbox without leaving Home. Writes are gated by `canWrite`
// (a "view" member sees a disabled box). Refreshes the shared data so a Tasks
// widget on the same board updates immediately.

import { ArrowUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { onCreateNew } from "@/components/app/create-events";
import { endPosition, makeTask } from "@/features/tasks/helpers";
import { getRuntime } from "@/lib/runtime";
import { captureTaskToStore } from "@/lib/sync/capture";
import { findWorkspaceStore } from "@/lib/sync/store";
import { cn } from "@/lib/utils";

import {
  requestDashboardDataRefresh,
  useDashboardData,
} from "../../context/dashboard-data-context";
import type { WidgetComponentProps } from "../../registry/types";

export function QuickCaptureWidget({ canWrite }: WidgetComponentProps) {
  const { workspaceId } = useDashboardData();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  // A synchronous guard — `busy` state can't block a rapid double-Enter (both
  // reads see `false` before the first setBusy commits), which would double-create.
  const busyRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // ⌘N / global "+" on Home focuses the capture box (Home's create surface).
  // Only mounted when this widget is on the active board, so a global "+"
  // elsewhere never reaches it. A disabled (view-only) box simply won't focus.
  useEffect(() => onCreateNew(() => inputRef.current?.focus()), []);

  const submit = async () => {
    const title = text.trim();
    const runtime = getRuntime();
    if (!title || !canWrite || !workspaceId || !runtime || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      // Through the shared store (TV-D11a): the end of the Inbox it holds, shown
      // on every widget at once, and kept on the device while offline.
      const store = findWorkspaceStore(runtime, workspaceId);
      let queued = false;
      if (store) {
        ({ queued } = await captureTaskToStore(store, { title }));
      } else {
        const inbox = await runtime.tasks.seedInbox(workspaceId);
        await runtime.tasks.upsertTask(
          makeTask({ workspaceId, bucketId: inbox.id, title, position: endPosition([]) }),
        );
      }
      setText("");
      requestDashboardDataRefresh();
      toast(queued ? "Waiting to sync · Inbox" : "Added to Inbox");
    } catch {
      toast.error("Couldn't capture that.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col justify-center gap-2 p-3">
      <div className="relative">
        <textarea
          ref={inputRef}
          value={text}
          disabled={!canWrite}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder={canWrite ? "Capture a task…" : "View only"}
          rows={2}
          className={cn(
            "w-full resize-none rounded-md border border-border bg-muted px-2.5 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            "scrollbar-thin",
          )}
        />
        {canWrite && text.trim() ? (
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy}
            aria-label="Add to Inbox"
            className="absolute bottom-1.5 right-1.5 grid size-icon-lg place-items-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            <ArrowUp className="size-icon-sm" aria-hidden />
          </button>
        ) : null}
      </div>
      <p className="px-0.5 text-2xs text-muted-foreground">
        Enter to add · Shift+Enter for a new line
      </p>
    </div>
  );
}
