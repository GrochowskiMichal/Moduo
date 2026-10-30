import { Link2, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Input, NumberInput } from "@/components/ui/input";

import type { GuestQuestion } from "../booking/model";
import { bookingPublicUrl } from "../booking/public-origin";
import type { WeeklyHours } from "../booking/slots";
import type { VideoSetting } from "../booking/video";
import type { CalendarAccountModel } from "../events";
import { BookingLinkMore, type GuestReminderMinutes } from "./booking-link-more";
import { OptionChip } from "./booking-link-parts";
import { BookingLinkReady, type CreatedLink } from "./booking-link-ready";
import { BookingLinkWhen } from "./booking-link-when";
import { BookingLinkWhere } from "./booking-link-where";

export { type GuestReminderMinutes, reminderFromOption } from "./booking-link-more";

export type LinkDraft = {
  id: string | null;
  slotId: string | null;
  slug: string | null;
  name: string;
  description: string;
  durationMinutes: number;
  bufferBefore: number;
  bufferAfter: number;
  horizonDays: number;
  minNoticeMinutes: number;
  hostTimeZone: string;
  weeklyHours: WeeklyHours;
  busyCalendarIds: string[];
  noteEnabled: boolean;
  guestsEnabled: boolean;
  questions: GuestQuestion[];
  paused: boolean;
  video: VideoSetting;
  /** "Remind guests" (TX-6): minutes before the meeting, or null for off. */
  guestReminderMinutes: GuestReminderMinutes;
  /** Other workspace members who host this link with you. */
  cohostIds: string[];
  /** The co-hosts as last saved (null until loaded for an existing link). */
  savedCohostIds: string[] | null;
};

/**
 * Collective (co-host) booking links stay off until the booking page combines
 * every host's own calendars and co-hosts can see and accept the request
 * (PERM-8 follow-up). The database side is live and unused.
 */
export const COLLECTIVE_LINKS_ENABLED = false;

/** New and existing links start at 24 hours (specs/transactional-email.md Q36). */
export const DEFAULT_GUEST_REMINDER_MINUTES: GuestReminderMinutes = 1440;

const LENGTHS = [15, 30, 45, 60];

type Props = {
  draft: LinkDraft | null;
  accounts: CalendarAccountModel[];
  googleOn: boolean;
  zoom: { configured: boolean; connected: boolean };
  busy: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onChange: (draft: LinkDraft) => void;
  onConnect: () => void;
  onConnectZoom: () => void;
  onDisconnectZoom: () => void;
  onSave: () => void;
  onDelete: () => void;
  teammates?: { userId: string; name: string }[];
  /** A link just created: the dialog shows its ready-to-share step instead of the editor. */
  created?: CreatedLink | null;
  onEditCreated?: () => void;
};

/** The link's address without the scheme ("moduo.app/book/intro-x1y2"). */
function linkAddress(slug: string): string {
  return bookingPublicUrl(slug, window.location).replace(/^https?:\/\//, "");
}

export function BookingLinkDialog({
  draft,
  onOpenChange,
  created = null,
  onEditCreated,
  ...rest
}: Props) {
  return (
    <Dialog open={draft != null || created != null} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[min(40rem,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0">
        {created ? (
          <BookingLinkReady
            link={created}
            onEdit={() => onEditCreated?.()}
            onDone={() => onOpenChange(false)}
          />
        ) : draft ? (
          // Keyed on the link, so the open row, the per-day mode and the
          // delete confirmation start fresh for each link opened.
          <LinkEditor
            key={draft.id ?? "new"}
            draft={draft}
            onClose={() => onOpenChange(false)}
            {...rest}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function LinkEditor({
  draft,
  accounts,
  googleOn,
  zoom,
  busy,
  error,
  onClose,
  onChange,
  onConnect,
  onConnectZoom,
  onDisconnectZoom,
  onSave,
  onDelete,
  teammates = [],
}: Omit<Props, "draft" | "onOpenChange"> & { draft: LinkDraft; onClose: () => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const custom = !LENGTHS.includes(draft.durationMinutes);
  return (
    <>
      <DialogHeader className="shrink-0 gap-1 border-b border-hairline px-6 pt-5 pr-14 pb-4">
        <DialogTitle className="sr-only">
          {draft.id ? "Edit booking link" : "New booking link"}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Guests pick a time on your link. The meeting is added to Google and to Moduo.
        </DialogDescription>
        <Input
          variant="ghost"
          value={draft.name}
          aria-label="Meeting name"
          placeholder="Name this meeting"
          className="-ml-3 font-display text-xl"
          onChange={(e) => onChange({ ...draft, name: e.target.value })}
        />
        {draft.slug ? (
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <Link2 aria-hidden className="size-icon-xs shrink-0" />
            <span className="truncate">{linkAddress(draft.slug)}</span>
          </p>
        ) : null}
      </DialogHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-x-hidden overflow-y-auto px-6 py-5">
        <section className="flex flex-col gap-2">
          <Eyebrow as="h2">Length</Eyebrow>
          <fieldset aria-label="Length" className="min-w-0 flex flex-wrap items-center gap-1">
            {LENGTHS.map((minutes) => (
              <OptionChip
                key={minutes}
                on={draft.durationMinutes === minutes}
                onClick={() => onChange({ ...draft, durationMinutes: minutes })}
              >
                {minutes} min
              </OptionChip>
            ))}
            <OptionChip
              on={custom}
              onClick={() => {
                if (!custom) onChange({ ...draft, durationMinutes: 20 });
              }}
            >
              Custom
            </OptionChip>
            {custom ? (
              <span className="ml-2 flex items-center gap-2 text-sm text-muted-foreground">
                <NumberInput
                  size="sm"
                  min={5}
                  max={240}
                  step={5}
                  className="w-16"
                  value={draft.durationMinutes}
                  aria-label="Custom length in minutes"
                  onValueChange={(minutes) =>
                    onChange({ ...draft, durationMinutes: minutes ?? 30 })
                  }
                />
                min
              </span>
            ) : null}
          </fieldset>
        </section>
        <BookingLinkWhere
          video={draft.video}
          googleOn={googleOn}
          zoom={zoom}
          busy={busy}
          onVideo={(video) => onChange({ ...draft, video })}
          onConnect={onConnect}
          onConnectZoom={onConnectZoom}
          onDisconnectZoom={onDisconnectZoom}
        />
        <BookingLinkWhen
          weeklyHours={draft.weeklyHours}
          hostTimeZone={draft.hostTimeZone}
          onChange={(weeklyHours) => onChange({ ...draft, weeklyHours })}
        />
        <BookingLinkMore
          draft={draft}
          accounts={accounts}
          hosts={COLLECTIVE_LINKS_ENABLED ? teammates : []}
          onChange={onChange}
        />
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-hairline px-6 py-3">
        {confirmDelete ? (
          <>
            <p className="min-w-0 flex-1 text-sm text-foreground">
              Delete this link? Anyone who opens it will see it's no longer available. Meetings
              already booked stay.
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setConfirmDelete(false)}
            >
              Keep it
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={onDelete}
            >
              Delete link
            </Button>
          </>
        ) : (
          <>
            {draft.id ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5 text-destructive hover:bg-destructive/10"
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 aria-hidden />
                Delete
              </Button>
            ) : null}
            {error ? (
              <p role="alert" className="min-w-0 flex-1 text-sm text-destructive">
                {error}
              </p>
            ) : (
              <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                Guests only ever see when you're free, never what's on your calendar.
              </p>
            )}
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="button" disabled={busy} onClick={onSave}>
              {busy ? "Saving…" : draft.id ? "Save link" : "Create link"}
            </Button>
          </>
        )}
      </div>
    </>
  );
}
