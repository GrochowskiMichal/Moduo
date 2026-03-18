import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../providers/auth-provider";
import { useWorkspace } from "../../../providers/workspace-provider";
import type { CalendarEvent, CalendarSource } from "../../calendar/types";
import { useCalendar } from "../../calendar/hooks/use-calendar";
import { readStoredAvatar } from "../../profile/profile-storage";
import { buildOwnerHandle, buildSlotSlug, exposeSlotLink, normalizeLinkName, syncSlotConflictWindows, unexposeSlotLink } from "../utils/expose-slot";

export type SlotEventType = {
  id: string;
  name: string;
  linkName: string;
  duration: number;
  location: "video" | "phone" | "in_person" | "choose";
  videoProvider?: "zoom" | "google_meet";
  description: string;
  conflictCalendars: string;
  scheduleType: "working_hours" | "custom";
  dateRange: number;
  bufferBefore: number;
  bufferAfter: number;
  questions: Array<{ id: string; label: string; type: "short" | "email" | "long"; required: boolean }>;
  publicSlug?: string;
  publicUrl?: string;
  ownerHandle?: string;
  ownerDisplayName?: string | null;
  ownerAvatarUrl?: string | null;
  ownerUserId?: string;
  publishedAt?: string;
};

const DEFAULT_EVENT_TYPE: SlotEventType = {
  id: "",
  name: "",
  linkName: "",
  duration: 30,
  location: "video",
  videoProvider: "zoom",
  description: "",
  conflictCalendars: "all",
  scheduleType: "working_hours",
  dateRange: 60,
  bufferBefore: 0,
  bufferAfter: 0,
  questions: [
    { id: "q1", label: "Name", type: "short", required: true },
    { id: "q2", label: "Email", type: "email", required: true },
    { id: "q3", label: "Please share anything that will help prepare for our meeting.", type: "long", required: false },
  ],
};

const Ico = {
  Plus: () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>,
  Link: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></svg>,
  Video: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>,
  Phone: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>,
  Pin: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>,
  Wand: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 4V2" /><path d="M15 16v-2" /><path d="M8 9h2" /><path d="M20 9h2" /><path d="M17.8 11.8L19 13" /><path d="M15 9h0" /><path d="M17.8 6.2L19 5" /><path d="M3 21l9-9" /><path d="M12.2 6.2L11 5" /></svg>,
  Clock: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>,
  Check: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>,
  Trash: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>,
};

async function copyText(value: string): Promise<boolean> {
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function upsertEventType(list: SlotEventType[], item: SlotEventType): SlotEventType[] {
  const idx = list.findIndex((entry) => entry.id === item.id);
  if (idx >= 0) {
    const copy = [...list];
    copy[idx] = item;
    return copy;
  }
  return [...list, item];
}

function toPersistedEventTypes(list: SlotEventType[]): SlotEventType[] {
  return list.map((item) => ({
    ...item,
    // Never persist avatar blobs/data URLs in localStorage (can exceed quota).
    ownerAvatarUrl: null,
  }));
}

function getConflictWindows(args: {
  events: CalendarEvent[];
  conflictCalendars: string;
  dateRangeDays: number;
}): Array<{ sourceCalendarId: string; sourceEventId: string; startAt: string; endAt: string }> {
  const now = Date.now();
  const horizonMs = now + Math.max(1, args.dateRangeDays) * 24 * 60 * 60 * 1000;
  const selectedCalendarIds = new Set<string>();

  if (args.conflictCalendars === "all") {
    for (const ev of args.events) {
      selectedCalendarIds.add(ev.calendarId);
    }
  } else {
    selectedCalendarIds.add(args.conflictCalendars);
  }

  return args.events
    .filter((ev) => !ev.deletedAt && selectedCalendarIds.has(ev.calendarId))
    .flatMap((ev) => {
      const startTs = new Date(ev.startTime).getTime();
      const endTs = new Date(ev.endTime).getTime();
      if (!Number.isFinite(startTs) || !Number.isFinite(endTs) || endTs <= startTs) return [];
      if (endTs < now || startTs > horizonMs) return [];
      return [{
        sourceCalendarId: ev.calendarId,
        sourceEventId: ev.id,
        startAt: new Date(startTs).toISOString(),
        endAt: new Date(endTs).toISOString(),
      }];
    });
}

export function LinkView({ events, sources }: { events: CalendarEvent[]; sources: CalendarSource[] }) {
  const cal = useCalendar();
  const { runtime, userId, userEmail } = useAuth();
  const { selectedWorkspaceId } = useWorkspace();

  const [eventTypes, setEventTypes] = useState<SlotEventType[]>([]);
  const [viewMode, setViewMode] = useState<"list" | "edit" | "preview">("list");
  const [draft, setDraft] = useState<SlotEventType>(DEFAULT_EVENT_TYPE);
  const [editStep, setEditStep] = useState(0);
  const [previewingType, setPreviewingType] = useState<SlotEventType | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SlotEventType | null>(null);
  const [copiedMessage, setCopiedMessage] = useState<string | null>(null);
  const [ownerDisplayName, setOwnerDisplayName] = useState<string | null>(null);
  const [ownerAvatarUrl, setOwnerAvatarUrl] = useState<string | null>(null);
  const [bookingSimState, setBookingSimState] = useState<{ date: string; time: string; name: string; email: string; success: boolean }>({
    date: "",
    time: "",
    name: "",
    email: "",
    success: false,
  });

  const ownerHandle = useMemo(() => buildOwnerHandle(userEmail, userId), [userEmail, userId]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = localStorage.getItem("moduo:slot:event-types");
    if (!raw) return;
    try {
      setEventTypes(JSON.parse(raw));
    } catch {
      // ignore malformed storage
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem("moduo:slot:event-types", JSON.stringify(toPersistedEventTypes(eventTypes)));
    } catch (error) {
      console.error("Failed to persist slot event types to localStorage:", error);
    }
  }, [eventTypes]);

  useEffect(() => {
    if (!copiedMessage) return;
    const timeout = window.setTimeout(() => setCopiedMessage(null), 1800);
    return () => window.clearTimeout(timeout);
  }, [copiedMessage]);

  useEffect(() => {
    let active = true;

    const loadOwnerProfile = async () => {
      let nextDisplayName: string | null = null;
      if (runtime) {
        try {
          const { data } = await runtime.auth.getLocalAuthState();
          nextDisplayName = data.displayName?.trim() || null;
        } catch {
          // ignore profile read failures
        }
      }
      if (!nextDisplayName && userEmail) {
        const [localPart] = userEmail.split("@");
        nextDisplayName = localPart?.trim() || null;
      }
      const avatar = await readStoredAvatar(runtime).catch(() => null);
      if (!active) return;
      setOwnerDisplayName(nextDisplayName);
      setOwnerAvatarUrl(avatar);
    };

    void loadOwnerProfile();
    return () => {
      active = false;
    };
  }, [runtime, userEmail]);

  const handleCreateNew = () => {
    setDraft({ ...DEFAULT_EVENT_TYPE, id: String(Date.now()) });
    setEditStep(0);
    setViewMode("edit");
  };

  const handleSave = async () => {
    const normalizedName = normalizeLinkName(draft.linkName || draft.name || "event");
    const withNormalizedLink: SlotEventType = { ...draft, linkName: normalizedName };
    setDraft(withNormalizedLink);
    setEventTypes((prev) => upsertEventType(prev, withNormalizedLink));

    if (!userId) {
      alert("Sign in is required to publish a slot link.");
      return;
    }

    setPublishing(true);
    try {
      const result = await exposeSlotLink({
        slotId: withNormalizedLink.id,
        workspaceId: selectedWorkspaceId,
        ownerUserId: userId,
        ownerEmail: userEmail,
        ownerHandle,
        ownerDisplayName,
        ownerAvatarUrl,
        name: withNormalizedLink.name,
        linkName: withNormalizedLink.linkName,
        duration: withNormalizedLink.duration,
        location: withNormalizedLink.location,
        videoProvider: withNormalizedLink.videoProvider,
        description: withNormalizedLink.description,
        conflictCalendars: withNormalizedLink.conflictCalendars,
        scheduleType: withNormalizedLink.scheduleType,
        dateRange: withNormalizedLink.dateRange,
        bufferBefore: withNormalizedLink.bufferBefore,
        bufferAfter: withNormalizedLink.bufferAfter,
        questions: withNormalizedLink.questions,
        assignedSlug: buildSlotSlug({
          ownerHandle,
          linkName: withNormalizedLink.linkName,
          name: withNormalizedLink.name,
        }),
      });

      if (!result.success) {
        alert(`Failed to publish slot link: ${result.error}`);
      } else {
        const conflictWindows = getConflictWindows({
          events,
          conflictCalendars: withNormalizedLink.conflictCalendars,
          dateRangeDays: withNormalizedLink.dateRange,
        });
        const syncResult = await syncSlotConflictWindows({
          slotId: withNormalizedLink.id,
          slotSlug: result.slug,
          windows: conflictWindows,
        });
        if (!syncResult.success) {
          alert(`Published, but failed to sync calendar conflicts: ${syncResult.error ?? "Unknown error"}`);
        }

        const published: SlotEventType = {
          ...withNormalizedLink,
          publicSlug: result.slug,
          publicUrl: result.url,
          ownerHandle,
          ownerDisplayName,
          ownerAvatarUrl,
          ownerUserId: userId,
          publishedAt: new Date().toISOString(),
        };
        setDraft(published);
        setEventTypes((prev) => upsertEventType(prev, published));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected publish error";
      alert(`Failed to publish slot link: ${message}`);
    } finally {
      setPublishing(false);
      setViewMode("list");
    }
  };

  const confirmDelete = async (eventType: SlotEventType) => {
    setDeleting(true);
    const previous = eventTypes;
    setEventTypes((prev) => prev.filter((item) => item.id !== eventType.id));

    try {
      const result = await unexposeSlotLink(eventType.id);
      if (!result.success) {
        setEventTypes(previous);
        alert(`Failed to delete link: ${result.error ?? "Unknown error"}`);
      }
    } catch (err) {
      setEventTypes(previous);
      alert(`Failed to delete link: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  };

  const handleSimBook = () => {
    if (!previewingType) return;

    const src = sources.find((item) => item.visible) || sources[0];
    if (src) {
      const now = new Date();
      const start = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        parseInt(bookingSimState.time.split(":")[0] || "9", 10),
        parseInt(bookingSimState.time.split(":")[1] || "0", 10),
        0
      );
      const end = new Date(start.getTime() + previewingType.duration * 60000);
      const mockZoomLink = `https://zoom.us/j/${Math.floor(Math.random() * 1000000000)}?pwd=mock`;

      cal.createEvent({
        title: `${previewingType.name} with ${bookingSimState.name}`,
        description: `Attendee Name: ${bookingSimState.name}\nEmail: ${bookingSimState.email}\n\nJoin Zoom Meeting:\n${mockZoomLink}`,
        location: mockZoomLink,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        allDay: false,
        calendarId: src.id,
        color: "#10b981",
        reminders: [],
      });

      console.log(`[Resend Mock] Sent confirmation email to ${bookingSimState.email} with link ${mockZoomLink}`);
    }

    setBookingSimState((prev) => ({ ...prev, success: true }));
  };

  if (viewMode === "preview" && previewingType) {
    return (
      <div className="flex-1 overflow-y-auto px-6 py-6 bg-[#0a0a0a] flex justify-center items-start pt-20">
        <div className="w-full max-w-2xl bg-[#111] border border-[#1e1e1e] rounded-2xl shadow-2xl overflow-hidden flex flex-col md:flex-row shadow-black/50">
          <div className="md:w-1/3 bg-[#151515] p-8 border-r border-[#1e1e1e] flex flex-col gap-4">
            <div className="w-12 h-12 bg-[#222] rounded-xl flex place-items-center justify-center border border-[#333] shadow-inner mb-4">
              <img src="https://api.dicebear.com/7.x/notionists-neutral/svg?seed=mike" alt="User" className="w-10 h-10 rounded-lg" />
            </div>
            <h2 className="text-white text-lg font-bold">{previewingType.name}</h2>
            <div className="flex items-center gap-2 text-[#888] text-sm mt-2">
              <Ico.Clock /> {previewingType.duration} min
            </div>
            <div className="flex items-center gap-2 text-[#888] text-sm">
              <Ico.Video /> Web conferencing details provided upon confirmation.
            </div>
            <p className="text-[#a0a0a0] text-sm leading-relaxed mt-4">{previewingType.description || "A quick discovery chat or check-in."}</p>
          </div>

          <div className="md:w-2/3 p-8">
            {!bookingSimState.success ? (
              <>
                <h3 className="text-white font-bold mb-6 text-lg">Select Date & Time</h3>
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[#888] text-xs font-semibold">Date</span>
                      <input type="date" value={bookingSimState.date} onChange={(e) => setBookingSimState((s) => ({ ...s, date: e.target.value }))} className="bg-[#0f0f0f] border border-[#2a2a2a] rounded-xl px-3 py-2 text-sm text-[#ddd] outline-none focus:border-[#444] transition-colors [color-scheme:dark]" />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[#888] text-xs font-semibold">Time</span>
                      <input type="time" value={bookingSimState.time} onChange={(e) => setBookingSimState((s) => ({ ...s, time: e.target.value }))} className="bg-[#0f0f0f] border border-[#2a2a2a] rounded-xl px-3 py-2 text-sm text-[#ddd] outline-none focus:border-[#444] transition-colors [color-scheme:dark]" />
                    </div>
                  </div>

                  <div className="h-px bg-[#1e1e1e] my-2" />
                  <h3 className="text-white font-bold mb-2 text-lg">Your Information</h3>

                  <div className="flex flex-col gap-1.5">
                    <span className="text-[#888] text-xs font-semibold">Name</span>
                    <input value={bookingSimState.name} onChange={(e) => setBookingSimState((s) => ({ ...s, name: e.target.value }))} placeholder="John Doe" className="bg-[#0f0f0f] border border-[#2a2a2a] rounded-xl px-3 py-2 text-sm text-[#ddd] outline-none focus:border-[#444] transition-colors placeholder:text-[#333]" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[#888] text-xs font-semibold">Email</span>
                    <input type="email" value={bookingSimState.email} onChange={(e) => setBookingSimState((s) => ({ ...s, email: e.target.value }))} placeholder="john@example.com" className="bg-[#0f0f0f] border border-[#2a2a2a] rounded-xl px-3 py-2 text-sm text-[#ddd] outline-none focus:border-[#444] transition-colors placeholder:text-[#333]" />
                  </div>

                  <div className="mt-4 flex justify-between items-center">
                    <button onClick={() => { setViewMode("list"); setBookingSimState({ date: "", time: "", name: "", email: "", success: false }); }} className="text-[#888] hover:text-[#fff] text-sm font-semibold transition-colors">Cancel</button>
                    <button onClick={handleSimBook} disabled={!bookingSimState.date || !bookingSimState.time || !bookingSimState.name || !bookingSimState.email} className="bg-white text-black px-6 py-2 rounded-xl font-bold text-sm hover:bg-[#e0e0e0] transition-transform active:scale-95 disabled:opacity-50 disabled:pointer-events-none">Schedule Event</button>
                  </div>
                </div>
              </>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-center py-10">
                <div className="w-16 h-16 rounded-full bg-green-500/20 text-green-400 flex items-center justify-center mb-6"><Ico.Check /></div>
                <h3 className="text-white text-2xl font-bold mb-2">You are scheduled</h3>
                <p className="text-[#888] text-sm mb-6 max-w-sm">A calendar invitation with the Video Meeting link has been sent to your email address.</p>
                <button onClick={() => { setViewMode("list"); setBookingSimState({ date: "", time: "", name: "", email: "", success: false }); }} className="bg-[#1e1e1e] border border-[#333] text-white px-6 py-2 rounded-xl font-bold text-sm hover:bg-[#2a2a2a] transition-all">Back to Dashboard</button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (viewMode === "edit") {
    const steps = [
      { id: 0, label: "Basic Info", icon: <div className="h-4 w-4 bg-transparent border-[1.5px] border-current rounded-full flex flex-col justify-center items-center gap-[2px]"><div className="w-2 h-[1px] bg-current" /><div className="w-2 h-[1px] bg-current" /><div className="w-2 h-[1px] bg-current" /></div> },
      { id: 1, label: "Availability", icon: <Ico.Clock /> },
      { id: 2, label: "Questions", icon: <div className="font-bold text-[10px] bg-transparent border-[1.5px] border-current rounded-full w-4 h-4 flex items-center justify-center pt-px">?</div> },
      { id: 3, label: "Done", icon: <Ico.Check /> },
    ];

    return (
      <div className="flex-1 overflow-y-auto px-6 py-8 bg-[#0a0a0a] flex flex-col items-center">
        <div className="flex items-center gap-12 w-full max-w-2xl mb-12 relative z-10">
          <div className="absolute top-1/2 left-[10%] right-[10%] h-[1px] bg-[#1a1a1a] -z-10" />
          {steps.map((s) => {
            const active = editStep === s.id;
            const past = editStep > s.id;
            return (
              <div key={s.id} className="cursor-pointer group flex-1 flex flex-col items-center gap-3 relative" onClick={() => setEditStep(s.id)}>
                <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 shadow-md border ${active ? "bg-white text-black border-transparent scale-110 shadow-white/10" : past ? "bg-[#111] text-[#fff] border-[#333] hover:border-[#555]" : "bg-[#0d0d0d] text-[#555] border-[#1a1a1a] group-hover:text-[#888]"}`}>
                  {s.icon}
                </div>
                <span className={`text-[11px] font-bold ${active ? "text-white" : past ? "text-[#ccc]" : "text-[#555]"}`}>{s.label}</span>
              </div>
            );
          })}
        </div>

        <div className="w-full max-w-2xl bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl shadow-xl overflow-hidden flex flex-col relative before:absolute before:inset-0 before:bg-gradient-to-br before:from-white/[0.02] before:to-transparent before:pointer-events-none">
          <div className="px-8 py-6 border-b border-[#1a1a1a]">
            <h2 className="text-lg font-bold text-white">
              {editStep === 0 && "What event is this?"}
              {editStep === 1 && "When can people book this?"}
              {editStep === 2 && "Booking Questions"}
              {editStep === 3 && "You're all set!"}
            </h2>
            {editStep === 2 && <p className="text-[#777] text-[11px] mt-1">What information do you need from invitees when they book?</p>}
          </div>

          <div className="p-8 flex-1">
            {editStep === 0 && (
              <div className="flex flex-col gap-6">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-bold text-[#aaa]">Event Name *</label>
                  <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="e.g. 30 Min Discovery Call" className="bg-[#141414] border border-[#222] rounded-xl px-4 py-2.5 text-sm text-[#eee] outline-none focus:border-[#555] focus:bg-[#1a1a1a] transition-all placeholder:text-[#444]" />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-bold text-[#aaa]">Event Link *</label>
                  <div className="flex">
                    <div className="bg-[#1a1a1a] border border-[#222] border-r-0 rounded-l-xl px-4 py-2.5 text-sm text-[#777] flex items-center shrink-0">
                      moduo.app/slot/
                    </div>
                    <input value={draft.linkName} onChange={(e) => setDraft((d) => ({ ...d, linkName: normalizeLinkName(e.target.value) }))} className="bg-[#141414] border border-[#222] rounded-r-xl px-4 py-2.5 text-sm text-[#eee] outline-none focus:border-[#555] focus:bg-[#1a1a1a] transition-all w-full flex-1" />
                  </div>
                  <p className="text-[10px] text-[#666]">Final link includes your user handle automatically.</p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-bold text-[#aaa]">Duration</label>
                  <div className="flex gap-2 w-full overflow-x-auto">
                    {[15, 30, 45, 60].map((m) => (
                      <button key={m} onClick={() => setDraft((d) => ({ ...d, duration: m }))} className={`flex-1 min-w-[80px] py-2.5 rounded-xl border text-[11px] font-bold transition-all ${draft.duration === m ? "bg-white text-black border-transparent shadow-lg" : "bg-[#141414] text-[#aaa] border-[#222] hover:border-[#444] hover:bg-[#1a1a1a]"}`}>
                        {m} min
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-bold text-[#aaa]">Location</label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {[
                      { id: "video", label: "Video Call", Icon: Ico.Video },
                      { id: "phone", label: "Phone Call", Icon: Ico.Phone },
                      { id: "in_person", label: "In Person", Icon: Ico.Pin },
                      { id: "choose", label: "Let Invitee Choose", Icon: Ico.Wand },
                    ].map((loc) => (
                      <button key={loc.id} onClick={() => setDraft((d) => ({ ...d, location: loc.id as SlotEventType["location"] }))} className={`flex flex-col items-center justify-center gap-2 py-4 rounded-xl border transition-all ${draft.location === loc.id ? "bg-[#1f1f1f] text-white border-white/20 shadow-md shadow-black/50" : "bg-[#141414] text-[#666] border-[#222] hover:border-[#444] hover:bg-[#1a1a1a] hover:text-[#999]"}`}>
                        <loc.Icon />
                        <span className="text-[10px] font-semibold">{loc.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {draft.location === "video" && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-[11px] font-bold text-[#aaa]">Video Platform</label>
                    <div className="flex gap-2">
                      {(["zoom", "google_meet"] as const).map((vp) => (
                        <button
                          key={vp}
                          type="button"
                          onClick={() => setDraft((d) => ({ ...d, videoProvider: vp }))}
                          className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border text-[12px] font-semibold transition-all ${
                            draft.videoProvider === vp
                              ? "bg-[#1f1f1f] text-white border-white/20 shadow-md shadow-black/50"
                              : "bg-[#141414] text-[#666] border-[#222] hover:border-[#444] hover:bg-[#1a1a1a] hover:text-[#999]"
                          }`}
                        >
                          {vp === "zoom" ? (
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M15.5 8.5v7L20 18V6l-4.5 2.5zM4 8a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2H4z"/></svg>
                          ) : (
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/></svg>
                          )}
                          {vp === "zoom" ? "Zoom" : "Google Meet"}
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] text-[#555] leading-relaxed">Connect your account in <span className="text-[#888]">Integrations</span> to auto-generate meeting links on each booking.</p>
                  </div>
                )}

                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-bold text-[#aaa]">Description / Instructions</label>
                  <textarea value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} rows={4} placeholder="Write a summary and any details your invitee should know..." className="bg-[#141414] border border-[#222] rounded-xl px-4 py-3 text-sm text-[#eee] outline-none focus:border-[#555] focus:bg-[#1a1a1a] transition-all placeholder:text-[#444] resize-none" />
                </div>
              </div>
            )}

            {editStep === 1 && (
              <div className="flex flex-col gap-8">
                <div className="p-5 border border-[#1a1a1a] bg-[#111] rounded-xl flex flex-col gap-3">
                  <label className="text-[11px] font-bold text-white flex items-center gap-2"><Ico.Clock /> Check for conflicts in</label>
                  <p className="text-[10px] text-[#777] leading-relaxed">Select which calendar(s) should be checked to prevent double bookings.</p>
                  <select value={draft.conflictCalendars} onChange={(e) => setDraft((d) => ({ ...d, conflictCalendars: e.target.value }))} className="bg-[#161616] border border-[#2a2a2a] rounded-lg px-3 py-2 text-xs text-[#ddd] outline-none mt-1 [color-scheme:dark]">
                    <option value="all">All Calendars Combined</option>
                    {sources.filter((s) => s.visible).map((s) => <option key={s.id} value={s.id}>{s.name} Only</option>)}
                  </select>
                </div>

                <div className="flex flex-col gap-2">
                  <label className="text-[12px] font-bold text-[#ddd]">Schedule</label>
                  <div className="flex flex-col gap-2">
                    <label className={`flex items-start gap-3 p-4 rounded-xl border border-[#222] cursor-pointer transition-colors ${draft.scheduleType === "working_hours" ? "bg-[#181818] border-[#444]" : "bg-[#111] hover:bg-[#141414]"}`}>
                      <input type="radio" checked={draft.scheduleType === "working_hours"} onChange={() => setDraft((d) => ({ ...d, scheduleType: "working_hours" }))} className="mt-1" />
                      <div className="flex flex-col"><span className="text-[12px] font-bold text-[#eee]">Working Hours</span><span className="text-[10px] text-[#777] mt-0.5">Mon - Fri, 9:00 AM - 5:00 PM</span></div>
                    </label>
                    <label className={`flex items-start gap-3 p-4 rounded-xl border border-[#222] cursor-pointer transition-colors ${draft.scheduleType === "custom" ? "bg-[#181818] border-[#444]" : "bg-[#111] hover:bg-[#141414]"}`}>
                      <input type="radio" checked={draft.scheduleType === "custom"} onChange={() => setDraft((d) => ({ ...d, scheduleType: "custom" }))} className="mt-1" />
                      <div className="flex flex-col"><span className="text-[12px] font-bold text-[#eee]">Custom Schedule</span><span className="text-[10px] text-[#777] mt-0.5">Set specific hours for this event type only</span></div>
                    </label>
                  </div>
                </div>

                <div className="h-px bg-[#1a1a1a]" />

                <div className="flex flex-col gap-2">
                  <label className="text-[12px] font-bold text-[#ddd]">Date Range</label>
                  <div className="text-[11px] text-[#aaa] flex items-center gap-2">
                    Invitees can schedule
                    <input type="number" value={draft.dateRange} onChange={(e) => setDraft((d) => ({ ...d, dateRange: parseInt(e.target.value, 10) || 0 }))} className="w-16 bg-[#181818] border border-[#2a2a2a] rounded-lg px-2 py-1 text-center text-[#eee] outline-none" />
                    days into the future
                  </div>
                </div>

                <div className="h-px bg-[#1a1a1a]" />

                <div className="flex flex-col gap-2">
                  <label className="text-[12px] font-bold text-[#ddd]">Buffer Time</label>
                  <p className="text-[10px] text-[#777]">Add extra time before or after events to prepare or wrap up.</p>
                  <div className="grid grid-cols-2 gap-4 mt-1">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-semibold text-[#aaa]">Before event</label>
                      <select value={draft.bufferBefore} onChange={(e) => setDraft((d) => ({ ...d, bufferBefore: parseInt(e.target.value, 10) }))} className="bg-[#181818] border border-[#2a2a2a] rounded-lg px-3 py-2 text-xs text-[#eee] outline-none [color-scheme:dark]">
                        <option value={0}>0 min</option><option value={5}>5 min</option><option value={10}>10 min</option><option value={15}>15 min</option><option value={30}>30 min</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-[10px] font-semibold text-[#aaa]">After event</label>
                      <select value={draft.bufferAfter} onChange={(e) => setDraft((d) => ({ ...d, bufferAfter: parseInt(e.target.value, 10) }))} className="bg-[#181818] border border-[#2a2a2a] rounded-lg px-3 py-2 text-xs text-[#eee] outline-none [color-scheme:dark]">
                        <option value={0}>0 min</option><option value={5}>5 min</option><option value={10}>10 min</option><option value={15}>15 min</option><option value={30}>30 min</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {editStep === 2 && (
              <div className="flex flex-col gap-3">
                {draft.questions.map((q, i) => (
                  <div key={q.id} className="bg-[#141414] border border-[#1e1e1e] rounded-xl p-4 flex flex-col gap-2 relative group">
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-3"><span className="w-5 h-5 bg-[#222] text-[#888] rounded flex place-items-center justify-center text-[10px] font-bold">{i + 1}</span><span className="text-[12px] font-bold text-[#eee]">{q.label}</span></div>
                      {i > 1 && <button onClick={() => setDraft((d) => ({ ...d, questions: d.questions.filter((qu) => qu.id !== q.id) }))} className="text-[#555] hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"><Ico.Trash /></button>}
                    </div>
                    <div className="flex items-center gap-4 pl-8 mt-1">
                      <select value={q.type} onChange={(e) => { const next = [...draft.questions]; next[i]!.type = e.target.value as "short" | "email" | "long"; setDraft((d) => ({ ...d, questions: next })); }} className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-md px-2 py-1 text-[10px] text-[#aaa] outline-none [color-scheme:dark]" disabled={i <= 1}>
                        <option value="short">Short Text</option>
                        <option value="long">Long Text</option>
                        <option value="email">Email</option>
                      </select>
                      <label className="flex items-center gap-1.5 text-[10px] text-[#888] cursor-pointer">
                        <input type="checkbox" checked={q.required} onChange={(e) => { const next = [...draft.questions]; next[i]!.required = e.target.checked; setDraft((d) => ({ ...d, questions: next })); }} disabled={i <= 1} className="rounded border-[#444] bg-[#222]" />
                        Required
                      </label>
                    </div>
                  </div>
                ))}

                <button onClick={() => setDraft((d) => ({ ...d, questions: [...d.questions, { id: String(Date.now()), label: "New Question", type: "short", required: false }] }))} className="flex items-center gap-2 py-3 px-4 mt-2 text-[11px] font-bold text-[#888] hover:text-[#bbb] hover:bg-[#141414] border border-dashed border-[#222] rounded-xl transition-all w-full justify-center">
                  <Ico.Plus /> Add new question
                </button>
              </div>
            )}

            {editStep === 3 && (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <div className="w-20 h-20 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center mb-6 ring ring-blue-500/10 shrink-0"><Ico.Link /></div>
                <h3 className="text-xl font-bold text-white mb-2">{draft.name || "Untitled Event"} is ready</h3>
                <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg px-4 py-2 mt-4 text-sm text-[#ddd] flex items-center gap-4">
                  <span className="max-w-[280px] truncate">moduo.app/slot/{ownerHandle}-{draft.linkName || normalizeLinkName(draft.name || "event")}-...</span>
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await copyText(`moduo.app/slot/${ownerHandle}-${draft.linkName || normalizeLinkName(draft.name || "event")}`);
                      setCopiedMessage(ok ? "Copied" : "Copy failed");
                    }}
                    className="text-[10px] font-bold text-blue-400 uppercase tracking-wide hover:text-blue-300 transition-colors bg-blue-500/10 px-2 py-1 rounded"
                  >
                    Copy
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="px-8 py-5 border-t border-[#1a1a1a] bg-[#111] flex justify-between items-center rounded-b-2xl">
            {editStep > 0 ? (
              <button onClick={() => setEditStep((p) => p - 1)} className="text-[12px] font-bold text-[#888] hover:text-[#fff] transition-colors">Back</button>
            ) : (
              <button onClick={() => setViewMode("list")} className="text-[12px] font-bold text-[#888] hover:text-[#fff] transition-colors">Cancel</button>
            )}

            {editStep < 3 ? (
              <button onClick={() => setEditStep((p) => p + 1)} className="bg-white text-black px-6 py-2 rounded-xl font-bold text-[12px] flex items-center gap-2 hover:bg-[#e0e0e0] transition-colors shadow-lg shadow-white/5 active:scale-95">
                Next <span className="opacity-60">›</span>
              </button>
            ) : (
              <button onClick={() => void handleSave()} disabled={publishing} className="bg-white text-black px-6 py-2 rounded-xl font-bold text-[12px] hover:bg-[#e0e0e0] transition-colors shadow-lg shadow-white/5 active:scale-95 disabled:opacity-60 disabled:pointer-events-none">
                {publishing ? "Publishing..." : "Save & Publish"}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-6 py-8 bg-[#0a0a0a]">
      <div className="flex justify-between items-center mb-10 max-w-5xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Let them slot</h1>
          <p className="text-sm text-[#777] mt-1">Create schedulable events and let others book time with you.</p>
        </div>
        <button onClick={handleCreateNew} className="bg-white text-black px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-[#e0e0e0] transition-transform active:scale-95 shadow-lg shadow-white/5">
          <Ico.Plus /> New Event Type
        </button>
      </div>

      {copiedMessage && (
        <div className="max-w-5xl mx-auto mb-4 text-[11px] text-[#8fd0ff]">{copiedMessage}</div>
      )}

      <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {eventTypes.map((ev) => {
          const url = ev.publicUrl ?? null;
          return (
            <div key={ev.id} className="group relative bg-[#111] border border-[#1e1e1e] hover:border-[#333] rounded-2xl p-6 transition-all shadow-xl hover:shadow-2xl flex flex-col items-start min-h-[180px] before:absolute before:inset-0 before:bg-gradient-to-br before:from-white/[0.03] before:to-transparent before:pointer-events-none before:rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between w-full mb-4 z-10">
                <div className="w-10 h-10 rounded-full bg-[#1e1e1e] flex place-items-center justify-center text-[#ddd] ring-1 ring-[#333]">
                  {ev.location === "video" ? <Ico.Video /> : ev.location === "phone" ? <Ico.Phone /> : ev.location === "choose" ? <Ico.Wand /> : <Ico.Pin />}
                </div>
                <button onClick={() => setPendingDelete(ev)} className="h-8 w-8 bg-[#1a1a1a] border border-[#2a2a2a] rounded-lg grid place-items-center text-[#666] hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100">
                  <Ico.Trash />
                </button>
              </div>

              <h3 className="text-lg font-bold text-[#eee] leading-tight mb-2 z-10">{ev.name}</h3>
              <p className="text-[11px] text-[#777] mb-6 flex items-center gap-1.5 z-10"><Ico.Clock /> {ev.duration} mins, {ev.location === "video" ? "Video call" : ev.location === "phone" ? "Phone call" : "In Person"}</p>

              <div className="mt-auto w-full pt-4 border-t border-[#1a1a1a] flex flex-col gap-2 z-10">
                <span className={`text-[10px] font-medium truncate ${url ? "text-blue-400/80" : "text-[#6f6f6f]"}`}>
                  {url ? url.replace("https://", "") : "Unpublished"}
                </span>
                <div className="flex justify-between gap-2">
                  <button onClick={() => { setPreviewingType(ev); setViewMode("preview"); }} className="text-[11px] font-bold text-white bg-[#1a1a1a] hover:bg-[#252525] px-3 py-1.5 rounded-lg border border-[#2a2a2a] transition-colors shrink-0">View Page</button>
                  <button
                    disabled={!url}
                    onClick={async () => {
                      if (!url) {
                        setCopiedMessage("Publish this slot first");
                        return;
                      }
                      const ok = await copyText(url);
                      setCopiedMessage(ok ? "Public URL copied" : "Copy failed");
                    }}
                    className="text-[11px] font-bold text-blue-300 bg-[#111827] hover:bg-[#1f2937] px-3 py-1.5 rounded-lg border border-[#2a2a2a] transition-colors shrink-0 disabled:opacity-50 disabled:pointer-events-none"
                  >
                    Copy Link
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {eventTypes.length === 0 && (
          <div className="col-span-full border-2 border-dashed border-[#1e1e1e] rounded-3xl py-20 flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 rounded-full bg-[#151515] flex items-center justify-center text-[#555] mb-4"><Ico.Link /></div>
            <h3 className="text-[#ddd] text-lg font-bold">No event types yet</h3>
            <p className="text-[#666] text-sm max-w-sm mt-2 mb-6">Create your first event type to start letting colleagues and clients book time with you automatically.</p>
            <button onClick={handleCreateNew} className="text-white text-sm font-bold bg-[#1a1a1a] hover:bg-[#222] border border-[#333] px-5 py-2.5 rounded-xl transition-colors">Create one now</button>
          </div>
        )}
      </div>

      {pendingDelete ? (
        <div className="fixed inset-0 z-[1200] grid place-items-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-2xl border border-[#2a2a2a] bg-[#131313] p-5">
            <h3 className="text-[16px] font-semibold text-[#f1f1f1]">Delete link?</h3>
            <p className="mt-2 text-[13px] leading-relaxed text-[#9a9a9a]">
              This will remove <span className="text-[#d7d7d7]">{pendingDelete.name || "Untitled Event"}</span> from your list and from Moduo.app.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setPendingDelete(null)}
                className="rounded-lg border border-[#2b2b2b] bg-[#171717] px-3 py-1.5 text-[12px] text-[#c6c6c6] hover:bg-[#1d1d1d] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => void confirmDelete(pendingDelete)}
                className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[12px] font-semibold text-red-300 hover:bg-red-500/20 disabled:opacity-50"
              >
                {deleting ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
