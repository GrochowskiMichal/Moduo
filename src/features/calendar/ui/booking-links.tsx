// Booking links on the calendar rail. Several named links, weekly hours, which
// calendars count as busy, and the guest questions. Video is Google Meet,
// Zoom, or the guest's choice of the two; Moduo video stays visible, disabled.

import { Copy, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Eyebrow } from "../../../components/ui/eyebrow";
import { isTauriRuntime } from "../../../lib/runtime";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { supabaseClient } from "../../../lib/runtime.web";
import { busyIdsFromJson, questionsFromJson, slugFor } from "../booking/model";
import { bookingPublicUrl } from "../booking/public-origin";
import { DEFAULT_WEEKLY_HOURS, normalizeWeeklyHours } from "../booking/slots";
import { videoSetting } from "../booking/video";
import type { CalendarAccountModel } from "../events";
import { startWebGoogleConnect } from "../google-web";
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
  guests_enabled: boolean;
  questions_json: unknown;
  paused: boolean;
  video_provider: string | null;
};

export type ZoomState = { configured: boolean; connected: boolean };

/** Where Zoom sends the host back. The desktop app hands off to the web app. */
function connectOrigin(): string {
  return isTauriRuntime() ? "https://app.moduo.app" : window.location.origin;
}

async function zoomRequest(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseClient.functions.invoke("booking-zoom-connect", { body });
  if (error) throw new Error(error.message || "Zoom is unavailable.");
  return (data ?? {}) as Record<string, unknown>;
}

function linkReady(row: LinkRow, googleOn: boolean, zoomOn: boolean): boolean {
  const setting = videoSetting(row.video_provider);
  if (setting === "zoom") return zoomOn;
  if (setting === "guest_choice") return googleOn || zoomOn;
  return googleOn;
}

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
    guestsEnabled: true,
    questions: [],
    paused: false,
    video: "google_meet",
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
    guestsEnabled: row.guests_enabled,
    questions: questionsFromJson(row.questions_json),
    paused: row.paused,
    video: videoSetting(row.video_provider),
  };
}

function publicUrl(slug: string): string {
  return bookingPublicUrl(slug, window.location);
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
  const [zoom, setZoom] = useState<ZoomState>({ configured: false, connected: false });
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
        .is("deleted_at", null)
        .order("created_at", { ascending: true }),
      supabaseClient.rpc("booking_google_connected"),
    ]);
    if (!rows.error && rows.data) setLinks(rows.data as LinkRow[]);
    if (!connected.error) setGoogleOn(Boolean(connected.data));
    try {
      const status = await zoomRequest({ action: "status" });
      setZoom({ configured: status.configured === true, connected: status.connected === true });
    } catch {
      setZoom({ configured: false, connected: false });
    }
  }, [userId, workspaceId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Back from Zoom (web), or back in the desktop window after connecting in the browser.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("zoom");
    if (result) {
      if (result === "failed") setError("Zoom didn't connect. Try again.");
      params.delete("zoom");
      const query = params.toString();
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
      );
    }
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const connectZoom = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = await zoomRequest({ action: "start", origin: connectOrigin() });
      const url = typeof payload.url === "string" ? payload.url : "";
      if (!url) {
        throw new Error(
          payload.error === "zoom_not_configured"
            ? "Zoom isn't set up for Moduo yet."
            : "Zoom didn't return a sign-in page.",
        );
      }
      if (isTauriRuntime() && runtime) await runtime.window.openExternalUrl(url);
      else window.location.href = url;
    } catch (e) {
      setError(errorText(e, "Could not connect Zoom."));
    } finally {
      setBusy(false);
    }
  };

  const disconnectZoom = async () => {
    setBusy(true);
    setError(null);
    try {
      await zoomRequest({ action: "disconnect" });
      await refresh();
    } catch (e) {
      setError(errorText(e, "Could not disconnect Zoom."));
    } finally {
      setBusy(false);
    }
  };

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
        await startWebGoogleConnect();
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
    if (draft.video === "zoom" && !zoom.connected) {
      setError("Connect Zoom first, or pick another video option.");
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
        guests_enabled: draft.guestsEnabled,
        questions_json: draft.questions.filter((question) => question.label.trim()),
        paused: draft.paused,
        video_provider: draft.video,
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

  const remove = async () => {
    if (!draft?.id) return;
    setBusy(true);
    setError(null);
    try {
      // Soft delete: the slug stops working, cancel links for booked meetings keep working.
      const { error: deleteError } = await supabaseClient
        .from("exposed_slot_links")
        .update({ deleted_at: new Date().toISOString(), paused: true })
        .eq("id", draft.id);
      if (deleteError) throw deleteError;
      setDraft(null);
      await refresh();
    } catch (e) {
      setError(errorText(e, "Could not delete the link."));
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
            disabled={!linkReady(link, googleOn, zoom.connected) || link.paused}
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
        zoom={zoom}
        busy={busy}
        error={error}
        onOpenChange={(open) => {
          if (!open) setDraft(null);
        }}
        onChange={setDraft}
        onConnect={() => void connectGoogle()}
        onConnectZoom={() => void connectZoom()}
        onDisconnectZoom={() => void disconnectZoom()}
        onSave={() => void save()}
        onDelete={() => void remove()}
      />
    </div>
  );
}
