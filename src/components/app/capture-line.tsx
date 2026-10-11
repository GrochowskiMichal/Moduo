// The one-line capture body (DF-20's capture line, moved into the capture
// shell by SH-1): a title line parsed for dates, written through the module's
// own create op (features/spine/capture-command.ts). ⏎ creates and closes,
// ⌘⏎ creates and stays for the next one (call 91). Every type uses it until its
// module gives it a richer body (Task's four pills and destination: TV-U14).

import { useNavigate } from "@tanstack/react-router";
import { type ComponentType, useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";

import { requestDashboardDataRefresh } from "../../features/dashboard/context/dashboard-data-context";
import {
  CAPTURE_ROUTES,
  type CaptureTarget,
  canWriteRoute,
  createCapturedEntity,
  isPermissionError,
} from "../../features/spine/capture-command";
import type { CaptureBodyProps, CaptureTypeDef } from "../../lib/capture-registry";
import { isMacPlatform } from "../../lib/shortcuts";
import { useAuth } from "../../providers/auth-provider";
import { useWorkspace } from "../../providers/workspace-provider";
import { Kbd } from "../ui/kbd";

type LineOptions = {
  target: CaptureTarget;
  /** The thing it makes, lowercase and plural, for the view-only line ("notes"). */
  plural: string;
  placeholder: string;
};

/** A capture body for `target`, for a type's registry entry. */
export function lineCaptureBody(options: LineOptions): ComponentType<CaptureBodyProps> {
  function LineBody(props: CaptureBodyProps) {
    return <CaptureLine {...options} {...props} />;
  }
  LineBody.displayName = `CaptureLine(${options.target})`;
  return LineBody;
}

/**
 * A registry entry for a one-line capture type: its route's permission lane
 * gates it (capture-command.ts) and its body is the line above.
 */
export function lineCaptureType(
  def: Omit<CaptureTypeDef, "canWrite" | "Body" | "type"> & LineOptions,
): CaptureTypeDef {
  const route = CAPTURE_ROUTES.find((r) => r.target === def.target);
  if (!route) throw new Error(`No capture route for "${def.target}"`);
  const { target, plural, placeholder, ...type } = def;
  return {
    ...type,
    type: target,
    canWrite: (perms) => canWriteRoute(route, perms),
    Body: lineCaptureBody({ target, plural, placeholder }),
  };
}

function CaptureLine({
  target,
  plural,
  placeholder,
  draft,
  onDraftChange,
  writable,
  onDone,
}: LineOptions & CaptureBodyProps) {
  const navigate = useNavigate();
  const { runtime } = useAuth();
  const { selectedWorkspaceId } = useWorkspace();
  // Synchronous guard: a state flag can't block a rapid double ⏎ (both reads
  // see false before the first commit), which would create twice.
  const busyRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus on open and after every type switch (the body remounts per type).
  useEffect(() => {
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, []);

  const viewOnly = `You have view-only access to ${plural}.`;

  const submit = useCallback(
    async (more: boolean) => {
      if (busyRef.current) return;
      const text = draft.trim();
      if (!text) return;
      if (!runtime || !selectedWorkspaceId) {
        toast.error("Pick a workspace first.");
        return;
      }
      if (!writable) {
        toast.error(viewOnly);
        return;
      }
      busyRef.current = true;
      try {
        const created = await createCapturedEntity({
          runtime,
          workspaceId: selectedWorkspaceId,
          target,
          body: text,
        });
        onDraftChange("");
        // Home widgets refetch on this event, so a capture shows there live;
        // the toast's "Open" jump remounts the module page everywhere else.
        requestDashboardDataRefresh();
        toast(created.title, {
          description: created.description,
          // biome-ignore lint/suspicious/noExplicitAny: openTo is one of the module routes
          action: { label: "Open", onClick: () => void navigate({ to: created.openTo as any }) },
        });
        if (more) inputRef.current?.focus();
        else onDone();
      } catch (err) {
        // Contacts is ungated client-side, so a view-only member's capture is
        // refused by the server op; show the same copy as a gated type.
        const message = err instanceof Error ? err.message : "";
        toast.error(isPermissionError(message) ? viewOnly : message || "Couldn't capture that.");
      } finally {
        busyRef.current = false;
      }
    },
    [
      draft,
      runtime,
      selectedWorkspaceId,
      writable,
      viewOnly,
      target,
      onDraftChange,
      onDone,
      navigate,
    ],
  );

  return (
    <div className="flex flex-col">
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => onDraftChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
          e.preventDefault();
          void submit(e.metaKey || e.ctrlKey);
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        // Not disabled while busy: `busyRef` blocks a double submit, and
        // disabling would drop focus on the error path, which stays open.
        className="h-(--ctrl-h-lg) w-full bg-transparent px-4 font-sans text-base text-foreground outline-none placeholder:text-muted-foreground"
      />
      <div className="flex items-center gap-3 border-t border-border px-4 py-2 font-sans text-xs text-muted-foreground">
        {writable ? (
          <>
            <span className="flex items-center gap-1">
              <Kbd>⏎</Kbd> Create
            </span>
            <span className="flex items-center gap-1">
              <Kbd>{isMacPlatform() ? "⌘⏎" : "Ctrl ⏎"}</Kbd> Create more
            </span>
          </>
        ) : (
          <span>{viewOnly}</span>
        )}
      </div>
    </div>
  );
}
