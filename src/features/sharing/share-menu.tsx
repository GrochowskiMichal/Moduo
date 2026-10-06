/**
 * Share control for one note, bucket, calendar, contact, or group.
 * Solo workspaces hide it. Duo collapses to one person. Team lists everyone.
 */

import { Lock, Users } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "../../components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { supabaseClient } from "../../lib/runtime.web";

type Person = { userId: string; name: string };

type State = {
  canManage: boolean;
  workspaceLevel: string | null;
  people: { userId: string; level: string }[];
};

const LEVELS = [
  { id: "view", label: "Can view" },
  { id: "edit", label: "Can edit" },
] as const;

const PRIVATE = "private";
const NO_ACCESS = "none";

async function loadState(type: string, id: string): Promise<State | null> {
  const { data, error } = await supabaseClient.rpc("share_op_state", {
    p_type: type,
    p_id: id,
  });
  if (error || !data || data.visible === false) return null;
  return {
    canManage: data.canManage === true,
    workspaceLevel: (data.workspaceLevel as string | null) ?? null,
    people: Array.isArray(data.people) ? data.people : [],
  };
}

export function ShareMenu({
  resourceType,
  resourceId,
  members,
  selfUserId,
  levels = LEVELS,
  defaultLevel,
  inheritsFromParent = false,
  label = "Share",
  defaultOpen = false,
}: {
  resourceType: string;
  resourceId: string;
  members: Person[];
  selfUserId: string | null;
  levels?: readonly { id: string; label: string }[];
  /** Level used when sharing is switched on (default: Can edit, else the first). */
  defaultLevel?: string;
  /** A sub-note that follows its parent's sharing. */
  inheritsFromParent?: boolean;
  label?: string;
  defaultOpen?: boolean;
}) {
  const others = members.filter((m) => m.userId !== selfUserId);
  const [open, setOpen] = useState(defaultOpen);
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );

  const refresh = useCallback(async () => {
    const next = await loadState(resourceType, resourceId);
    if (alive.current) setState(next);
  }, [resourceType, resourceId]);

  // Load on mount (so the trigger icon is right before opening, and a menu
  // opened with defaultOpen shows its real state), and again on every open.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (members.length < 2) return null;

  const onLevel =
    defaultLevel ?? levels.find((l) => l.id === "edit")?.id ?? levels[0]?.id ?? "view";
  const disabled = busy || state === null || state.canManage === false;

  const run = async (fn: string, args: Record<string, unknown>) => {
    setBusy(true);
    const { error } = await supabaseClient.rpc(fn, args);
    if (!alive.current) return;
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return false;
    }
    return true;
  };

  const setGrant = async (subjectType: string, subjectId: string | null, level: string | null) => {
    const ok = await run("share_op_set", {
      p_type: resourceType,
      p_id: resourceId,
      p_subject_type: subjectType,
      p_subject_id: subjectId,
      p_level: level,
    });
    if (ok) await refresh();
  };

  const makePrivate = async () => {
    const ok = await run("share_op_make_private", { p_type: resourceType, p_id: resourceId });
    if (ok) await refresh();
  };

  const duo = others.length === 1 ? others[0] : null;
  const shared = state?.workspaceLevel != null || (state?.people.length ?? 0) > 0;

  // Duo: one effective level for the other person = the higher of the
  // workspace grant and their personal grant.
  const rank = (id: string | null | undefined) => (id ? levels.findIndex((l) => l.id === id) : -1);
  const duoLevel = (() => {
    if (!duo || !state) return null;
    const personal = state.people.find((p) => p.userId === duo.userId)?.level ?? null;
    return rank(personal) > rank(state.workspaceLevel) ? personal : state.workspaceLevel;
  })();

  // In a two-person workspace "shared with Anna" is the workspace grant; a
  // leftover personal grant would keep a higher level alive, so clear it.
  const setDuoLevel = async (level: string) => {
    if (!duo) return;
    const hasPersonal = state?.people.some((p) => p.userId === duo.userId) ?? false;
    const ok = await run("share_op_set", {
      p_type: resourceType,
      p_id: resourceId,
      p_subject_type: "workspace",
      p_subject_id: null,
      p_level: level,
    });
    if (ok && hasPersonal) {
      await run("share_op_set", {
        p_type: resourceType,
        p_id: resourceId,
        p_subject_type: "member",
        p_subject_id: duo.userId,
        p_level: null,
      });
    }
    await refresh();
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void refresh();
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="sm" aria-label={label}>
          {shared || inheritsFromParent ? (
            <Users className="size-icon-sm" aria-hidden />
          ) : (
            <Lock className="size-icon-sm" aria-hidden />
          )}
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-72 flex-col gap-3">
        <p className="font-display text-base">Who can open this</p>
        {inheritsFromParent ? (
          <p className="text-xs text-muted-foreground">
            This note follows its parent's sharing. Changing it here gives it its own sharing.
          </p>
        ) : null}
        {state === null ? <p className="text-sm text-muted-foreground">Loading…</p> : null}

        {duo ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm">Shared with {duo.name}</span>
              <Switch
                checked={shared}
                disabled={disabled}
                aria-label={`Share with ${duo.name}`}
                onCheckedChange={(on) => void (on ? setDuoLevel(onLevel) : makePrivate())}
              />
            </div>
            {shared && duoLevel ? (
              <div className="flex items-center justify-between gap-2 text-sm">
                <span>Access</span>
                <Select
                  value={duoLevel}
                  disabled={disabled}
                  onValueChange={(v) => void setDuoLevel(v)}
                >
                  <SelectTrigger size="sm" className="w-32" aria-label={`${duo.name}'s access`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {levels.map((level) => (
                      <SelectItem key={level.id} value={level.id}>
                        {level.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span>Everyone in the workspace</span>
              <Select
                value={state?.workspaceLevel ?? PRIVATE}
                disabled={disabled}
                onValueChange={(v) => void setGrant("workspace", null, v === PRIVATE ? null : v)}
              >
                <SelectTrigger size="sm" className="w-32" aria-label="Everyone in the workspace">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={PRIVATE}>Private</SelectItem>
                  {levels.map((level) => (
                    <SelectItem key={level.id} value={level.id}>
                      {level.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {others.map((person) => {
              const current =
                state?.people.find((p) => p.userId === person.userId)?.level ?? NO_ACCESS;
              return (
                <div
                  key={person.userId}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span className="min-w-0 truncate">{person.name}</span>
                  <Select
                    value={current}
                    disabled={disabled}
                    onValueChange={(v) =>
                      void setGrant("member", person.userId, v === NO_ACCESS ? null : v)
                    }
                  >
                    <SelectTrigger
                      size="sm"
                      className="w-32"
                      aria-label={`${person.name}'s access`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_ACCESS}>No access</SelectItem>
                      {levels.map((level) => (
                        <SelectItem key={level.id} value={level.id}>
                          {level.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>
        )}

        {!duo ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled || !shared}
            onClick={() => void makePrivate()}
          >
            Make private
          </Button>
        ) : null}
        {state?.canManage === false ? (
          <p className="text-xs text-muted-foreground">
            Only people with full access can change this.
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
