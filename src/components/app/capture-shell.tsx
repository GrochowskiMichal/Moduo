// The app's one capture (tasks-v3 calls 90/90a/90b, spec §10; SH-1). Replaces
// DF-20's capture bar. ⌘⇧K (from anywhere, inputs too) or the bottom bar opens
// it, always as Task. The type chip and the destination sit on top ("Task ▾ ·
// Inbox"); the body below belongs to the type (lib/capture-registry.ts). While
// it's open, ⌘1–7 switch the type to the module with that number in the top
// bar and never reach the app behind: the shell claims them in the capture
// phase, so the global module keys bail (gotchas/ui.md). A number without a
// type does nothing. Typing "/note" no longer switches anything: one way per job.
//
// TV-U14: ⌘⇧K opens as Task → your Inbox and never asks; ⌘N, "+ New" and `c`
// open it with "here" (`dispatchOpenCapture({ destination })`). What was open
// (an email, note, event, contact) rides along as the body's `context.source`.
// Esc keeps the draft: the next open restores it (research §1.8). A body may
// claim Esc first (a menu, a recognition to undo) through `registerEscape`.

import { ChevronDown } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CAPTURE_OPEN_EVENT } from "../../lib/capture-open";
import {
  CAPTURE_TYPES,
  type CaptureContext,
  type CaptureRequest,
  type CaptureTypeDef,
  captureDigitFor,
  captureDigitKey,
  captureTypeForDigit,
} from "../../lib/capture-registry";
import { getCaptureSource } from "../../lib/capture-source";
import { isMacPlatform, onShortcut } from "../../lib/shortcuts";
import { useAuth } from "../../providers/auth-provider";
import { useWorkspace } from "../../providers/workspace-provider";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { visibleModuleNavItems } from "./app-chrome-constants";
import { announceOverlayOpen, onOtherOverlayOpen } from "./global-overlay-events";

const OVERLAY_ID = "capture";

export { dispatchOpenCapture } from "../../lib/capture-open";

type Props = {
  /** The registered types; tests pass their own. Task (the first) opens by default. */
  types?: readonly CaptureTypeDef[];
};

export function CaptureShell({ types = CAPTURE_TYPES }: Props) {
  const { modulePermissions, selectedWorkspaceId } = useWorkspace();
  const { userId } = useAuth();
  const [open, setOpen] = useState(false);
  const [typeId, setTypeId] = useState(types[0]?.type ?? "");
  const [draft, setDraft] = useState("");
  const [context, setContext] = useState<CaptureContext>({ source: null, openId: 0 });
  // Esc goes to the body first when it asks for it (its menu, a recognition).
  const escapeRef = useRef<(() => boolean) | null>(null);
  const registerEscape = useCallback((handler: (() => boolean) | null) => {
    escapeRef.current = handler;
  }, []);
  // What was typed belongs to one person in one workspace: another person
  // signing in, or a switch of workspace, starts the line over (TV-U14).
  // biome-ignore lint/correctness/useExhaustiveDependencies: the person and workspace are the trigger
  useEffect(() => {
    setDraft("");
    setOpen(false);
  }, [userId, selectedWorkspaceId]);
  // Where focus was when the capture opened. Opened by a key or an event, the
  // dialog has no trigger, so Radix alone would drop focus on <body> (ui.md).
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const visibleModules = useMemo(
    () => visibleModuleNavItems(modulePermissions),
    [modulePermissions],
  );
  // The type's body; a pick from the chip menu hands focus back to its line.
  const bodyRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(false);
  openRef.current = open;

  const active = types.find((t) => t.type === typeId) ?? types[0];

  const show = useCallback(
    (request?: CaptureRequest) => {
      // Already open: keep the type and what's typed.
      if (openRef.current) return;
      const focused = document.activeElement;
      returnFocusRef.current = focused instanceof HTMLElement ? focused : null;
      // Always opens as the first type, Task (90b). The draft stays: Esc kept it.
      setTypeId(types[0]?.type ?? "");
      setContext((prev) => ({
        ...(request ?? {}),
        source: getCaptureSource(),
        openId: prev.openId + 1,
      }));
      setOpen(true);
    },
    [types],
  );

  useEffect(
    () =>
      onShortcut("capture", () => {
        if (open) setOpen(false);
        else show();
      }),
    [open, show],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOpen = (event: Event) =>
      show((event as CustomEvent<CaptureRequest | undefined>).detail);
    window.addEventListener(CAPTURE_OPEN_EVENT, onOpen);
    return () => window.removeEventListener(CAPTURE_OPEN_EVENT, onOpen);
  }, [show]);

  // Never stack on the search palette: announce when we open, and close when a
  // different global overlay opens (DF-20).
  useEffect(() => {
    if (open) announceOverlayOpen(OVERLAY_ID);
  }, [open]);
  useEffect(() => onOtherOverlayOpen(OVERLAY_ID, () => setOpen(false)), []);

  const writable = useCallback(
    (type: CaptureTypeDef) => type.canWrite(modulePermissions),
    [modulePermissions],
  );

  const pick = useCallback(
    (type: CaptureTypeDef | null | undefined) => {
      if (!type || !writable(type)) return;
      setTypeId(type.type);
    },
    [writable],
  );

  // ⌘1–7 while open: switch the type, never the module behind the capture.
  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const isMac = isMacPlatform();
    const onKey = (event: KeyboardEvent) => {
      const digit = captureDigitKey(event, isMac);
      if (digit === null) return;
      event.preventDefault();
      event.stopPropagation();
      pick(captureTypeForDigit(digit, visibleModules, types));
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, pick, visibleModules, types]);

  if (!active) return null;
  const ActiveIcon = active.icon;
  const Body = active.Body;
  const isMac = isMacPlatform();

  const typeChip = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Capture type: ${active.label}`}
          className="gap-1.5"
        >
          <ActiveIcon aria-hidden />
          {active.label}
          <ChevronDown className="text-muted-foreground" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-44"
        // Back to the title line, not the chip, so typing just goes on.
        onCloseAutoFocus={(event) => {
          const field = bodyRef.current?.querySelector<HTMLElement>(
            "[data-capture-title], input, textarea",
          );
          if (!field) return;
          event.preventDefault();
          field.focus();
        }}
      >
        <DropdownMenuRadioGroup
          value={active.type}
          onValueChange={(value) => pick(types.find((t) => t.type === value))}
        >
          {types.map((type) => {
            const digit = captureDigitFor(type, visibleModules);
            return (
              <DropdownMenuRadioItem key={type.type} value={type.type} disabled={!writable(type)}>
                <type.icon aria-hidden />
                {type.label}
                {digit ? (
                  <DropdownMenuShortcut>
                    {isMac ? `⌘${digit}` : `Ctrl ${digit}`}
                  </DropdownMenuShortcut>
                ) : null}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        aria-describedby="capture-shell-description"
        className="top-[12%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl"
        // Radix reads Esc first (a document capture listener): the body's menu
        // or recognition takes it before the capture closes, and the key then
        // stops here so the editor doesn't act on it twice (gotchas/ui.md).
        onEscapeKeyDown={(event) => {
          if (escapeRef.current?.()) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        onCloseAutoFocus={(event) => {
          const target = returnFocusRef.current;
          if (target?.isConnected) {
            event.preventDefault();
            target.focus();
          }
        }}
      >
        <DialogTitle className="sr-only">Capture</DialogTitle>
        <DialogDescription id="capture-shell-description" className="sr-only">
          {`Capture a ${active.label.toLowerCase()}. ${isMac ? "⌘" : "Ctrl"} plus a module's number switches what you capture.`}
        </DialogDescription>
        {active.ownsHeader ? null : (
          <div className="flex items-center gap-1 px-2 pt-2">
            {typeChip}
            <span className="text-muted-foreground" aria-hidden>
              ·
            </span>
            <span className="px-1 font-display text-base text-muted-foreground">
              {active.destination}
            </span>
          </div>
        )}
        {/* A fresh body per open and per type: what it shows comes from the
            draft and the request, never from a body still closing. */}
        <div key={`${active.type}:${context.openId}`} ref={bodyRef} className="motion-view">
          <Body
            draft={draft}
            onDraftChange={setDraft}
            writable={writable(active)}
            onDone={() => setOpen(false)}
            context={context}
            typeChip={active.ownsHeader ? typeChip : undefined}
            registerEscape={registerEscape}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
