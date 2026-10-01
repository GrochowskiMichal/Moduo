// Booking links on the calendar rail. Several named links, weekly hours, which
// calendars count as busy, and the guest questions. Google Meet is the only
// video option that works; Zoom and Moduo video stay visible and disabled.

import { Copy, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Checkbox } from "../../../components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
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
import { isTauriRuntime } from "../../../lib/runtime";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { supabaseClient } from "../../../lib/runtime.web";
import {
  busyIdsFromJson,
  type GuestQuestion,
  newQuestionId,
  questionsFromJson,
  slugFor,
  VIDEO_CHOICES,
} from "../booking/model";
import {
  DEFAULT_WEEKLY_HOURS,
  normalizeWeeklyHours,
  WEEKDAYS,
  type Weekday,
  type WeeklyHours,
} from "../booking/slots";
import type { CalendarAccountModel } from "../events";

type Props = {
  runtime: ModuoRuntime | null;
  workspaceId: string;
  userId: string;
  accounts: CalendarAccountModel[];
};

type LinkRow = {
  id: string;
  slot_id: string;
  slug: string;
  name: string;
  description: string;
  duration_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  date_range_days: number;
  min_notice_minutes: number;
  host_timezone: string;
  weekly_hours: unknown;
  busy_calendar_ids: unknown;
  note_enabled: boolean;
  questions_json: unknown;
  paused: boolean;
};

type Draft = {
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
  questions: GuestQuestion[];
  paused: boolean;
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

function emptyDraft(): Draft {
  return {
    id: null,
    slotId: null,
    slug: null,
    name: "",
    description: "",
    durationMinutes: 30,
    bufferBefore: 0,
    bufferAfter: 0,
    horizonDays: 14,
    minNoticeMinutes: 240,
    hostTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    weeklyHours: normalizeWeeklyHours(DEFAULT_WEEKLY_HOURS),
    busyCalendarIds: ["moduo"],
    noteEnabled: true,
    questions: [],
    paused: false,
  };
}

function draftFromRow(row: LinkRow): Draft {
  return {
    id: row.id,
    slotId: row.slot_id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    durationMinutes: row.duration_minutes,
    bufferBefore: row.buffer_before_minutes,
    bufferAfter: row.buffer_after_minutes,
    horizonDays: row.date_range_days,
    minNoticeMinutes: row.min_notice_minutes,
    hostTimeZone: row.host_timezone || "UTC",
    weeklyHours: normalizeWeeklyHours(row.weekly_hours),
    busyCalendarIds: busyIdsFromJson(row.busy_calendar_ids),
    noteEnabled: row.note_enabled,
    questions: questionsFromJson(row.questions_json),
    paused: row.paused,
  };
}

function publicUrl(slug: string): string {
  return `${window.location.origin}/book/${slug}`;
}

export function BookingLinks({ runtime, workspaceId, userId, accounts }: Props) {
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [googleOn, setGoogleOn] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [rows, connected] = await Promise.all([
      supabaseClient
        .from("exposed_slot_links")
        .select("*")
        .eq("owner_user_id", userId)
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: true }),
      supabaseClient.rpc("booking_google_connected"),
    ]);
    if (!rows.error && rows.data) setLinks(rows.data as LinkRow[]);
    if (!connected.error) setGoogleOn(Boolean(connected.data));
  }, [userId, workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const connectGoogle = async () => {
    setBusy(true);
    setError(null);
    try {
      if (isTauriRuntime()) {
        const { invoke } = await import("@tauri-apps/api/core");
        let accountId = accounts.find((account) => account.provider === "google")?.externalId;
        if (!accountId) {
          const result = await invoke<{ accountId: string; email: string; displayName: string }>(
            "calendar_google_oauth_start",
          );
          accountId = result.accountId;
          if (runtime) {
            await runtime.calendar.upsertAccount({
              workspaceId,
              provider: "google",
              externalId: result.accountId,
              displayLabel: result.email || result.displayName,
              color: null,
              status: "ok",
              lastSyncAt: new Date().toISOString(),
            });
          }
        }
        await invoke("calendar_google_publish_booking_token", { accountId });
        await refresh();
      } else {
        const { data, error: fnError } = await supabaseClient.functions.invoke(
          "booking-google-connect",
          { body: { origin: window.location.origin } },
        );
        if (fnError) throw fnError;
        const url = (data as { url?: string } | null)?.url;
        if (!url) throw new Error("Google connect did not return a sign-in page.");
        window.location.href = url;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect Google.");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) {
      setError("Give the link a name.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const user = await supabaseClient.auth.getUser();
      const profile = await supabaseClient
        .from("profiles")
        .select("display_name, avatar_url")
        .eq("id", userId)
        .maybeSingle();
      const email = user.data.user?.email ?? null;
      const payload = {
        name,
        link_name: name,
        description: draft.description.trim(),
        duration_minutes: draft.durationMinutes,
        buffer_before_minutes: draft.bufferBefore,
        buffer_after_minutes: draft.bufferAfter,
        date_range_days: draft.horizonDays,
        min_notice_minutes: draft.minNoticeMinutes,
        host_timezone: draft.hostTimeZone,
        weekly_hours: draft.weeklyHours,
        busy_calendar_ids: draft.busyCalendarIds,
        note_enabled: draft.noteEnabled,
        questions_json: draft.questions.filter((question) => question.label.trim()),
        paused: draft.paused,
        video_provider: "google_meet",
        location_type: "video",
        schedule_type: "weekly",
        conflict_calendars: JSON.stringify(draft.busyCalendarIds),
        owner_email: email,
        owner_display_name: profile.data?.display_name || email || "Host",
        owner_avatar_url: profile.data?.avatar_url ?? null,
        updated_at: new Date().toISOString(),
      };
      if (draft.id) {
        const { error: updateError } = await supabaseClient
          .from("exposed_slot_links")
          .update(payload)
          .eq("id", draft.id);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabaseClient.from("exposed_slot_links").insert({
          ...payload,
          slot_id: crypto.randomUUID(),
          slug: slugFor(name),
          owner_user_id: userId,
          owner_handle: (email ?? "host").split("@")[0] || "host",
          workspace_id: workspaceId,
        });
        if (insertError) throw insertError;
      }
      setDraft(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the link.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async (slug: string) => {
    await navigator.clipboard.writeText(publicUrl(slug));
    setCopied(slug);
    window.setTimeout(() => setCopied((current) => (current === slug ? null : current)), 1500);
  };

  return (
    <div className="flex flex-col gap-1 border-t border-border pt-3">
      <Eyebrow as="div" className="px-1">
        Booking links
      </Eyebrow>
      {links.map((link) => (
        <div key={link.id} className="flex items-center gap-1 px-1">
          <button
            type="button"
            className="min-w-0 flex-1 truncate text-left text-sm text-foreground"
            onClick={() => {
              setError(null);
              setDraft(draftFromRow(link));
            }}
          >
            {link.name}
            {link.paused ? " · paused" : ""}
          </button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!googleOn || link.paused}
            onClick={() => void copy(link.slug)}
          >
            <Copy aria-hidden />
            {copied === link.slug ? "Copied" : "Copy"}
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="justify-start text-muted-foreground"
        onClick={() => {
          setError(null);
          setDraft(emptyDraft());
        }}
      >
        <Plus aria-hidden />
        New booking link
      </Button>

      <Dialog open={draft != null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="max-h-[70vh] overflow-y-auto">
          {draft ? (
            <>
              <DialogHeader>
                <DialogTitle>{draft.id ? "Edit booking link" : "New booking link"}</DialogTitle>
              </DialogHeader>
              {!googleOn ? (
                <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
                  <p className="text-sm text-foreground">
                    Connect Google to turn this link on. Meet is created from that account, and a
                    guest can book while this app is closed.
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() => void connectGoogle()}
                  >
                    Connect Google
                  </Button>
                </div>
              ) : null}
              <label className="flex flex-col gap-1">
                <span className="font-display text-sm text-foreground">Name</span>
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="30 min intro"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-display text-sm text-foreground">Description</span>
                <Textarea
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </label>
              <div className="flex flex-col gap-1">
                <span className="font-display text-sm text-foreground">Length</span>
                <div className="flex flex-wrap gap-1">
                  {[15, 30, 45, 60].map((minutes) => (
                    <Button
                      key={minutes}
                      type="button"
                      size="sm"
                      variant={draft.durationMinutes === minutes ? "secondary" : "ghost"}
                      onClick={() => setDraft({ ...draft, durationMinutes: minutes })}
                    >
                      {minutes} min
                    </Button>
                  ))}
                </div>
                <Input
                  type="number"
                  min={5}
                  max={240}
                  value={draft.durationMinutes}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      durationMinutes: Math.max(5, Math.min(240, Number(e.target.value) || 30)),
                    })
                  }
                  aria-label="Custom length in minutes"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">
                  <span className="font-display text-sm text-foreground">Buffer before</span>
                  <Input
                    type="number"
                    min={0}
                    max={120}
                    value={draft.bufferBefore}
                    onChange={(e) =>
                      setDraft({ ...draft, bufferBefore: Math.max(0, Number(e.target.value) || 0) })
                    }
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-display text-sm text-foreground">Buffer after</span>
                  <Input
                    type="number"
                    min={0}
                    max={120}
                    value={draft.bufferAfter}
                    onChange={(e) =>
                      setDraft({ ...draft, bufferAfter: Math.max(0, Number(e.target.value) || 0) })
                    }
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-display text-sm text-foreground">Days ahead</span>
                  <Input
                    type="number"
                    min={1}
                    max={90}
                    value={draft.horizonDays}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        horizonDays: Math.max(1, Math.min(90, Number(e.target.value) || 14)),
                      })
                    }
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-display text-sm text-foreground">Minimum notice</span>
                  <Select
                    value={String(draft.minNoticeMinutes)}
                    onValueChange={(value) =>
                      setDraft({ ...draft, minNoticeMinutes: Number(value) })
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
              </div>
              <div className="flex flex-col gap-2">
                <span className="font-display text-sm text-foreground">Weekly hours</span>
                <p className="text-xs text-muted-foreground">{draft.hostTimeZone}</p>
                {WEEKDAYS.map((day) => {
                  const window = draft.weeklyHours[day][0];
                  const on = Boolean(window);
                  return (
                    <div key={day} className="flex items-center gap-2">
                      <Checkbox
                        checked={on}
                        onCheckedChange={(checked) => {
                          const weeklyHours = { ...draft.weeklyHours };
                          weeklyHours[day] = checked ? [{ start: "09:00", end: "17:00" }] : [];
                          setDraft({ ...draft, weeklyHours });
                        }}
                        aria-label={DAY_LABEL[day]}
                      />
                      <span className="w-24 text-sm text-foreground">{DAY_LABEL[day]}</span>
                      {on ? (
                        <>
                          <Input
                            type="time"
                            value={window.start}
                            aria-label={`${DAY_LABEL[day]} start`}
                            onChange={(e) => {
                              const weeklyHours = { ...draft.weeklyHours };
                              weeklyHours[day] = [{ start: e.target.value, end: window.end }];
                              setDraft({ ...draft, weeklyHours });
                            }}
                          />
                          <Input
                            type="time"
                            value={window.end}
                            aria-label={`${DAY_LABEL[day]} end`}
                            onChange={(e) => {
                              const weeklyHours = { ...draft.weeklyHours };
                              weeklyHours[day] = [{ start: window.start, end: e.target.value }];
                              setDraft({ ...draft, weeklyHours });
                            }}
                          />
                        </>
                      ) : (
                        <span className="text-sm text-muted-foreground">Unavailable</span>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-col gap-2">
                <span className="font-display text-sm text-foreground">
                  Calendars that count as busy
                </span>
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <Checkbox
                    checked={draft.busyCalendarIds.includes("moduo")}
                    onCheckedChange={(checked) => {
                      const rest = draft.busyCalendarIds.filter((id) => id !== "moduo");
                      setDraft({
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
                        setDraft({
                          ...draft,
                          busyCalendarIds: checked ? [...rest, account.id] : rest,
                        });
                      }}
                    />
                    {account.displayLabel || account.provider}
                  </label>
                ))}
              </div>
              <div className="flex flex-col gap-1">
                <span className="font-display text-sm text-foreground">Video</span>
                <RadioGroup value="google_meet">
                  {VIDEO_CHOICES.map((choice) => (
                    <label
                      key={choice.id}
                      className="flex items-center gap-2 text-sm text-foreground"
                    >
                      <RadioGroupItem value={choice.id} disabled={!choice.enabled} />
                      <span className={choice.enabled ? "" : "text-muted-foreground"}>
                        {choice.label}
                        {choice.enabled ? "" : " · later"}
                      </span>
                    </label>
                  ))}
                </RadioGroup>
              </div>
              <div className="flex flex-col gap-2">
                <span className="font-display text-sm text-foreground">
                  What the guest fills in
                </span>
                <p className="text-sm text-muted-foreground">Name and email are always required.</p>
                <label className="flex items-center justify-between gap-2 text-sm text-foreground">
                  Short note
                  <Switch
                    checked={draft.noteEnabled}
                    onCheckedChange={(checked) => setDraft({ ...draft, noteEnabled: checked })}
                  />
                </label>
                {draft.questions.map((question, index) => (
                  <div key={question.id} className="flex items-center gap-2">
                    <Input
                      value={question.label}
                      aria-label="Question"
                      onChange={(e) =>
                        setDraft({
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
                          setDraft({
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
                        setDraft({
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
                        setDraft({
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
                    setDraft({
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
              </div>
              {draft.id ? (
                <label className="flex items-center justify-between gap-2 text-sm text-foreground">
                  Pause this link
                  <Switch
                    checked={draft.paused}
                    onCheckedChange={(checked) => setDraft({ ...draft, paused: checked })}
                  />
                </label>
              ) : null}
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <DialogFooter>
                <Button type="button" disabled={busy} onClick={() => void save()}>
                  Save link
                </Button>
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
