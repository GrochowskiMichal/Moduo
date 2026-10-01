import { Button } from "../../../components/ui/button";
import { Checkbox } from "../../../components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Eyebrow } from "../../../components/ui/eyebrow";
import { Input } from "../../../components/ui/input";
import { RadioGroup, RadioGroupItem } from "../../../components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { Switch } from "../../../components/ui/switch";
import { Textarea } from "../../../components/ui/textarea";
import { cn } from "../../../lib/utils";
import { type GuestQuestion, newQuestionId } from "../booking/model";
import { WEEKDAYS, type Weekday, type WeeklyHours } from "../booking/slots";
import type { VideoSetting } from "../booking/video";
import type { CalendarAccountModel } from "../events";

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
};

const NOTICE_OPTIONS = [
  { minutes: 0, label: "No minimum" },
  { minutes: 60, label: "1 hour" },
  { minutes: 240, label: "4 hours" },
  { minutes: 720, label: "12 hours" },
  { minutes: 1440, label: "1 day" },
];

const DAY_LABEL: Record<Weekday, string> = {
  sun: "Sunday",
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
};

const DAY_SHORT: Record<Weekday, string> = {
  sun: "Sun",
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
};

const LENGTHS = [15, 30, 45, 60];
const HORIZONS = [
  { days: 7, label: "1 week" },
  { days: 14, label: "2 weeks" },
  { days: 30, label: "30 days" },
  { days: 60, label: "60 days" },
  { days: 90, label: "90 days" },
];
const BUFFERS = [0, 5, 10, 15, 30, 60];

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
};

type VideoRow = {
  id: VideoSetting | "moduo_video";
  label: string;
  hint: string;
  disabled?: boolean;
};

function videoRows(
  googleOn: boolean,
  zoom: { configured: boolean; connected: boolean },
): VideoRow[] {
  const zoomHint = zoom.connected
    ? "Connected"
    : zoom.configured
      ? "Connect your Zoom account to use it"
      : "Not available yet";
  const choiceHint =
    googleOn && zoom.connected
      ? "The person booking picks Google Meet or Zoom"
      : googleOn
        ? "Connect Zoom too, or guests will only see Google Meet"
        : zoom.connected
          ? "Connect Google too, or guests will only see Zoom"
          : "The person booking picks Google Meet or Zoom";
  return [
    { id: "google_meet", label: "Google Meet", hint: googleOn ? "Connected" : "Needs Google" },
    { id: "zoom", label: "Zoom", hint: zoomHint, disabled: !zoom.configured && !zoom.connected },
    {
      id: "guest_choice",
      label: "Their choice",
      hint: choiceHint,
      disabled: !zoom.configured && !zoom.connected,
    },
    { id: "moduo_video", label: "Moduo video", hint: "Later", disabled: true },
  ];
}

function optionsWith(values: number[], current: number): number[] {
  return values.includes(current) ? values : [...values, current].sort((a, b) => a - b);
}

export function BookingLinkDialog({
  draft,
  accounts,
  googleOn,
  zoom,
  busy,
  error,
  onOpenChange,
  onChange,
  onConnect,
  onConnectZoom,
  onDisconnectZoom,
  onSave,
}: Props) {
  const needsGoogle =
    draft != null &&
    !googleOn &&
    (draft.video === "google_meet" || (draft.video === "guest_choice" && !zoom.connected));
  const needsZoom =
    draft != null && !zoom.connected && zoom.configured && draft.video !== "google_meet";
  return (
    <Dialog open={draft != null} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[min(52rem,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden p-0">
        {draft ? (
          <>
            <DialogHeader className="shrink-0 gap-1 border-b border-border px-6 py-4 pr-12">
              <DialogTitle>{draft.id ? "Edit booking link" : "New booking link"}</DialogTitle>
              <DialogDescription>
                Guests pick a time on your link. The meeting is added to Google and to Moduo.
              </DialogDescription>
            </DialogHeader>
            {needsGoogle ? (
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-6 py-3">
                <p className="text-sm text-muted-foreground">
                  Connect Google so this link can create a Meet while the app is closed.
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  onClick={onConnect}
                >
                  Connect Google
                </Button>
              </div>
            ) : null}
            <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-2">
              <div className="flex flex-col gap-6 border-border p-6 lg:border-r">
                <section className="flex flex-col gap-3">
                  <Eyebrow as="h2">Event</Eyebrow>
                  <label className="flex flex-col gap-1">
                    <span className="font-display text-sm text-foreground">Name</span>
                    <Input
                      value={draft.name}
                      onChange={(e) => onChange({ ...draft, name: e.target.value })}
                      placeholder="Intro call"
                    />
                  </label>
                  <div className="flex flex-col gap-2">
                    <span className="font-display text-sm text-foreground">Length</span>
                    <div className="flex flex-wrap gap-1">
                      {LENGTHS.map((minutes) => (
                        <Button
                          key={minutes}
                          type="button"
                          size="sm"
                          variant={draft.durationMinutes === minutes ? "secondary" : "outline"}
                          onClick={() => onChange({ ...draft, durationMinutes: minutes })}
                        >
                          {minutes} min
                        </Button>
                      ))}
                      <Button
                        type="button"
                        size="sm"
                        variant={LENGTHS.includes(draft.durationMinutes) ? "outline" : "secondary"}
                        onClick={() => {
                          if (LENGTHS.includes(draft.durationMinutes)) {
                            onChange({ ...draft, durationMinutes: 20 });
                          }
                        }}
                      >
                        Other
                      </Button>
                    </div>
                    {LENGTHS.includes(draft.durationMinutes) ? null : (
                      <Input
                        type="number"
                        min={5}
                        max={240}
                        value={draft.durationMinutes}
                        aria-label="Custom length in minutes"
                        onChange={(e) =>
                          onChange({
                            ...draft,
                            durationMinutes: Math.max(
                              5,
                              Math.min(240, Number(e.target.value) || 30),
                            ),
                          })
                        }
                      />
                    )}
                  </div>
                  <label className="flex flex-col gap-1">
                    <span className="font-display text-sm text-foreground">Description</span>
                    <Textarea
                      value={draft.description}
                      rows={3}
                      placeholder="What this meeting is for"
                      onChange={(e) => onChange({ ...draft, description: e.target.value })}
                    />
                  </label>
                </section>
                <section className="flex flex-col gap-2">
                  <Eyebrow as="h2">Video</Eyebrow>
                  <RadioGroup
                    value={draft.video}
                    onValueChange={(value) => onChange({ ...draft, video: value as VideoSetting })}
                    className="gap-1"
                  >
                    {videoRows(googleOn, zoom).map((choice) => (
                      <label
                        key={choice.id}
                        className={cn(
                          "flex items-start gap-2 rounded-md px-2 py-1.5 text-sm",
                          choice.disabled
                            ? "text-muted-foreground"
                            : "cursor-pointer text-foreground",
                          draft.video === choice.id && "bg-[var(--selected-bg)]",
                        )}
                      >
                        <RadioGroupItem
                          value={choice.id}
                          disabled={choice.disabled}
                          className="mt-0.5"
                        />
                        <span className="flex min-w-0 flex-col">
                          <span>{choice.label}</span>
                          <span className="text-xs text-muted-foreground">{choice.hint}</span>
                        </span>
                      </label>
                    ))}
                  </RadioGroup>
                  {needsZoom ? (
                    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                      <p className="text-sm text-muted-foreground">
                        Zoom meetings are made on your Zoom account.
                      </p>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={onConnectZoom}
                      >
                        Connect Zoom
                      </Button>
                    </div>
                  ) : null}
                  {zoom.connected ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="w-fit text-muted-foreground"
                      disabled={busy}
                      onClick={onDisconnectZoom}
                    >
                      Disconnect Zoom
                    </Button>
                  ) : null}
                </section>
                <section className="flex flex-col gap-3">
                  <Eyebrow as="h2">Guest form</Eyebrow>
                  <p className="text-sm text-muted-foreground">
                    Name and email are always required.
                  </p>
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
                        onCheckedChange={(checked) =>
                          onChange({ ...draft, guestsEnabled: checked })
                        }
                      />
                    </label>
                    <p className="text-sm text-muted-foreground">
                      The person booking can invite others. Each one gets the calendar invite with
                      the video link.
                    </p>
                  </div>
                  {draft.questions.map((question, index) => (
                    <div key={question.id} className="flex items-center gap-2">
                      <Input
                        value={question.label}
                        placeholder="Question"
                        aria-label="Question"
                        onChange={(e) =>
                          onChange({
                            ...draft,
                            questions: draft.questions.map((item) =>
                              item.id === question.id ? { ...item, label: e.target.value } : item,
                            ),
                          })
                        }
                      />
                      <label className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                        <Checkbox
                          checked={question.required}
                          onCheckedChange={(checked) =>
                            onChange({
                              ...draft,
                              questions: draft.questions.map((item) =>
                                item.id === question.id
                                  ? { ...item, required: checked === true }
                                  : item,
                              ),
                            })
                          }
                        />
                        Required
                      </label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={index === 0}
                        onClick={() =>
                          onChange({
                            ...draft,
                            questions: draft.questions.map((item, itemIndex) => {
                              if (itemIndex === index - 1) return question;
                              if (itemIndex === index) return draft.questions[index - 1];
                              return item;
                            }),
                          })
                        }
                      >
                        Up
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          onChange({
                            ...draft,
                            questions: draft.questions.filter((item) => item.id !== question.id),
                          })
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="justify-start"
                    onClick={() =>
                      onChange({
                        ...draft,
                        questions: [
                          ...draft.questions,
                          { id: newQuestionId(), label: "", required: false },
                        ],
                      })
                    }
                  >
                    Add a question
                  </Button>
                </section>
                {draft.id ? (
                  <label className="flex items-center justify-between gap-3 text-sm text-foreground">
                    Pause this link
                    <Switch
                      checked={draft.paused}
                      onCheckedChange={(checked) => onChange({ ...draft, paused: checked })}
                    />
                  </label>
                ) : null}
              </div>
              <div className="flex flex-col gap-6 bg-muted/30 p-6">
                <section className="flex flex-col gap-3">
                  <Eyebrow as="h2">Weekly hours</Eyebrow>
                  <p className="text-sm text-muted-foreground">{draft.hostTimeZone}</p>
                  <div className="flex flex-col gap-2">
                    {WEEKDAYS.map((day) => {
                      const window = draft.weeklyHours[day][0];
                      const on = Boolean(window);
                      return (
                        <div key={day} className="grid grid-cols-[4.5rem_1fr] items-center gap-2">
                          <span className="text-sm text-foreground">{DAY_SHORT[day]}</span>
                          {on ? (
                            <div className="flex items-center gap-2">
                              <Switch
                                checked
                                aria-label={`${DAY_LABEL[day]} available`}
                                onCheckedChange={() => {
                                  const weeklyHours = { ...draft.weeklyHours, [day]: [] };
                                  onChange({ ...draft, weeklyHours });
                                }}
                              />
                              <Input
                                type="time"
                                className="w-[7.25rem]"
                                value={window.start}
                                aria-label={`${DAY_LABEL[day]} start`}
                                onChange={(e) => {
                                  const weeklyHours = {
                                    ...draft.weeklyHours,
                                    [day]: [{ start: e.target.value, end: window.end }],
                                  };
                                  onChange({ ...draft, weeklyHours });
                                }}
                              />
                              <span className="text-sm text-muted-foreground">to</span>
                              <Input
                                type="time"
                                className="w-[7.25rem]"
                                value={window.end}
                                aria-label={`${DAY_LABEL[day]} end`}
                                onChange={(e) => {
                                  const weeklyHours = {
                                    ...draft.weeklyHours,
                                    [day]: [{ start: window.start, end: e.target.value }],
                                  };
                                  onChange({ ...draft, weeklyHours });
                                }}
                              />
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={false}
                                aria-label={`${DAY_LABEL[day]} available`}
                                onCheckedChange={() => {
                                  const weeklyHours = {
                                    ...draft.weeklyHours,
                                    [day]: [{ start: "09:00", end: "17:00" }],
                                  };
                                  onChange({ ...draft, weeklyHours });
                                }}
                              />
                              <span className="text-sm text-muted-foreground">Unavailable</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
                <section className="grid grid-cols-2 gap-3">
                  <Eyebrow as="h2" className="col-span-2">
                    Limits
                  </Eyebrow>
                  <label className="flex flex-col gap-1">
                    <span className="font-display text-sm text-foreground">How far ahead</span>
                    <Select
                      value={String(draft.horizonDays)}
                      onValueChange={(value) => onChange({ ...draft, horizonDays: Number(value) })}
                    >
                      <SelectTrigger aria-label="How far ahead">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {optionsWith(
                          HORIZONS.map((option) => option.days),
                          draft.horizonDays,
                        ).map((days) => (
                          <SelectItem key={days} value={String(days)}>
                            {HORIZONS.find((option) => option.days === days)?.label ??
                              `${days} days`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="font-display text-sm text-foreground">Minimum notice</span>
                    <Select
                      value={String(draft.minNoticeMinutes)}
                      onValueChange={(value) =>
                        onChange({ ...draft, minNoticeMinutes: Number(value) })
                      }
                    >
                      <SelectTrigger aria-label="Minimum notice">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {NOTICE_OPTIONS.map((option) => (
                          <SelectItem key={option.minutes} value={String(option.minutes)}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="font-display text-sm text-foreground">Buffer before</span>
                    <Select
                      value={String(draft.bufferBefore)}
                      onValueChange={(value) => onChange({ ...draft, bufferBefore: Number(value) })}
                    >
                      <SelectTrigger aria-label="Buffer before">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {optionsWith(BUFFERS, draft.bufferBefore).map((minutes) => (
                          <SelectItem key={minutes} value={String(minutes)}>
                            {minutes === 0 ? "None" : `${minutes} min`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="font-display text-sm text-foreground">Buffer after</span>
                    <Select
                      value={String(draft.bufferAfter)}
                      onValueChange={(value) => onChange({ ...draft, bufferAfter: Number(value) })}
                    >
                      <SelectTrigger aria-label="Buffer after">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {optionsWith(BUFFERS, draft.bufferAfter).map((minutes) => (
                          <SelectItem key={minutes} value={String(minutes)}>
                            {minutes === 0 ? "None" : `${minutes} min`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </label>
                </section>
                <section className="flex flex-col gap-2">
                  <Eyebrow as="h2">Busy calendars</Eyebrow>
                  <p className="text-sm text-muted-foreground">
                    Checked calendars hide times. The meeting still lands on Moduo and Google.
                  </p>
                  <label className="flex items-center gap-2 text-sm text-foreground">
                    <Checkbox
                      checked={draft.busyCalendarIds.includes("moduo")}
                      onCheckedChange={(checked) => {
                        const rest = draft.busyCalendarIds.filter((id) => id !== "moduo");
                        onChange({
                          ...draft,
                          busyCalendarIds: checked ? ["moduo", ...rest] : rest,
                        });
                      }}
                    />
                    Moduo
                  </label>
                  {accounts.map((account) => (
                    <label
                      key={account.id}
                      className="flex items-center gap-2 text-sm text-foreground"
                    >
                      <Checkbox
                        checked={draft.busyCalendarIds.includes(account.id)}
                        onCheckedChange={(checked) => {
                          const rest = draft.busyCalendarIds.filter((id) => id !== account.id);
                          onChange({
                            ...draft,
                            busyCalendarIds: checked ? [...rest, account.id] : rest,
                          });
                        }}
                      />
                      {account.displayLabel || account.provider}
                    </label>
                  ))}
                </section>
              </div>
            </div>
            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-6 py-4">
              <p className="text-sm text-destructive">{error ?? ""}</p>
              <Button type="button" disabled={busy} onClick={onSave}>
                {busy ? "Saving…" : "Save link"}
              </Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
