// The event Detail (the popover's big sibling, DESIGN_BRIEF §5): inline title,
// time range + all-day, repeat control (series-edit only in v1 — said plainly),
// notes, spine Links (EntityHub, rail variant), the quiet activity trail, and
// Delete. External events render the same layout read-only with source
// attribution. CAL-3's switcher will host this as the "Detail" variant.

import { Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Field } from "../../../components/ui/field";
import { IconButton } from "../../../components/ui/icon-button";
import { Input } from "../../../components/ui/input";
import { Separator } from "../../../components/ui/separator";
import { Switch } from "../../../components/ui/switch";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { timeAgo } from "../../contacts/rollup";
import { spineActivityLine, spineActorName } from "../../spine/activity";
import { EntityTextEditor } from "../../spine/editor/entity-text-editor";
import { useEntityHub } from "../../spine/hooks/use-entity-hub";
import { EntityHub } from "../../spine/ui/entity-hub";
import { EntityRichText } from "../../spine/ui/entity-rich-text";
import { toLocalInputValue } from "../../tasks/helpers";
import type { ActivityEntry } from "../../tasks/model";
import type { CalendarAccountModel, CalendarEventModel, CalendarEventPatch } from "../events";
import { RepeatPicker } from "./repeat-picker";

type Props = {
  runtime: ModuoRuntime | null;
  workspaceId: string;
  currentUserId: string | null;
  event: CalendarEventModel;
  accounts: CalendarAccountModel[];
  canEdit: boolean;
  onPatch: (eventId: string, patch: CalendarEventPatch) => void;
  onDeleteRequest: (eventId: string) => void;
  onClose: () => void;
};

export function EventDetailPanel({
  runtime,
  workspaceId,
  currentUserId,
  event,
  accounts,
  canEdit,
  onPatch,
  onDeleteRequest,
  onClose,
}: Props) {
  const external = event.sourceAccountId !== null;
  const editable = canEdit && !external;
  const account = useMemo(
    () => accounts.find((a) => a.id === event.sourceAccountId) ?? null,
    [accounts, event.sourceAccountId],
  );

  const [title, setTitle] = useState(event.title);
  // Notes are a Lexical editor (DF-23 — `@mention` / `/ref` inline, stored as
  // HTML); it seeds itself and commits on blur, so no local draft state here.
  // Times are draft state committed on blur/Enter — datetime-local fires
  // change per keyboard segment edit; committing per keystroke would write
  // garbage intermediates ("year 0002") to the whole series.
  const [startDraft, setStartDraft] = useState(() => toLocalInputValue(event.startsAt));
  const [endDraft, setEndDraft] = useState(() => toLocalInputValue(event.endsAt));
  useEffect(() => {
    setTitle(event.title);
    setStartDraft(toLocalInputValue(event.startsAt));
    setEndDraft(toLocalInputValue(event.endsAt));
  }, [event.id, event.title, event.startsAt, event.endsAt]);

  const focus = useMemo(() => ({ type: "event", id: event.id }) as const, [event.id]);
  const hub = useEntityHub(runtime, workspaceId, focus);

  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!runtime) return;
      try {
        // Entity-scoped, module OMITTED — event activity logs under
        // module='calendar' (the CO-2 listActivity lesson).
        const rows = await runtime.tasks.listActivity({
          workspaceId,
          entityType: "event",
          entityId: event.id,
          limit: 20,
        });
        if (!cancelled) setActivity(rows);
      } catch {
        if (!cancelled) setActivity([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runtime, workspaceId, event.id, event.updatedAt]);

  const commitTitle = useCallback(() => {
    const trimmed = title.trim();
    if (!trimmed || trimmed === event.title) {
      setTitle(event.title);
      return;
    }
    onPatch(event.id, { title: trimmed });
  }, [title, event.id, event.title, onPatch]);

  const commitTime = useCallback(
    (key: "startsAt" | "endsAt", value: string, current: string) => {
      const parsed = value ? new Date(value) : null;
      if (!parsed || Number.isNaN(parsed.getTime())) {
        // Revert an incomplete draft rather than writing garbage.
        if (key === "startsAt") setStartDraft(toLocalInputValue(current));
        else setEndDraft(toLocalInputValue(current));
        return;
      }
      const iso = parsed.toISOString();
      if (iso !== current) onPatch(event.id, { [key]: iso });
    },
    [event.id, onPatch],
  );

  const now = new Date();

  return (
    <div className="scrollbar-thin flex h-full min-h-0 flex-col gap-3 overflow-y-auto">
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
          Event
        </span>
        <IconButton icon={X} label="Close details" onClick={onClose} />
      </div>

      {editable ? (
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          aria-label="Event title"
          className="font-display text-base font-medium"
        />
      ) : (
        <span className="font-display text-base font-medium text-foreground">{event.title}</span>
      )}

      {external ? (
        <span className="text-xs text-muted-foreground">
          {account ? `${account.displayLabel} — ${account.provider}` : "External calendar"}
          {account?.lastSyncAt ? ` · synced ${timeAgo(account.lastSyncAt, now)}` : ""} · managed in
          its source calendar
        </span>
      ) : null}

      <Field label="Starts">
        {editable ? (
          <Input
            type="datetime-local"
            value={startDraft}
            onChange={(e) => setStartDraft(e.target.value)}
            onBlur={() => commitTime("startsAt", startDraft, event.startsAt)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            aria-label="Starts at"
          />
        ) : (
          <span className="text-sm text-foreground">
            {new Date(event.startsAt).toLocaleString()}
          </span>
        )}
      </Field>
      <Field label="Ends">
        {editable ? (
          <Input
            type="datetime-local"
            value={endDraft}
            onChange={(e) => setEndDraft(e.target.value)}
            onBlur={() => commitTime("endsAt", endDraft, event.endsAt)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            aria-label="Ends at"
          />
        ) : (
          <span className="text-sm text-foreground">{new Date(event.endsAt).toLocaleString()}</span>
        )}
      </Field>
      <Field label="All day">
        <Switch
          checked={event.allDay}
          disabled={!editable}
          onCheckedChange={(v) => onPatch(event.id, { allDay: v })}
          aria-label="All day"
        />
      </Field>

      <Field label="Repeats">
        <div className="flex min-w-0 flex-col gap-1">
          <RepeatPicker
            value={event.rrule}
            disabled={!editable}
            onChange={(rrule) => onPatch(event.id, { rrule })}
          />
          {editable && event.rrule ? (
            <span className="text-2xs text-muted-foreground">Edits apply to the whole series.</span>
          ) : null}
        </div>
      </Field>

      <Field label="Notes">
        {editable ? (
          <EntityTextEditor
            key={event.id}
            value={event.description}
            editable
            runtime={runtime}
            workspaceId={workspaceId}
            source={{ type: "event", id: event.id }}
            sourceLabel={event.title}
            sourceIcon="event"
            currentUserId={currentUserId}
            ariaLabel="Notes"
            placeholder="Notes…  @ or / to link"
            onCommit={(html) => {
              if (html !== event.description) onPatch(event.id, { description: html });
            }}
          />
        ) : event.description ? (
          <EntityRichText html={event.description} className="text-sm text-foreground" />
        ) : (
          <span className="text-sm text-foreground">—</span>
        )}
      </Field>

      <Separator />

      {/* Spine links — linking external events into the workspace is the whole
          point of mirroring their metadata (§8). */}
      <EntityHub
        variant="rail"
        status={hub.status}
        sections={hub.sections}
        canEdit={canEdit}
        onRetry={hub.reload}
      />

      <Separator />

      <div className="flex flex-col gap-1.5">
        <span className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
          Activity
        </span>
        {activity.length === 0 ? (
          <span className="text-xs text-muted-foreground">No activity yet.</span>
        ) : (
          activity.map((entry) => (
            <div key={entry.id} className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                <span className="text-foreground">{spineActorName(entry, currentUserId)}</span>{" "}
                {spineActivityLine(entry)}
              </span>
              <span className="shrink-0 text-2xs text-muted-foreground/70">
                {timeAgo(entry.createdAt, now)}
              </span>
            </div>
          ))
        )}
      </div>

      {editable ? (
        <>
          <Separator />
          <Button
            variant="ghost"
            size="sm"
            className="justify-start gap-1.5 text-destructive hover:bg-destructive/10"
            onClick={() => onDeleteRequest(event.id)}
          >
            <Trash2 aria-hidden />
            Delete event
          </Button>
        </>
      ) : null}
    </div>
  );
}
