// The calendars rows the rail needs beyond the account map: your Moduo and
// custom calendars (for sharing and visibility), every calendar's account (to
// share a connected one), and the saved views. A view stores the calendars it
// shows; showing it hides every other one.

import { useCallback, useEffect, useState } from "react";

import { supabaseClient } from "../../../lib/runtime.web.client";

export type RailCalendarRow = {
  id: string;
  name: string;
  kind: string;
  color: string | null;
  account_id: string | null;
  owner_id: string;
};

export type SavedView = { id: string; name: string; visibleIds: string[] };

/**
 * The id a calendar shows and hides by: a connected calendar by its account
 * (mirrored events hide with their account), a Moduo or custom calendar by its
 * own id (native events hide with the calendar they're on, CALR-6). See
 * `visibleEvents` in accounts.ts.
 */
export function visibleIdOf(row: { id: string; account_id: string | null }): string {
  return row.account_id ?? row.id;
}

function visibleIdsFrom(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      const { calendar_id: calendarId, calendars } = item as {
        calendar_id?: string;
        calendars?: { account_id?: string | null } | { account_id?: string | null }[];
      };
      const row = Array.isArray(calendars) ? calendars[0] : calendars;
      return row?.account_id ?? calendarId ?? null;
    })
    .filter((id): id is string => Boolean(id));
}

const ROW_COLUMNS = "id, name, kind, color, account_id, owner_id";

// The rename and delete ops aren't in the generated Database types until their
// migration reaches prod (the local types also carry every other session's
// unshipped migrations).
function untypedRpc(fn: string, args: Record<string, unknown>) {
  const client = supabaseClient as unknown as {
    rpc(f: string, a: Record<string, unknown>): PromiseLike<{ error: { message?: string } | null }>;
  };
  return client.rpc(fn, args);
}

/** The server's own reason (a role that can't delete, …), else the fallback. */
function reason(error: { message?: string } | null, fallback: string): string {
  return error?.message?.trim() || fallback;
}
const VIEW_COLUMNS = "id, name, calendar_set_items(calendar_id, calendars(account_id))";

export function useRailCalendars(workspaceId: string) {
  const [rows, setRows] = useState<RailCalendarRow[]>([]);
  const [views, setViews] = useState<SavedView[]>([]);

  const loadRows = useCallback(
    () =>
      supabaseClient
        .from("calendars")
        .select(ROW_COLUMNS)
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null)
        .order("name"),
    [workspaceId],
  );
  const loadViews = useCallback(
    () => supabaseClient.from("calendar_sets").select(VIEW_COLUMNS).eq("workspace_id", workspaceId),
    [workspaceId],
  );
  const toViews = (data: { id: unknown; name: unknown; calendar_set_items: unknown }[]) =>
    data.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      visibleIds: visibleIdsFrom(row.calendar_set_items),
    }));

  useEffect(() => {
    let cancelled = false;
    void loadRows().then(({ data, error }) => {
      if (!cancelled && !error && data) setRows(data as RailCalendarRow[]);
    });
    void loadViews().then(({ data, error }) => {
      if (!cancelled && !error && data) setViews(toViews(data));
    });
    return () => {
      cancelled = true;
    };
  }, [loadRows, loadViews]);

  /** A new Moduo calendar of yours; resolves false when it wasn't made. */
  const createCalendar = useCallback(
    async (name: string): Promise<boolean> => {
      const { error } = await supabaseClient.rpc("calendar_op_create_custom", {
        p_workspace_id: workspaceId,
        p_name: name,
        p_color: "",
      });
      if (error) return false;
      const { data } = await loadRows();
      if (data) setRows(data as RailCalendarRow[]);
      return true;
    },
    [workspaceId, loadRows],
  );

  const reloadRows = useCallback(async () => {
    const { data } = await loadRows();
    if (data) setRows(data as RailCalendarRow[]);
  }, [loadRows]);

  /** Rename a calendar you made; throws the server's reason when it wasn't renamed. */
  const renameCalendar = useCallback(
    async (calendarId: string, name: string): Promise<boolean> => {
      const { error } = await untypedRpc("calendar_op_calendar_rename", {
        p_workspace_id: workspaceId,
        p_calendar_id: calendarId,
        p_name: name,
      });
      if (error) throw new Error(reason(error, "Couldn't rename the calendar."));
      await reloadRows();
      return true;
    },
    [workspaceId, reloadRows],
  );

  /** Delete a calendar you made, with its events; throws when it wasn't deleted. */
  const removeCalendar = useCallback(
    async (calendarId: string): Promise<void> => {
      const { error } = await untypedRpc("calendar_op_calendar_remove", {
        p_workspace_id: workspaceId,
        p_calendar_id: calendarId,
      });
      if (error) throw new Error(reason(error, "Couldn't delete the calendar."));
      await reloadRows();
    },
    [workspaceId, reloadRows],
  );

  /** Undo a delete: the calendar and the events that went with it come back. */
  const restoreCalendar = useCallback(
    async (calendarId: string): Promise<void> => {
      const { error } = await untypedRpc("calendar_op_calendar_restore", {
        p_workspace_id: workspaceId,
        p_calendar_id: calendarId,
      });
      if (error) throw new Error(reason(error, "Couldn't bring the calendar back."));
      await reloadRows();
    },
    [workspaceId, reloadRows],
  );

  /** Save the calendars shown now as a view; resolves false when it wasn't saved. */
  const saveView = useCallback(
    async (name: string, calendarIds: string[]): Promise<boolean> => {
      if (calendarIds.length === 0) return false;
      const { error } = await supabaseClient.rpc("calendar_set_save", {
        p_workspace_id: workspaceId,
        p_name: name,
        p_calendar_ids: calendarIds,
      });
      if (error) return false;
      const { data } = await loadViews();
      if (data) setViews(toViews(data));
      return true;
    },
    [workspaceId, loadViews],
  );

  return { rows, views, createCalendar, renameCalendar, removeCalendar, restoreCalendar, saveView };
}
