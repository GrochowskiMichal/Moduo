import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Clock, CornerDownLeft, Inbox, Repeat } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { parseCapture } from "../parse/capture-parser";
import type { NewTaskFields } from "../helpers";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Bucket the captured task lands in (current selection, or Inbox). */
  bucketId: string | null;
  bucketName: string;
  onCreate: (fields: Omit<NewTaskFields, "workspaceId" | "position">) => void;
};

export function CaptureModal({ open, onOpenChange, bucketId, bucketName, onCreate }: Props) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue("");
      // Defer focus until the dialog content is mounted.
      const id = window.setTimeout(() => inputRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  const parsed = useMemo(() => parseCapture(value), [value]);

  const submit = () => {
    const raw = value.trim();
    if (!raw || !bucketId) return;
    const title = parsed.title.trim() || raw;
    onCreate({
      bucketId,
      title,
      dueDate: parsed.dueDate,
      scheduledAt: parsed.scheduledAt,
      recurrence: parsed.recurrence,
    });
    // Confirmation toast — "land directly, fix lazily" (spec §6). Shows what the
    // parser understood so a wrong read is visible immediately.
    toast.success(title, {
      description: parsed.summary
        ? `${parsed.summary} · in ${bucketName}`
        : `Added to ${bucketName}`,
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[20%] translate-y-0 gap-3 p-4 sm:max-w-lg">
        <DialogHeader className="space-y-0">
          <DialogTitle className="text-sm font-medium text-muted-foreground">
            New task in {bucketName}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Type a task. Dates and recurrence are parsed automatically.
          </DialogDescription>
        </DialogHeader>

        <Input
          ref={inputRef}
          value={value}
          placeholder="e.g. Take vitamins every day at 8am"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          className="h-10 text-base"
        />

        <ParsePreview parsed={parsed} bucketName={bucketName} hasInput={value.trim().length > 0} />
      </DialogContent>
    </Dialog>
  );
}

function ParsePreview({
  parsed,
  bucketName,
  hasInput,
}: {
  parsed: ReturnType<typeof parseCapture>;
  bucketName: string;
  hasInput: boolean;
}) {
  return (
    <div className="flex min-h-6 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1">
        <Inbox className="size-3.5" aria-hidden />
        {bucketName}
      </span>

      {parsed.scheduledAt ? (
        <Chip icon={<Clock className="size-3.5" aria-hidden />}>{scheduledLabel(parsed.scheduledAt)}</Chip>
      ) : null}
      {parsed.dueDate ? (
        <Chip icon={<CalendarDays className="size-3.5" aria-hidden />}>Due {dateLabel(parsed.dueDate)}</Chip>
      ) : null}
      {parsed.recurrence ? (
        <Chip icon={<Repeat className="size-3.5" aria-hidden />}>{parsed.summary.replace(/^recurs /, "")}</Chip>
      ) : null}

      {parsed.unparsedRecurrence ? (
        <span className="text-muted-foreground/80">Couldn’t read that recurrence — it’ll be added without one.</span>
      ) : null}

      {hasInput ? (
        <span className="ml-auto flex items-center gap-1 text-muted-foreground/70">
          <CornerDownLeft className="size-3" aria-hidden />
          Enter to add
        </span>
      ) : null}
    </div>
  );
}

function Chip({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-foreground">
      {icon}
      {children}
    </span>
  );
}

const TIME_FMT = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const DATE_FMT = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });
const DATETIME_FMT = new Intl.DateTimeFormat(undefined, {
  weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
});

function scheduledLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  return sameDay ? `Today ${TIME_FMT.format(d)}` : DATETIME_FMT.format(d);
}

function dateLabel(iso: string): string {
  return DATE_FMT.format(new Date(iso));
}
