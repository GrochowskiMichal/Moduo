// GlobalCaptureBar — DF-20 (critique CC-11). Capture-anywhere line: a plain line
// creates a Task in the Inbox by default; `/note` `/event` `/contact` prefixes
// route to the sibling modules. Reuses the command-palette surface (CommandDialog)
// and the quick-capture write path (seedInbox + upsertTask), extended to the
// three siblings through their own create ops (see features/spine/capture-command).
// Opened by ⌘⇧K from anywhere (incl. text inputs) and by the bottom-bar button.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Calendar as CalendarIcon, CheckSquare, Contact as ContactIcon, FileText } from "lucide-react";
import { toast } from "sonner";

import { CommandDialog } from "../ui/command";
import { cn } from "../../lib/utils";
import { onShortcut } from "../../lib/shortcuts";
import { useAuth } from "../../providers/auth-provider";
import { useWorkspace } from "../../providers/workspace-provider";
import { requestDashboardDataRefresh } from "../../features/dashboard/context/dashboard-data-context";
import {
  CAPTURE_ROUTES,
  canWriteRoute,
  createCapturedEntity,
  isPermissionError,
  parseCaptureCommand,
  type CaptureRoute,
  type CaptureTarget,
} from "../../features/spine/capture-command";
import { announceOverlayOpen, onOtherOverlayOpen } from "./global-overlay-events";

const OVERLAY_ID = "capture";

const CAPTURE_OPEN_EVENT = "moduo:capture:open";

const TARGET_ICON: Record<CaptureTarget, typeof FileText> = {
  task: CheckSquare,
  note: FileText,
  event: CalendarIcon,
  contact: ContactIcon,
};

export function dispatchOpenCapture(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CAPTURE_OPEN_EVENT));
}

function chipCls(active: boolean, disabled: boolean): string {
  return cn(
    "flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    disabled
      ? "cursor-not-allowed border-border text-muted-foreground/50"
      : active
        ? "border-border bg-muted text-foreground"
        : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
  );
}

export function GlobalCaptureBar() {
  const navigate = useNavigate();
  const { runtime } = useAuth();
  const { selectedWorkspaceId, modulePermissions } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  // Synchronous guard — a state flag can't block a rapid double-Enter (both reads
  // see false before the first commit), which would double-create. Ref instead.
  const busyRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => onShortcut("capture", () => setOpen((prev) => !prev)), []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOpen = () => setOpen(true);
    window.addEventListener(CAPTURE_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(CAPTURE_OPEN_EVENT, onOpen);
  }, []);

  // Never stack on top of the search palette (or any future global overlay):
  // announce when we open, and close ourselves when a different one opens.
  useEffect(() => {
    if (open) announceOverlayOpen(OVERLAY_ID);
  }, [open]);
  useEffect(() => onOtherOverlayOpen(OVERLAY_ID, () => setOpen(false)), []);

  // Reset the line each time the bar closes so it reopens fresh.
  useEffect(() => {
    if (!open) {
      setValue("");
      busyRef.current = false;
    }
  }, [open]);

  // Focus the input on open (Radix would focus it anyway, but this also lands
  // the caret at the end after a chip pre-fills a prefix).
  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  const { route: activeRoute } = useMemo(() => parseCaptureCommand(value), [value]);

  // Edit-permission gate per route (pure helper, unit-tested). Tasks/Events ride
  // the Tasks lane; Notes its own; Contacts is ungated at alpha (server guards).
  const routeWritable = useCallback(
    (route: CaptureRoute): boolean => canWriteRoute(route, modulePermissions),
    [modulePermissions],
  );

  // Preserve the typed body when switching routes via a chip — only swap the prefix.
  const applyRoute = useCallback(
    (route: CaptureRoute) => {
      if (!routeWritable(route)) return;
      const { body } = parseCaptureCommand(value);
      setValue(route.prefix ? `${route.prefix} ${body}` : body);
      inputRef.current?.focus();
    },
    [value, routeWritable],
  );

  const submit = useCallback(async () => {
    if (busyRef.current) return;
    const { route, body } = parseCaptureCommand(value);
    const text = body.trim();
    if (!text) return;
    if (!runtime || !selectedWorkspaceId) {
      toast.error("Pick a workspace first.");
      return;
    }
    if (!routeWritable(route)) {
      toast.error(`You have view-only access to ${route.label.toLowerCase()}s.`);
      return;
    }
    busyRef.current = true;
    try {
      const created = await createCapturedEntity({
        runtime,
        workspaceId: selectedWorkspaceId,
        target: route.target,
        body: text,
      });
      setValue("");
      setOpen(false);
      // Home widgets refetch on this event, so a capture reflects live there;
      // the toast's "Open" jump remounts the module page for everywhere else.
      requestDashboardDataRefresh();
      toast(created.title, {
        description: created.description,
        action: { label: "Open", onClick: () => void navigate({ to: created.openTo as any }) },
      });
    } catch (err) {
      // Contacts is ungated client-side, so a view-only member's capture is
      // rejected by the server op — map that (and any drifted RLS denial) to the
      // same friendly copy the disabled chips show, not the raw server string.
      const message = err instanceof Error ? err.message : "";
      toast.error(
        isPermissionError(message)
          ? `You have view-only access to ${route.label.toLowerCase()}s.`
          : message || "Couldn't capture that.",
      );
    } finally {
      busyRef.current = false;
    }
  }, [value, runtime, selectedWorkspaceId, routeWritable, navigate]);

  const ActiveIcon = TARGET_ICON[activeRoute.target];
  const activeWritable = routeWritable(activeRoute);

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      className="max-w-xl"
      title="Quick capture"
      description="Type a line to capture. A plain line makes a task; /note, /event and /contact route elsewhere."
      commandProps={{ shouldFilter: false }}
    >
      {/* Input row mirrors the palette's CommandInput, but the leading icon is
          the LIVE target (Task by default) so you can see where the line will
          land before you hit Enter. */}
      <div className="flex items-center gap-2 border-b border-border px-3">
        <ActiveIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              // No cmdk items exist here, but stop the event reaching the cmdk
              // root's key handler just in case a future item is added.
              e.stopPropagation();
              void submit();
            }
          }}
          placeholder="Capture anything…"
          aria-label="Quick capture"
          // Not disabled while busy — `busyRef` synchronously blocks a double
          // submit, and disabling would yank focus off the input on the error
          // path (it stays open) leaving the user unable to retry without a click.
          className="h-11 w-full bg-transparent py-3 font-sans text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
      </div>

      <div className="flex flex-col gap-2 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {CAPTURE_ROUTES.map((route) => {
            const Icon = TARGET_ICON[route.target];
            const disabled = !routeWritable(route);
            return (
              <button
                key={route.target}
                type="button"
                onClick={() => applyRoute(route)}
                disabled={disabled}
                aria-pressed={route.target === activeRoute.target}
                className={chipCls(route.target === activeRoute.target, disabled)}
              >
                <Icon className="size-3.5" aria-hidden />
                <span>{route.label}</span>
                {route.prefix ? (
                  <kbd className="font-mono text-2xs text-muted-foreground">{route.prefix}</kbd>
                ) : null}
              </button>
            );
          })}
        </div>
        <p className="px-0.5 text-2xs text-muted-foreground">
          {activeWritable
            ? "Enter to capture · a plain line makes a task"
            : `You have view-only access to ${activeRoute.label.toLowerCase()}s`}
        </p>
      </div>
    </CommandDialog>
  );
}
