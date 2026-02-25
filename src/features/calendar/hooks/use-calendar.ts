import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CalendarAccount,
  CalendarEvent,
  CalendarEventDraft,
  CalendarProvider,
  CalendarSource,
  CalendarViewMode,
} from "../types";

function safeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

const EVENTS_STORAGE_KEY = "moduo:calendar:events-v1";
const SOURCES_STORAGE_KEY = "moduo:calendar:sources-v1";
const ACCOUNTS_STORAGE_KEY = "moduo:calendar:accounts-v1";

function readLocalEvents(): CalendarEvent[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(EVENTS_STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as CalendarEvent[];
  } catch {
    return [];
  }
}

function writeLocalEvents(events: CalendarEvent[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(EVENTS_STORAGE_KEY, JSON.stringify(events));
}

function readLocalSources(): CalendarSource[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(SOURCES_STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as CalendarSource[];
  } catch {
    return [];
  }
}

function writeLocalSources(sources: CalendarSource[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SOURCES_STORAGE_KEY, JSON.stringify(sources));
}

function readLocalAccounts(): CalendarAccount[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(ACCOUNTS_STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as CalendarAccount[];
  } catch {
    return [];
  }
}

function writeLocalAccounts(accounts: CalendarAccount[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(accounts));
}

const DEFAULT_COLORS = [
  "#3a3a3a",
  "#4a4a4a",
  "#5a5a5a",
  "#6a6a6a",
  "#7a7a7a",
  "#8a8a8a",
  "#9a9a9a",
  "#aaaaaa",
  "#b0b0b0",
  "#c0c0c0",
];

function ensureLocalCalendar(
  accounts: CalendarAccount[],
  sources: CalendarSource[]
): { accounts: CalendarAccount[]; sources: CalendarSource[] } {
  const hasLocal = accounts.some((a) => a.provider === "local");
  if (hasLocal) return { accounts, sources };

  const accountId = safeId();
  const nextAccounts: CalendarAccount[] = [
    ...accounts,
    {
      id: accountId,
      provider: "local",
      email: "",
      displayName: "Local Calendar",
      connected: true,
      lastSyncAt: null,
    },
  ];
  const nextSources: CalendarSource[] = [
    ...sources,
    {
      id: safeId(),
      accountId,
      name: "Personal",
      color: DEFAULT_COLORS[0],
      visible: true,
    },
  ];
  writeLocalAccounts(nextAccounts);
  writeLocalSources(nextSources);
  return { accounts: nextAccounts, sources: nextSources };
}

export type UseCalendarState = {
  viewMode: CalendarViewMode;
  currentDate: Date;
  events: CalendarEvent[];
  sources: CalendarSource[];
  accounts: CalendarAccount[];
  selectedEventId: string | null;
  loading: boolean;
  setViewMode: (mode: CalendarViewMode) => void;
  setCurrentDate: (date: Date) => void;
  navigateToday: () => void;
  navigatePrev: () => void;
  navigateNext: () => void;
  createEvent: (draft: CalendarEventDraft) => string;
  updateEvent: (eventId: string, patch: Partial<CalendarEvent>) => void;
  deleteEvent: (eventId: string) => void;
  selectEvent: (eventId: string | null) => void;
  toggleSourceVisibility: (sourceId: string) => void;
  addGoogleAccount: () => Promise<void>;
  removeAccount: (accountId: string) => void;
  getVisibleEvents: () => CalendarEvent[];
};

export function useCalendar(): UseCalendarState {
  const [viewMode, setViewMode] = useState<CalendarViewMode>("week");
  const [currentDate, setCurrentDate] = useState<Date>(() => new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [sources, setSources] = useState<CalendarSource[]>([]);
  const [accounts, setAccounts] = useState<CalendarAccount[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const rawAccounts = readLocalAccounts();
    const rawSources = readLocalSources();
    const { accounts: resolvedAccounts, sources: resolvedSources } = ensureLocalCalendar(rawAccounts, rawSources);
    setAccounts(resolvedAccounts);
    setSources(resolvedSources);
    setEvents(readLocalEvents());
    setLoading(false);
  }, []);

  const navigateToday = useCallback(() => setCurrentDate(new Date()), []);

  const navigatePrev = useCallback(() => {
    setCurrentDate((prev) => {
      const next = new Date(prev);
      if (viewMode === "day") next.setDate(next.getDate() - 1);
      else if (viewMode === "week") next.setDate(next.getDate() - 7);
      else next.setMonth(next.getMonth() - 1);
      return next;
    });
  }, [viewMode]);

  const navigateNext = useCallback(() => {
    setCurrentDate((prev) => {
      const next = new Date(prev);
      if (viewMode === "day") next.setDate(next.getDate() + 1);
      else if (viewMode === "week") next.setDate(next.getDate() + 7);
      else next.setMonth(next.getMonth() + 1);
      return next;
    });
  }, [viewMode]);

  const createEvent = useCallback(
    (draft: CalendarEventDraft): string => {
      const id = safeId();
      const now = nowIso();
      const event: CalendarEvent = {
        id,
        calendarId: draft.calendarId,
        title: draft.title || "New Event",
        description: draft.description,
        location: draft.location,
        startTime: draft.startTime,
        endTime: draft.endTime,
        allDay: draft.allDay,
        color: draft.color,
        recurring: false,
        recurrenceRule: null,
        attendees: [],
        reminders: draft.reminders,
        tags: [],
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      const next = [...events, event];
      setEvents(next);
      writeLocalEvents(next);
      return id;
    },
    [events]
  );

  const updateEvent = useCallback(
    (eventId: string, patch: Partial<CalendarEvent>) => {
      const next = events.map((e) =>
        e.id === eventId ? { ...e, ...patch, updatedAt: nowIso() } : e
      );
      setEvents(next);
      writeLocalEvents(next);
    },
    [events]
  );

  const deleteEvent = useCallback(
    (eventId: string) => {
      const next = events.map((e) =>
        e.id === eventId ? { ...e, deletedAt: nowIso() } : e
      );
      setEvents(next);
      writeLocalEvents(next);
      if (selectedEventId === eventId) setSelectedEventId(null);
    },
    [events, selectedEventId]
  );

  const selectEvent = useCallback((eventId: string | null) => {
    setSelectedEventId(eventId);
  }, []);

  const toggleSourceVisibility = useCallback(
    (sourceId: string) => {
      const next = sources.map((s) =>
        s.id === sourceId ? { ...s, visible: !s.visible } : s
      );
      setSources(next);
      writeLocalSources(next);
    },
    [sources]
  );

  const addGoogleAccount = useCallback(async () => {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const result = (await invoke("calendar_google_oauth_start")) as {
        accountId: string;
        email: string;
        displayName: string;
        calendars: Array<{ id: string; name: string; color: string }>;
      };

      const newAccount: CalendarAccount = {
        id: result.accountId,
        provider: "google",
        email: result.email,
        displayName: result.displayName,
        connected: true,
        lastSyncAt: nowIso(),
      };

      const newSources: CalendarSource[] = result.calendars.map((cal, i) => ({
        id: cal.id,
        accountId: result.accountId,
        name: cal.name,
        color: cal.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length],
        visible: true,
      }));

      const nextAccounts = [...accounts, newAccount];
      const nextSources = [...sources, ...newSources];
      setAccounts(nextAccounts);
      setSources(nextSources);
      writeLocalAccounts(nextAccounts);
      writeLocalSources(nextSources);
    } catch {
      // Backend command not yet available - show placeholder
      const accountId = safeId();
      const newAccount: CalendarAccount = {
        id: accountId,
        provider: "google",
        email: "user@gmail.com",
        displayName: "Google Calendar",
        connected: false,
        lastSyncAt: null,
      };

      const newSources: CalendarSource[] = [
        { id: safeId(), accountId, name: "Primary", color: DEFAULT_COLORS[2], visible: true },
        { id: safeId(), accountId, name: "Work", color: DEFAULT_COLORS[5], visible: true },
      ];

      const nextAccounts = [...accounts, newAccount];
      const nextSources = [...sources, ...newSources];
      setAccounts(nextAccounts);
      setSources(nextSources);
      writeLocalAccounts(nextAccounts);
      writeLocalSources(nextSources);
    }
  }, [accounts, sources]);

  const removeAccount = useCallback(
    (accountId: string) => {
      const nextAccounts = accounts.filter((a) => a.id !== accountId);
      const removedSourceIds = new Set(sources.filter((s) => s.accountId === accountId).map((s) => s.id));
      const nextSources = sources.filter((s) => s.accountId !== accountId);
      const nextEvents = events.filter((e) => !removedSourceIds.has(e.calendarId));
      setAccounts(nextAccounts);
      setSources(nextSources);
      setEvents(nextEvents);
      writeLocalAccounts(nextAccounts);
      writeLocalSources(nextSources);
      writeLocalEvents(nextEvents);
    },
    [accounts, events, sources]
  );

  const visibleSourceIds = useMemo(
    () => new Set(sources.filter((s) => s.visible).map((s) => s.id)),
    [sources]
  );

  const getVisibleEvents = useCallback(
    () => events.filter((e) => !e.deletedAt && visibleSourceIds.has(e.calendarId)),
    [events, visibleSourceIds]
  );

  return {
    viewMode,
    currentDate,
    events,
    sources,
    accounts,
    selectedEventId,
    loading,
    setViewMode,
    setCurrentDate,
    navigateToday,
    navigatePrev,
    navigateNext,
    createEvent,
    updateEvent,
    deleteEvent,
    selectEvent,
    toggleSourceVisibility,
    addGoogleAccount,
    removeAccount,
    getVisibleEvents,
  };
}
