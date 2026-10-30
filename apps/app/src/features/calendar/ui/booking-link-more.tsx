import { GUEST_REMINDER_MINUTES, type GuestReminderMinute } from "@contracts/vocabularies";
import {
  AlignLeft,
  Bell,
  CalendarCheck,
  CalendarRange,
  ClipboardList,
  MoveHorizontal,
  Pause,
  Users,
} from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import { FOCUS_BUSY_ID, type GuestQuestion, newQuestionId, TASKS_BUSY_ID } from "../booking/model";
import type { CalendarAccountModel } from "../events";
import type { LinkDraft } from "./booking-link-dialog";
import { ChipLine, MoreRow, OptionChip } from "./booking-link-parts";

// "More options" in the booking link editor: one-line rows that open in
// place, one at a time.

export type GuestReminderMinutes = GuestReminderMinute | null;

const REMINDER_LABEL: Record<GuestReminderMinute, string> = {
  60: "1 hour before",
  1440: "24 hours before",
};

const REMINDER_OPTIONS: { value: string; minutes: GuestReminderMinutes; label: string }[] = [
  { value: "off", minutes: null, label: "Off" },
  ...GUEST_REMINDER_MINUTES.map((minutes) => ({
    value: String(minutes),
    minutes,
    label: REMINDER_LABEL[minutes],
  })),
];

/** The option's value ("off", "60", "1440") as the minutes the link saves; anything unknown is off. */
export function reminderFromOption(value: string): GuestReminderMinutes {
  return REMINDER_OPTIONS.find((option) => option.value === value)?.minutes ?? null;
}

const NOTICE_OPTIONS = [
  { minutes: 0, label: "No minimum" },
  { minutes: 60, label: "1 hour" },
  { minutes: 240, label: "4 hours" },
  { minutes: 720, label: "12 hours" },
  { minutes: 1440, label: "1 day" },
];

const HORIZONS = [
  { days: 7, label: "1 week" },
  { days: 14, label: "2 weeks" },
  { days: 30, label: "30 days" },
  { days: 60, label: "60 days" },
  { days: 90, label: "90 days" },
];

const BUFFERS = [0, 5, 10, 15, 30, 60];

function optionsWith(values: number[], current: number): number[] {
  return values.includes(current) ? values : [...values, current].sort((a, b) => a - b);
}

function horizonLabel(days: number): string {
  return HORIZONS.find((option) => option.days === days)?.label ?? `${days} days`;
}

function noticeLabel(minutes: number): string {
  const known = NOTICE_OPTIONS.find((option) => option.minutes === minutes)?.label;
  if (known) return known;
  if (minutes % 60 === 0) return `${minutes / 60} hours`;
  return `${minutes} min`;
}

function bufferLabel(minutes: number): string {
  return minutes === 0 ? "None" : `${minutes} min`;
}

type Row = "description" | "window" | "buffers" | "form" | "remind" | "conflicts" | "hosts";

type Props = {
  draft: LinkDraft;
  accounts: CalendarAccountModel[];
  /** Co-hosts to pick from; the Hosts row shows only when this is non-empty. */
  hosts: { userId: string; name: string }[];
  onChange: (draft: LinkDraft) => void;
};

type FieldsProps = { draft: LinkDraft; onChange: (draft: LinkDraft) => void };

// Each row's one-line summary, from the draft alone.

function descriptionSummary(draft: LinkDraft): string {
  return draft.description.trim().split("\n")[0] || "None";
}

function windowSummary(draft: LinkDraft): string {
  const notice =
    draft.minNoticeMinutes === 0
      ? "no minimum notice"
      : `${noticeLabel(draft.minNoticeMinutes)} notice`;
  return `Up to ${horizonLabel(draft.horizonDays)} ahead · ${notice}`;
}

function buffersSummary(draft: LinkDraft): string {
  const parts = [
    draft.bufferBefore ? `${draft.bufferBefore} min before` : null,
    draft.bufferAfter ? `${draft.bufferAfter} min after` : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "None";
}

function formSummary(draft: LinkDraft): string {
  const count = draft.questions.length;
  return [
    "Name",
    "email",
    ...(draft.noteEnabled ? ["short note"] : []),
    ...(draft.guestsEnabled ? ["extra guests"] : []),
    ...(count > 0 ? [`${count} question${count === 1 ? "" : "s"}`] : []),
  ].join(", ");
}

function reminderSummary(draft: LinkDraft): string {
  return draft.guestReminderMinutes === null
    ? "Off"
    : `Guests get an email ${REMINDER_LABEL[draft.guestReminderMinutes]}`;
}

function conflictsSummary(draft: LinkDraft, accounts: CalendarAccountModel[]): string {
  const ids = draft.busyCalendarIds;
  const names = [
    ids.includes("moduo") ? "Moduo" : null,
    ids.includes(FOCUS_BUSY_ID) ? "Focus time" : null,
    ids.includes(TASKS_BUSY_ID) ? "Work sessions" : null,
    ...accounts
      .filter((account) => ids.includes(account.id))
      .map((account) => account.displayLabel || account.provider),
  ].filter(Boolean);
  return names.length > 0 ? names.join(", ") : "Nothing checked";
}

function hostsSummary(draft: LinkDraft, hosts: { userId: string; name: string }[]): string {
  const cohosts = hosts.filter((person) => draft.cohostIds.includes(person.userId));
  if (cohosts.length === 0) return "Just you";
  if (cohosts.length === 1) return `You and ${cohosts[0].name}`;
  return `You and ${cohosts.length} others`;
}

export function BookingLinkMore({ draft, accounts, hosts, onChange }: Props) {
  const [open, setOpen] = useState<Row | null>(null);
  const row = (key: Row) => ({
    open: open === key,
    onToggle: () => setOpen((current) => (current === key ? null : key)),
  });

  return (
    <section className="flex flex-col">
      <Eyebrow as="h2" className="mb-1">
        More options
      </Eyebrow>
      <MoreRow
        icon={AlignLeft}
        title="Description"
        summary={descriptionSummary(draft)}
        {...row("description")}
      >
        <Textarea
          value={draft.description}
          rows={3}
          aria-label="Description"
          placeholder="What this meeting is for"
          onChange={(e) => onChange({ ...draft, description: e.target.value })}
        />
      </MoreRow>
      <MoreRow
        icon={CalendarRange}
        title="Booking window"
        summary={windowSummary(draft)}
        {...row("window")}
      >
        <WindowFields draft={draft} onChange={onChange} />
      </MoreRow>
      <MoreRow
        icon={MoveHorizontal}
        title="Breathing room"
        summary={buffersSummary(draft)}
        {...row("buffers")}
      >
        <BufferFields draft={draft} onChange={onChange} />
      </MoreRow>
      <MoreRow
        icon={ClipboardList}
        title="Guest form"
        summary={formSummary(draft)}
        {...row("form")}
      >
        <GuestFormFields draft={draft} onChange={onChange} />
      </MoreRow>
      <MoreRow icon={Bell} title="Reminder" summary={reminderSummary(draft)} {...row("remind")}>
        <ReminderFields draft={draft} onChange={onChange} />
      </MoreRow>
      <MoreRow
        icon={CalendarCheck}
        title="Check for conflicts"
        summary={conflictsSummary(draft, accounts)}
        {...row("conflicts")}
      >
        <ConflictFields draft={draft} accounts={accounts} onChange={onChange} />
      </MoreRow>
      {hosts.length > 0 ? (
        <MoreRow icon={Users} title="Hosts" summary={hostsSummary(draft, hosts)} {...row("hosts")}>
          <HostFields draft={draft} hosts={hosts} onChange={onChange} />
        </MoreRow>
      ) : null}
      {draft.id ? <PauseLine draft={draft} onChange={onChange} /> : null}
    </section>
  );
}

function WindowFields({ draft, onChange }: FieldsProps) {
  return (
    <>
      <ChipLine label="How far ahead">
        {optionsWith(
          HORIZONS.map((option) => option.days),
          draft.horizonDays,
        ).map((days) => (
          <OptionChip
            key={days}
            on={draft.horizonDays === days}
            onClick={() => onChange({ ...draft, horizonDays: days })}
          >
            {horizonLabel(days)}
          </OptionChip>
        ))}
      </ChipLine>
      <ChipLine label="Minimum notice">
        {optionsWith(
          NOTICE_OPTIONS.map((option) => option.minutes),
          draft.minNoticeMinutes,
        ).map((minutes) => (
          <OptionChip
            key={minutes}
            on={draft.minNoticeMinutes === minutes}
            onClick={() => onChange({ ...draft, minNoticeMinutes: minutes })}
          >
            {noticeLabel(minutes)}
          </OptionChip>
        ))}
      </ChipLine>
    </>
  );
}

function BufferFields({ draft, onChange }: FieldsProps) {
  return (
    <>
      <ChipLine label="Buffer before">
        {optionsWith(BUFFERS, draft.bufferBefore).map((minutes) => (
          <OptionChip
            key={minutes}
            on={draft.bufferBefore === minutes}
            onClick={() => onChange({ ...draft, bufferBefore: minutes })}
          >
            {bufferLabel(minutes)}
          </OptionChip>
        ))}
      </ChipLine>
      <ChipLine label="Buffer after">
        {optionsWith(BUFFERS, draft.bufferAfter).map((minutes) => (
          <OptionChip
            key={minutes}
            on={draft.bufferAfter === minutes}
            onClick={() => onChange({ ...draft, bufferAfter: minutes })}
          >
            {bufferLabel(minutes)}
          </OptionChip>
        ))}
      </ChipLine>
    </>
  );
}

function GuestFormFields({ draft, onChange }: FieldsProps) {
  const setQuestions = (questions: GuestQuestion[]) => onChange({ ...draft, questions });
  return (
    <>
      <p className="text-sm text-muted-foreground">Name and email are always required.</p>
      <label className="flex items-center justify-between gap-3 text-sm text-foreground">
        Short note
        <Switch
          checked={draft.noteEnabled}
          onCheckedChange={(checked) => onChange({ ...draft, noteEnabled: checked })}
        />
      </label>
      <div className="flex flex-col gap-1">
        <label className="flex items-center justify-between gap-3 text-sm text-foreground">
          Add guests
          <Switch
            checked={draft.guestsEnabled}
            onCheckedChange={(checked) => onChange({ ...draft, guestsEnabled: checked })}
          />
        </label>
        <p className="text-sm text-muted-foreground">
          The person booking can invite others. Each one gets the calendar invite with the video
          link.
        </p>
      </div>
      {draft.questions.map((question, index) => (
        <QuestionRow
          key={question.id}
          questions={draft.questions}
          index={index}
          onChange={setQuestions}
        />
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-fit"
        onClick={() =>
          setQuestions([...draft.questions, { id: newQuestionId(), label: "", required: false }])
        }
      >
        Add a question
      </Button>
    </>
  );
}

function QuestionRow({
  questions,
  index,
  onChange,
}: {
  questions: GuestQuestion[];
  index: number;
  onChange: (questions: GuestQuestion[]) => void;
}) {
  const question = questions[index];
  const update = (patch: Partial<GuestQuestion>) =>
    onChange(questions.map((item) => (item.id === question.id ? { ...item, ...patch } : item)));
  return (
    <div className="flex items-center gap-2">
      <Input
        size="sm"
        value={question.label}
        placeholder="Question"
        aria-label="Question"
        onChange={(e) => update({ label: e.target.value })}
      />
      <label className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
        <Checkbox
          checked={question.required}
          onCheckedChange={(checked) => update({ required: checked === true })}
        />
        Required
      </label>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={index === 0}
        onClick={() =>
          onChange(
            questions.map((item, itemIndex) => {
              if (itemIndex === index - 1) return question;
              if (itemIndex === index) return questions[index - 1];
              return item;
            }),
          )
        }
      >
        Up
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onChange(questions.filter((item) => item.id !== question.id))}
      >
        Remove
      </Button>
    </div>
  );
}

function ReminderFields({ draft, onChange }: FieldsProps) {
  return (
    <ChipLine label="Remind guests">
      {REMINDER_OPTIONS.map((option) => (
        <OptionChip
          key={option.value}
          on={draft.guestReminderMinutes === option.minutes}
          onClick={() =>
            onChange({ ...draft, guestReminderMinutes: reminderFromOption(option.value) })
          }
        >
          {option.label}
        </OptionChip>
      ))}
    </ChipLine>
  );
}

function ConflictFields({
  draft,
  accounts,
  onChange,
}: FieldsProps & { accounts: CalendarAccountModel[] }) {
  const calendars = [
    // Moduo goes first in the list it saves; the rest are appended.
    { id: "moduo", label: "Moduo", first: true },
    { id: FOCUS_BUSY_ID, label: "Focus time", first: false },
    { id: TASKS_BUSY_ID, label: "Work sessions from Tasks", first: false },
    ...accounts.map((account) => ({
      id: account.id,
      label: account.displayLabel || account.provider,
      first: false,
    })),
  ];
  const toggle = (id: string, checked: boolean, first: boolean) => {
    const rest = draft.busyCalendarIds.filter((item) => item !== id);
    const added = first ? [id, ...rest] : [...rest, id];
    onChange({ ...draft, busyCalendarIds: checked ? added : rest });
  };
  return (
    <>
      <p className="text-sm text-muted-foreground">
        Checked calendars hide times. Booked meetings go on your Google calendar, or on Moduo when
        Google isn't connected.
      </p>
      {calendars.map((calendar) => (
        <label key={calendar.id} className="flex items-center gap-2 text-sm text-foreground">
          <Checkbox
            checked={draft.busyCalendarIds.includes(calendar.id)}
            onCheckedChange={(checked) => toggle(calendar.id, checked === true, calendar.first)}
          />
          {calendar.label}
        </label>
      ))}
    </>
  );
}

function HostFields({
  draft,
  hosts,
  onChange,
}: FieldsProps & { hosts: { userId: string; name: string }[] }) {
  return (
    <>
      <p className="text-sm text-muted-foreground">
        Also book with — they have to accept before the link offers times.
      </p>
      <fieldset aria-label="Hosts" className="flex min-w-0 flex-wrap gap-1">
        {hosts.map((person) => {
          const on = draft.cohostIds.includes(person.userId);
          return (
            <OptionChip
              key={person.userId}
              shape="full"
              on={on}
              onClick={() =>
                onChange({
                  ...draft,
                  cohostIds: on
                    ? draft.cohostIds.filter((id) => id !== person.userId)
                    : [...draft.cohostIds, person.userId],
                })
              }
            >
              {person.name}
            </OptionChip>
          );
        })}
      </fieldset>
    </>
  );
}

function PauseLine({ draft, onChange }: FieldsProps) {
  return (
    <div className="flex min-h-(--ctrl-h-lg) items-center gap-3 border-t border-hairline px-1">
      <Pause aria-hidden className="size-icon-sm shrink-0 text-muted-foreground" />
      <span className="w-36 shrink-0 font-display text-base text-foreground">Pause this link</span>
      <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
        {draft.paused ? "Guests can't book it" : "Taking bookings"}
      </span>
      <Switch
        checked={draft.paused}
        aria-label="Pause this link"
        onCheckedChange={(checked) => onChange({ ...draft, paused: checked })}
      />
    </div>
  );
}
