import { useEffect, useState } from "react";
import { Button } from "../../../components/ui/button";
import { Checkbox } from "../../../components/ui/checkbox";
import { Eyebrow } from "../../../components/ui/eyebrow";
import { Input } from "../../../components/ui/input";
import { supabaseClient } from "../../../lib/runtime.web";
import { ShareMenu } from "../../sharing/share-menu";
import { useWorkspace } from "../../workspaces/workspace-context";

type CalendarRow = {
  id: string;
  name: string;
  kind: string;
  account_id: string | null;
  owner_id: string;
};

type SavedSet = { id: string; name: string; accountIds: string[] };

function accountIdsFrom(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      const calendars = (
        item as { calendars?: { account_id?: string | null } | { account_id?: string | null }[] }
      ).calendars;
      const row = Array.isArray(calendars) ? calendars[0] : calendars;
      return row?.account_id ?? null;
    })
    .filter((id): id is string => Boolean(id));
}

const CAL_LEVELS = [
  { id: "freebusy", label: "Busy only" },
  { id: "view", label: "Can view" },
  { id: "edit", label: "Can edit" },
] as const;

/** Custom calendars, sharing, and a public busy/details link. */
export function CalendarsPanel({
  workspaceId,
  userId,
  onShowAccounts,
}: {
  workspaceId: string;
  userId: string;
  onShowAccounts?: (accountIds: string[]) => void;
}) {
  const { members } = useWorkspace();
  const people = members
    .filter((m) => m.isActive && !m.removedAt)
    .map((m) => ({ userId: m.userId, name: m.displayName || "Teammate" }));
  // Every member's built-in calendar is called "Moduo"; say whose it is.
  const labelFor = (row: CalendarRow) => {
    if (row.owner_id === userId) return row.kind === "moduo" ? "Your calendar" : row.name;
    const owner = people.find((p) => p.userId === row.owner_id)?.name ?? "Teammate";
    return row.kind === "moduo" ? `${owner}'s calendar` : `${row.name} · ${owner}`;
  };
  const [rows, setRows] = useState<CalendarRow[]>([]);
  const [sets, setSets] = useState<SavedSet[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [shareId, setShareId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [savedName, setSavedName] = useState("");

  useEffect(() => {
    let cancelled = false;
    void supabaseClient
      .from("calendars")
      .select("id, name, kind, account_id, owner_id")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .order("name")
      .then(({ data, error }) => {
        if (!cancelled && !error && data) {
          const next = data as CalendarRow[];
          setRows(next);
          setPicked(next.map((row) => row.id));
        }
      });
    void supabaseClient
      .from("calendar_sets")
      .select("id, name, calendar_set_items(calendar_id, calendars(account_id))")
      .eq("workspace_id", workspaceId)
      .then(({ data, error }) => {
        if (cancelled || error || !data) return;
        setSets(
          data.map((row) => ({
            id: row.id as string,
            name: row.name as string,
            accountIds: accountIdsFrom(row.calendar_set_items),
          })),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const reload = () => {
    void supabaseClient
      .from("calendars")
      .select("id, name, kind, account_id, owner_id")
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .order("name")
      .then(({ data, error }) => {
        if (!error && data) setRows(data as CalendarRow[]);
      });
  };

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const { error } = await supabaseClient.rpc("calendar_op_create_custom", {
      p_workspace_id: workspaceId,
      p_name: trimmed,
      p_color: "",
    });
    if (error) return;
    setName("");
    reload();
  };

  const saveSet = async () => {
    const trimmed = savedName.trim();
    if (!trimmed || picked.length === 0) return;
    const { error } = await supabaseClient.rpc("calendar_set_save", {
      p_workspace_id: workspaceId,
      p_name: trimmed,
      p_calendar_ids: picked,
    });
    if (error) return;
    setSavedName("");
    const { data } = await supabaseClient
      .from("calendar_sets")
      .select("id, name, calendar_set_items(calendar_id, calendars(account_id))")
      .eq("workspace_id", workspaceId);
    if (!data) return;
    setSets(
      data.map((row) => ({
        id: row.id as string,
        name: row.name as string,
        accountIds: accountIdsFrom(row.calendar_set_items),
      })),
    );
  };

  return (
    <div className="flex flex-col gap-1 border-t border-border pt-3">
      <Eyebrow as="div" className="px-1">
        Calendars
      </Eyebrow>
      {rows.map((row) => (
        <div key={row.id} className="flex items-center gap-1 px-1">
          <Checkbox
            checked={picked.includes(row.id)}
            onCheckedChange={(on) =>
              setPicked((ids) => (on ? [...ids, row.id] : ids.filter((id) => id !== row.id)))
            }
            aria-label={`Include ${row.name} in a set`}
          />
          <p className="min-w-0 flex-1 truncate text-sm text-foreground">{labelFor(row)}</p>
          {/* Only your own calendars can be shared. (The public busy link is
              hidden until something serves the .ics feed.) */}
          {people.length >= 2 && row.owner_id === userId ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setShareId(row.id)}>
              Share
            </Button>
          ) : null}
          {shareId === row.id ? (
            <ShareMenu
              resourceType="calendar"
              resourceId={row.id}
              members={people}
              selfUserId={userId}
              levels={CAL_LEVELS}
              defaultLevel="freebusy"
              defaultOpen
            />
          ) : null}
        </div>
      ))}
      <form
        className="flex items-center gap-1 px-1"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New calendar"
          className="min-w-0 flex-1"
        />
        <Button type="submit" variant="ghost" size="sm" disabled={!name.trim()}>
          Add
        </Button>
      </form>
      {sets.map((set) => (
        <Button
          key={set.id}
          type="button"
          variant="ghost"
          size="sm"
          className="justify-start"
          onClick={() => onShowAccounts?.(set.accountIds)}
        >
          {set.name}
        </Button>
      ))}
      <form
        className="flex items-center gap-1 px-1"
        onSubmit={(e) => {
          e.preventDefault();
          void saveSet();
        }}
      >
        <Input
          value={savedName}
          onChange={(e) => setSavedName(e.target.value)}
          placeholder="Save this set"
          className="min-w-0 flex-1"
        />
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          disabled={!savedName.trim() || picked.length === 0}
        >
          Save
        </Button>
      </form>
    </div>
  );
}
