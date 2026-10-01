// Booking links on the calendar rail. Several named links, weekly hours, which
// calendars count as busy, and the guest questions. Google Meet is the only
// video option that works; Zoom and Moduo video stay visible and disabled.

import { Copy, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Eyebrow } from "../../../components/ui/eyebrow";
import { isTauriRuntime } from "../../../lib/runtime";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { supabaseClient } from "../../../lib/runtime.web";
import { busyIdsFromJson, questionsFromJson, slugFor } from "../booking/model";
import { DEFAULT_WEEKLY_HOURS, normalizeWeeklyHours } from "../booking/slots";
import type { CalendarAccountModel } from "../events";
import { BookingLinkDialog, type LinkDraft } from "./booking-link-dialog";

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

type Draft = LinkDraft;

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

function errorText(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return fallback;
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
      setError(errorText(e, "Could not save the link."));
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

      <BookingLinkDialog
        draft={draft}
        accounts={accounts}
        googleOn={googleOn}
        busy={busy}
        error={error}
        onOpenChange={(open) => {
          if (!open) setDraft(null);
        }}
        onChange={setDraft}
        onConnect={() => void connectGoogle()}
        onSave={() => void save()}
      />
    </div>
  );
}
