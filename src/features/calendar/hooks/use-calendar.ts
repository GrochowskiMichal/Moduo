// ⚠ LEGACY (pre-Wave-2). The localStorage-backed calendar store + OAuth state
// machine. Its ONLY remaining consumer is Settings → Integrations (the OAuth
// engine survives as CAL-6's mirror source); the event store is superseded by
// the Wave 2 lens/grid (specs/calendar.md) and retires with CAL-2/CAL-6.
// Do not wire new features to this hook.

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  CalendarAccount,
  CalendarEvent,
  CalendarEventDraft,
  CalendarSource,
  CalendarViewMode,
} from "../types";
import { getRuntime } from "../../../lib/runtime";

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
export const CALENDAR_ACCOUNTS_UPDATED_EVENT = "moduo:calendar:accounts-updated";

type CalendarOauthStartResult = {
  accountId: string;
  email: string;
  displayName: string;
  calendars: Array<{ id: string; name: string; color: string }>;
};

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

function dedupeEvents(list: CalendarEvent[]): CalendarEvent[] {
  const byKey = new Map<string, CalendarEvent>();
  for (const ev of list) {
    const key =
      ev.externalProvider && ev.externalId
        ? `ext:${ev.externalProvider}:${ev.calendarId}:${ev.externalId}`
        : `local:${ev.calendarId}:${ev.id}`;
    const prev = byKey.get(key);
    if (!prev || new Date(prev.updatedAt).getTime() < new Date(ev.updatedAt).getTime()) {
      byKey.set(key, ev);
    }
  }
  return Array.from(byKey.values());
}

async function tryListBackendEvents(): Promise<CalendarEvent[] | null> {
  try {
    const rt = getRuntime();
    if (!rt) return null;
    const raw = await rt.calendar.listEvents();
    if (!Array.isArray(raw)) return [];
    return dedupeEvents(raw as CalendarEvent[]);
  } catch {
    return null;
  }
}

async function tryUpsertBackendEvent(event: CalendarEvent): Promise<boolean> {
  try {
    const rt = getRuntime();
    if (!rt) return false;
    return rt.calendar.upsertEvent(event);
  } catch {
    return false;
  }
}

async function tryDeleteBackendEvent(eventId: string): Promise<boolean> {
  try {
    const rt = getRuntime();
    if (!rt) return false;
    return rt.calendar.deleteEvent(eventId);
  } catch {
    return false;
  }
}

function isGoogleSourceId(sourceId: string): boolean {
  return sourceId.startsWith("google:");
}

async function tryUpsertGoogleEvent(accountId: string, event: CalendarEvent): Promise<CalendarEvent | null> {
  try {
    const rt = getRuntime();
    if (!rt) return null;
    return rt.calendar.upsertGoogleEvent(accountId, event);
  } catch {
    return null;
  }
}

async function tryDeleteGoogleEvent(accountId: string, _calendarSourceId: string, externalId: string): Promise<boolean> {
  try {
    const rt = getRuntime();
    if (!rt) return false;
    return rt.calendar.deleteGoogleEvent(accountId, externalId);
  } catch {
    return false;
  }
}

async function trySyncGoogleEvents(accountId: string, _calendarSourceIds: string[]) {
  try {
    const rt = getRuntime();
    if (!rt) return;
    await rt.calendar.syncGoogleEvents(accountId);
  } catch {
    // ignore
  }
}

export function readLocalSources(): CalendarSource[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(SOURCES_STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as CalendarSource[];
  } catch {
    return [];
  }
}

export function writeLocalSources(sources: CalendarSource[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SOURCES_STORAGE_KEY, JSON.stringify(sources));
}

export function readLocalAccounts(): CalendarAccount[] {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(ACCOUNTS_STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as CalendarAccount[];
  } catch {
    return [];
  }
}

export function writeLocalAccounts(accounts: CalendarAccount[]) {
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

function ensureDefaultPersonalCalendar(
  accounts: CalendarAccount[],
  sources: CalendarSource[]
): { accounts: CalendarAccount[]; sources: CalendarSource[] } {
  let nextAccounts = [...accounts];
  let nextSources = [...sources];
  let changed = false;

  let localAccount = nextAccounts.find((account) => account.provider === "local");
  if (!localAccount) {
    localAccount = {
      id: safeId(),
      provider: "local",
      email: "",
      displayName: "Local Calendar",
      connected: true,
      lastSyncAt: null,
    };
    nextAccounts = [...nextAccounts, localAccount];
    changed = true;
  }

  const hasPersonalSource = nextSources.some(
    (source) =>
      source.accountId === localAccount.id &&
      source.name.trim().toLowerCase() === "personal"
  );

  if (!hasPersonalSource) {
    nextSources = [
      ...nextSources,
      {
        id: safeId(),
        accountId: localAccount.id,
        name: "Personal",
        color: DEFAULT_COLORS[0],
        visible: true,
      },
    ];
    changed = true;
  }

  if (changed) {
    writeLocalAccounts(nextAccounts);
    writeLocalSources(nextSources);
  }
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
  deleteSource: (sourceId: string) => void;
  addInternalCalendar: () => void;
  addGoogleAccount: () => Promise<void>;
  addOutlookAccount: () => Promise<void>;
  addAppleAccount: () => Promise<void>;
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
  const [didInitialGoogleSync, setDidInitialGoogleSync] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rawAccounts = readLocalAccounts();
      const rawSources = readLocalSources();
      const { accounts: resolvedAccounts, sources: resolvedSources } = ensureDefaultPersonalCalendar(rawAccounts, rawSources);
      if (cancelled) return;
      setAccounts(resolvedAccounts);
      setSources(resolvedSources);

      const backendEvents = await tryListBackendEvents();
      if (cancelled) return;
      setEvents(dedupeEvents(backendEvents ?? readLocalEvents()));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (loading || didInitialGoogleSync) return;
    const googleAccounts = accounts.filter((a) => a.provider === "google");
    if (!googleAccounts.length) {
      setDidInitialGoogleSync(true);
      return;
    }
    void (async () => {
      for (const acc of googleAccounts) {
        const sourceIds = sources.filter((s) => s.accountId === acc.id).map((s) => s.id);
        if (sourceIds.length) await trySyncGoogleEvents(acc.id, sourceIds);
      }
      const backendEvents = await tryListBackendEvents();
      if (backendEvents) setEvents(dedupeEvents(backendEvents));
      setDidInitialGoogleSync(true);
    })();
  }, [accounts, didInitialGoogleSync, loading, sources]);

  useEffect(() => {
    const handler = () => {
      const rawAccounts = readLocalAccounts();
      const rawSources = readLocalSources();
      const { accounts: resolvedAccounts, sources: resolvedSources } = ensureDefaultPersonalCalendar(rawAccounts, rawSources);
      setAccounts(resolvedAccounts);
      setSources(resolvedSources);
    };
    window.addEventListener(CALENDAR_ACCOUNTS_UPDATED_EVENT, handler);
    return () => window.removeEventListener(CALENDAR_ACCOUNTS_UPDATED_EVENT, handler);
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
        externalProvider: isGoogleSourceId(draft.calendarId) ? "google" : undefined,
      };
      const next = [...events, event];
      setEvents(next);
      writeLocalEvents(next);
      void tryUpsertBackendEvent(event);
      if (isGoogleSourceId(draft.calendarId)) {
        const source = sources.find((s) => s.id === draft.calendarId);
        const accountId = source?.accountId;
        if (accountId) {
          void (async () => {
            const pushed = await tryUpsertGoogleEvent(accountId, event);
            if (!pushed) return;
            const merged = next.map((e) => (e.id === id ? pushed : e));
            setEvents(merged);
            writeLocalEvents(merged);
            void tryUpsertBackendEvent(pushed);
          })();
        }
      }
      return id;
    },
    [events, sources]
  );

  const updateEvent = useCallback(
    (eventId: string, patch: Partial<CalendarEvent>) => {
      const next = events.map((e) =>
        e.id === eventId ? { ...e, ...patch, updatedAt: nowIso() } : e
      );
      setEvents(next);
      writeLocalEvents(next);
      const updated = next.find((e) => e.id === eventId);
      if (updated) {
        void tryUpsertBackendEvent(updated);
        if (updated.externalProvider === "google" && isGoogleSourceId(updated.calendarId)) {
          const source = sources.find((s) => s.id === updated.calendarId);
          const accountId = source?.accountId;
          if (accountId) {
            void (async () => {
              const pushed = await tryUpsertGoogleEvent(accountId, updated);
              if (!pushed) return;
              const merged = next.map((e) => (e.id === eventId ? pushed : e));
              setEvents(merged);
              writeLocalEvents(merged);
              void tryUpsertBackendEvent(pushed);
            })();
          }
        }
      }
    },
    [events, sources]
  );

  const deleteEvent = useCallback(
    (eventId: string) => {
      const next = events.map((e) =>
        e.id === eventId ? { ...e, deletedAt: nowIso() } : e
      );
      setEvents(next);
      writeLocalEvents(next);
      if (selectedEventId === eventId) setSelectedEventId(null);
      // Keep tombstone in DB for now (matches local behavior).
      const tombstone = next.find((e) => e.id === eventId);
      if (tombstone) {
        void tryUpsertBackendEvent(tombstone);
        if (tombstone.externalProvider === "google" && tombstone.externalId && isGoogleSourceId(tombstone.calendarId)) {
          const source = sources.find((s) => s.id === tombstone.calendarId);
          const accountId = source?.accountId;
          if (accountId) {
            void tryDeleteGoogleEvent(accountId, tombstone.calendarId, tombstone.externalId);
          }
        }
      }
    },
    [events, selectedEventId, sources]
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

  const deleteSource = useCallback(
    (sourceId: string) => {
      const target = sources.find((source) => source.id === sourceId);
      if (!target) return;
      if (sources.length <= 1) return;
      const nextSources = sources.filter((source) => source.id !== sourceId);
      const nextEvents = events.filter((event) => event.calendarId !== sourceId);
      const hasAnySourcesForAccount = nextSources.some((source) => source.accountId === target.accountId);
      const nextAccounts = hasAnySourcesForAccount
        ? accounts
        : accounts.filter((account) => account.id !== target.accountId);

      setSources(nextSources);
      setEvents(nextEvents);
      setAccounts(nextAccounts);
      writeLocalSources(nextSources);
      writeLocalEvents(nextEvents);
      writeLocalAccounts(nextAccounts);
      if (selectedEventId && nextEvents.every((event) => event.id !== selectedEventId)) {
        setSelectedEventId(null);
      }
    },
    [accounts, events, selectedEventId, sources]
  );

  const addInternalCalendar = useCallback(() => {
    let localAccount = accounts.find((account) => account.provider === "local");
    let nextAccounts = accounts;
    if (!localAccount) {
      localAccount = {
        id: safeId(),
        provider: "local",
        email: "",
        displayName: "Local Calendar",
        connected: true,
        lastSyncAt: null,
      };
      nextAccounts = [...accounts, localAccount];
    }

    const normalizedNames = new Set(
      sources
        .filter((source) => source.accountId === localAccount.id)
        .map((source) => source.name.trim().toLowerCase())
    );
    let name = "Internal";
    let idx = 2;
    while (normalizedNames.has(name.toLowerCase())) {
      name = `Internal ${idx}`;
      idx += 1;
    }

    const nextSource: CalendarSource = {
      id: safeId(),
      accountId: localAccount.id,
      name,
      color: DEFAULT_COLORS[sources.length % DEFAULT_COLORS.length] ?? DEFAULT_COLORS[0]!,
      visible: true,
    };

    const nextSources = [...sources, nextSource];
    setAccounts(nextAccounts);
    setSources(nextSources);
    writeLocalAccounts(nextAccounts);
    writeLocalSources(nextSources);
  }, [accounts, sources]);

  const addGoogleAccount = useCallback(async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = (await invoke("calendar_google_oauth_start")) as CalendarOauthStartResult;

    const connectedAccount: CalendarAccount = {
      id: result.accountId,
      provider: "google",
      email: result.email,
      displayName: result.displayName,
      connected: true,
      lastSyncAt: nowIso(),
    };
    const connectedSources: CalendarSource[] = result.calendars.map((cal, i) => ({
      id: cal.id,
      accountId: result.accountId,
      name: cal.name,
      color: cal.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length] || DEFAULT_COLORS[0]!,
      visible: true,
    }));

    const existingAccountIndex = accounts.findIndex((item) => item.id === connectedAccount.id);
    const nextAccounts =
      existingAccountIndex === -1
        ? [...accounts, connectedAccount]
        : accounts.map((item, index) => (index === existingAccountIndex ? connectedAccount : item));

    const byId = new Map<string, CalendarSource>();
    for (const source of sources) byId.set(source.id, source);
    for (const source of connectedSources) byId.set(source.id, source);
    const nextSources = Array.from(byId.values());

    setAccounts(nextAccounts);
    setSources(nextSources);
    writeLocalAccounts(nextAccounts);
    writeLocalSources(nextSources);
  }, [accounts, sources]);

  const addOutlookAccount = useCallback(async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = (await invoke("calendar_outlook_oauth_start")) as CalendarOauthStartResult;

    const connectedAccount: CalendarAccount = {
      id: result.accountId,
      provider: "outlook",
      email: result.email,
      displayName: result.displayName,
      connected: true,
      lastSyncAt: nowIso(),
    };
    const connectedSources: CalendarSource[] = result.calendars.map((cal, i) => ({
      id: cal.id,
      accountId: result.accountId,
      name: cal.name,
      color: cal.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length] || DEFAULT_COLORS[0]!,
      visible: true,
    }));

    const existingAccountIndex = accounts.findIndex((item) => item.id === connectedAccount.id);
    const nextAccounts =
      existingAccountIndex === -1
        ? [...accounts, connectedAccount]
        : accounts.map((item, index) => (index === existingAccountIndex ? connectedAccount : item));

    const byId = new Map<string, CalendarSource>();
    for (const source of sources) byId.set(source.id, source);
    for (const source of connectedSources) byId.set(source.id, source);
    const nextSources = Array.from(byId.values());

    setAccounts(nextAccounts);
    setSources(nextSources);
    writeLocalAccounts(nextAccounts);
    writeLocalSources(nextSources);
  }, [accounts, sources]);

  const addAppleAccount = useCallback(async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const result = (await invoke("calendar_apple_oauth_start")) as CalendarOauthStartResult;

    const connectedAccount: CalendarAccount = {
      id: result.accountId,
      provider: "apple",
      email: result.email,
      displayName: result.displayName,
      connected: true,
      lastSyncAt: nowIso(),
    };
    const connectedSources: CalendarSource[] = result.calendars.map((cal, i) => ({
      id: cal.id,
      accountId: result.accountId,
      name: cal.name,
      color: cal.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length] || DEFAULT_COLORS[0]!,
      visible: true,
    }));

    const existingAccountIndex = accounts.findIndex((item) => item.id === connectedAccount.id);
    const nextAccounts =
      existingAccountIndex === -1
        ? [...accounts, connectedAccount]
        : accounts.map((item, index) => (index === existingAccountIndex ? connectedAccount : item));

    const byId = new Map<string, CalendarSource>();
    for (const source of sources) byId.set(source.id, source);
    for (const source of connectedSources) byId.set(source.id, source);
    const nextSources = Array.from(byId.values());

    setAccounts(nextAccounts);
    setSources(nextSources);
    writeLocalAccounts(nextAccounts);
    writeLocalSources(nextSources);
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
    deleteSource,
    addInternalCalendar,
    addGoogleAccount,
    addOutlookAccount,
    addAppleAccount,
    removeAccount,
    getVisibleEvents,
  };
}
