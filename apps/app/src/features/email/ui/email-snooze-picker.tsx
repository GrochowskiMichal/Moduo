// The snooze and remind picker (specs/mail-v3.md §8, AC27). A popover anchored
// to the button that opened it (the reader's Snooze or Remind, a row's Snooze;
// for a key, the open reader's button, else the row): the presets (Later today
// 18:00, Tomorrow 9:00, This weekend Sat 9:00, Next week Mon 9:00, Someday), each
// with its resolved time, then a typed field that reads "thu 9am", "in 3 days",
// "next week" or "dec 2" with a live preview ("Can't read that" when it can't),
// then the note. Remind uses the same presets, "if no reply". Picking resolves to
// a concrete instant and calls onPick; the page owns the op.

import { Clock3 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Eyebrow } from "../../../components/ui/eyebrow";
import { Input } from "../../../components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "../../../components/ui/popover";
import { parseSnoozeText, snoozeHint, snoozePresets, snoozePreview } from "../snooze";

export type SnoozePickerMode = "snooze" | "remind";

/** Something the popover can measure: an element, or one found when measured. */
export type PickerAnchor = { getBoundingClientRect(): DOMRect };

const COPY: Record<SnoozePickerMode, { title: string; field: string; note: string }> = {
  snooze: {
    title: "Snooze until",
    field: "Snooze until a time you type",
    note: "Returns to the top of Personal at that time.",
  },
  remind: {
    title: "Remind me if no reply",
    field: "Remind me at a time you type",
    note: "Moves to Follow-ups at that time if nobody has replied.",
  },
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (at: Date) => void;
  mode?: SnoozePickerMode;
  /** The trigger it opens from; null opens it over the reader's top. */
  anchor?: PickerAnchor | null;
  now?: () => number;
};

function TypedTime({
  mode,
  now,
  onPick,
}: {
  mode: SnoozePickerMode;
  now: Date;
  onPick: (at: Date) => void;
}) {
  const [text, setText] = useState("");
  const at = text.trim() ? parseSnoozeText(text, now) : null;
  return (
    <div className="border-t border-border px-2 pt-2 pb-1">
      <div className="flex items-center gap-1.5">
        <Clock3 className="size-icon-sm shrink-0 text-muted-foreground" aria-hidden />
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || !at) return;
            e.preventDefault();
            onPick(at);
          }}
          placeholder="Or type a time, like thu 9am"
          aria-label={COPY[mode].field}
          aria-invalid={(text.trim() !== "" && !at) || undefined}
          aria-describedby="snooze-typed-preview"
          className="h-8 flex-1 text-xs"
        />
      </div>
      <output
        id="snooze-typed-preview"
        className="mt-1 block min-h-4 text-2xs tabular-nums text-muted-foreground"
      >
        {!text.trim() ? null : at ? (
          <>
            {snoozePreview(at, now)}
            {mode === "remind" ? " if no reply" : null}
          </>
        ) : (
          "Can't read that"
        )}
      </output>
    </div>
  );
}

/** The picker's body, mounted each time it opens so its times are fresh. */
function PickerBody({
  mode,
  now,
  pick,
}: {
  mode: SnoozePickerMode;
  now: () => number;
  pick: (at: Date) => void;
}) {
  const [nowDate] = useState(() => new Date(now()));
  const presets = useMemo(() => snoozePresets(nowDate), [nowDate]);
  // Fixed chrome ("Snooze until"), allowlisted for the small caps by this name.
  const title = COPY[mode].title;
  return (
    <>
      <Eyebrow as="div" className="px-2 py-1.5">
        {title}
      </Eyebrow>
      <div className="flex flex-col">
        {presets.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => pick(preset.at)}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent"
          >
            <span className="min-w-0 flex-1 truncate">
              {preset.label}
              {mode === "remind" ? (
                <>
                  {" "}
                  <span className="text-muted-foreground">if no reply</span>
                </>
              ) : null}
            </span>
            <span className="shrink-0 text-2xs tabular-nums text-muted-foreground">
              {snoozeHint(preset.at, nowDate)}
            </span>
          </button>
        ))}
      </div>
      <TypedTime mode={mode} now={nowDate} onPick={pick} />
      <p className="px-2 pt-1 pb-1.5 text-xs text-muted-foreground">{COPY[mode].note}</p>
    </>
  );
}

export function EmailSnoozePicker({
  open,
  onOpenChange,
  onPick,
  mode = "snooze",
  anchor = null,
  now = Date.now,
}: Props) {
  const virtualRef = useMemo(() => ({ current: anchor }), [anchor]);
  const pick = (at: Date) => {
    onPick(at);
    onOpenChange(false);
  };
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {anchor ? (
        <PopoverAnchor virtualRef={virtualRef as React.RefObject<PickerAnchor>} />
      ) : (
        <PopoverAnchor asChild>
          <span aria-hidden className="pointer-events-none absolute top-12 right-1/3 size-0" />
        </PopoverAnchor>
      )}
      <PopoverContent
        align="start"
        className="w-72 p-1"
        aria-label={COPY[mode].title}
        // Opened from the ⋯ menu or a key: focus moving back mustn't close it.
        onFocusOutside={(e) => e.preventDefault()}
      >
        {open ? <PickerBody mode={mode} now={now} pick={pick} /> : null}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The button a picker opens from. A click names its own button (the last pointer
 * press, while it is still on the page and not inside a menu); a key or a menu
 * item falls back to the open reader's button for that action, then the row.
 */
export function pickerAnchor(
  threadId: string | undefined,
  action: "snooze" | "remind",
  pressed: Element | null,
): PickerAnchor | null {
  if (typeof document === "undefined") return null;
  if (pressed?.isConnected && !pressed.closest('[role="menu"]')) return pressed;
  if (!threadId) return null;
  const id = CSS.escape(threadId);
  const find = () =>
    document.querySelector(`[data-reader-thread="${id}"] [data-reader-action="${action}"]`) ??
    document.querySelector(`[data-thread-id="${id}"]`);
  if (!find()) return null;
  // Measured late, so a re-render that swaps the element keeps the anchor.
  return { getBoundingClientRect: () => find()?.getBoundingClientRect() ?? new DOMRect() };
}

/** The page's snooze picker: `open(ids)` anchors it to the button that asked. */
export function useSnoozePicker(
  now: () => number,
  onSnooze: (ids: string[], untilMs: number) => void,
) {
  const [state, setState] = useState<{ ids: string[]; anchor: PickerAnchor | null } | null>(null);
  const pressed = usePressedButton();
  const open = (ids: string[]) => {
    if (ids.length > 0) setState({ ids, anchor: pickerAnchor(ids[0], "snooze", pressed()) });
  };
  const picker = (
    <EmailSnoozePicker
      open={state !== null}
      anchor={state?.anchor ?? null}
      now={now}
      onOpenChange={(o) => (o ? null : setState(null))}
      onPick={(at) => {
        const ids = state?.ids ?? [];
        setState(null);
        if (ids.length > 0) onSnooze(ids, at.getTime());
      }}
    />
  );
  return { open, picker };
}

/** Remembers the last button pressed on the page, for `pickerAnchor`. */
export function usePressedButton(): () => Element | null {
  const last = useRef<{ el: Element; at: number } | null>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const el = e.target instanceof Element ? e.target.closest("button") : null;
      last.current = el ? { el, at: Date.now() } : null;
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, []);
  // The button pressed within the last second, if any.
  return useCallback(() => {
    const hit = last.current;
    return hit && Date.now() - hit.at < 1000 ? hit.el : null;
  }, []);
}
