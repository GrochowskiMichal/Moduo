// Settings → Members and access → Teams (tasks-v3 §17, REPLAN 54, 94, 95,
// default t; TV-D13). Teams route work: give a task to Design when you don't
// know who'll do it, and everyone in Design sees it under My tasks; one of
// them takes it. Any member who works on tasks makes a team and edits its
// people; only its creator, the owner or an admin deletes it. A team opens no
// project: its people see its tasks only where they could anyway.
//
// Teams are read from the workspace's shared store (TV-D11a) and written
// through the team ops as store writes, so every surface (capture's `@`, the
// panel's Team picker, the Filter) sees a change at once.

import { Plus, Trash2, X } from "lucide-react";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { PersonAvatar, TeamMark, teamLettersOf } from "../../../components/ui/avatar";
import { Button } from "../../../components/ui/button";
import { IconButton } from "../../../components/ui/icon-button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { useStoreSnapshot, useWorkspaceStore } from "../../../lib/sync/react";
import { undoToast } from "../../../lib/undo-toast";
import { cn } from "../../../lib/utils";
import { useAuth } from "../../../providers/auth-provider";
import { useWorkspace } from "../../../providers/workspace-provider";
import { canBeAssignee } from "../../sharing/rules";
import type { Bucket, Team, TeamMember } from "../../tasks/model";
import { TEAM_COLOR_OPTIONS, teamHue } from "../../tasks/teams";
import { ExplainStrip, friendlyError, PaneHeader } from "./access-ui";
import { memberLabel } from "./person-editor";

const NO_TEAMS: Team[] = [];
const NO_MEMBERS: TeamMember[] = [];
const NO_PROJECTS: Bucket[] = [];
const NONE = "none";

export type TeamFieldsPatch = {
  name?: string;
  mark?: string;
  color?: string | null;
  defaultProjectId?: string | null;
};

export type WorkspaceTeams = {
  /** The workspace's Tasks can be read here (teams live with Tasks). */
  available: boolean;
  /** Tasks at Edit: make teams, add people to them and leave them (default t). */
  canEdit: boolean;
  teams: Team[];
  members: TeamMember[];
  /** Live projects a team can name as its default (no Inbox, nothing deleted). */
  projects: Bucket[];
  /** Archived projects this person can open: only to name a default that sits there. */
  archivedProjects: Bucket[];
  /**
   * The team's creator, the workspace owner or an admin: change its name,
   * letters, colour and default project, take someone else out, delete it.
   */
  canManage: (team: Team) => boolean;
  create: (name: string) => Promise<Team | null>;
  update: (team: Team, patch: TeamFieldsPatch) => Promise<boolean>;
  remove: (team: Team) => void;
  addMember: (team: Team, userId: string) => void;
  removeMember: (team: Team, userId: string) => void;
};

/** The selected workspace's teams, read from and written through its shared store. */
export function useWorkspaceTeams(): WorkspaceTeams {
  const { runtime, userId } = useAuth();
  const {
    selectedWorkspaceId: workspaceId,
    selectedWorkspace,
    modulePermissions,
    myPerms,
  } = useWorkspace();
  const tasksLevel = modulePermissions?.tasks ?? "none";
  const available = tasksLevel !== "none";
  const canEdit = tasksLevel === "edit" || tasksLevel === "admin";
  const store = useWorkspaceStore(runtime, userId, workspaceId, available);
  const { bundle } = useStoreSnapshot(store);
  const teams = useMemo(
    () => [...(bundle.teams ?? NO_TEAMS)].sort((a, b) => a.name.localeCompare(b.name)),
    [bundle.teams],
  );
  const members = bundle.teamMembers ?? NO_MEMBERS;
  const projects = useMemo(
    () =>
      bundle.buckets
        .filter((b) => !b.isSystem && !b.deletedAt)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [bundle.buckets],
  );
  const archivedProjects = bundle.archivedBuckets ?? NO_PROJECTS;
  const isOwner = selectedWorkspace?.role === "owner";
  const canManage = useCallback(
    (team: Team) =>
      canEdit && (team.createdBy === userId || isOwner || myPerms.includes("ws.manage_roles")),
    [canEdit, userId, isOwner, myPerms],
  );

  const ready = !!(store && runtime && workspaceId && canEdit);

  const create = useCallback(
    async (name: string): Promise<Team | null> => {
      if (!ready || !store || !runtime || !workspaceId) return null;
      const trimmed = name.trim();
      if (!trimmed) return null;
      const now = new Date().toISOString();
      const shown: Team = {
        id: crypto.randomUUID(),
        workspaceId,
        name: trimmed,
        mark: teamLettersOf(trimmed),
        color: null,
        defaultProjectId: null,
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      };
      const write = store.begin([{ table: "teams", insert: shown }]);
      try {
        const saved = await runtime.tasks.createTeam({
          workspaceId,
          id: shown.id,
          fields: { name: trimmed },
        });
        write.settle({ teams: [saved] });
        return saved;
      } catch (e) {
        write.fail();
        toast.error(friendlyError(e));
        return null;
      }
    },
    [ready, store, runtime, workspaceId, userId],
  );

  const update = useCallback(
    async (team: Team, patch: TeamFieldsPatch): Promise<boolean> => {
      if (!ready || !store || !runtime || !workspaceId) return false;
      const local: Record<string, unknown> = { ...patch };
      if (patch.mark !== undefined) {
        local.mark = patch.mark.trim().toUpperCase() || teamLettersOf(patch.name ?? team.name);
      }
      const write = store.begin([{ table: "teams", patch: { id: team.id, fields: local } }]);
      try {
        const saved = await runtime.tasks.updateTeam({ workspaceId, teamId: team.id, patch });
        write.settle({ teams: [saved] });
        return true;
      } catch (e) {
        write.fail();
        toast.error(friendlyError(e));
        return false;
      }
    },
    [ready, store, runtime, workspaceId],
  );

  // A delete takes the team off its tasks on the server, so it waits for the
  // Undo window to close (a deferred commit): Undo then brings back the team
  // and its tasks' routing exactly as they were.
  const remove = useCallback(
    (team: Team) => {
      if (!ready || !store || !runtime || !workspaceId) return;
      const write = store.begin([{ table: "teams", remove: team.id }]);
      undoToast(`Deleted ${team.name}`, {
        description: "Its tasks keep their people; they're just not for a team any more.",
        onUndo: () => write.fail(),
        onCommit: () => {
          runtime.tasks
            .updateTeam({ workspaceId, teamId: team.id, patch: { deleted: true } })
            .then(() => {
              write.settle();
              store.forget("teams", [team.id]);
            })
            .catch((e) => {
              write.fail();
              toast.error(friendlyError(e));
            });
        },
      });
    },
    [ready, store, runtime, workspaceId],
  );

  const addMember = useCallback(
    (team: Team, person: string) => {
      if (!ready || !store || !runtime || !workspaceId) return;
      const shown: TeamMember = {
        id: `tmp-${crypto.randomUUID()}`,
        workspaceId,
        teamId: team.id,
        userId: person,
        createdAt: new Date().toISOString(),
      };
      const write = store.begin([{ table: "teamMembers", insert: shown }]);
      runtime.tasks
        .addTeamMember({ workspaceId, teamId: team.id, userId: person })
        .then((rows) => write.settle({ teamMembers: rows }))
        .catch((e) => {
          write.fail();
          toast.error(friendlyError(e));
        });
    },
    [ready, store, runtime, workspaceId],
  );

  const removeMember = useCallback(
    (team: Team, person: string) => {
      if (!ready || !store || !runtime || !workspaceId) return;
      const rows = members.filter((m) => m.teamId === team.id && m.userId === person);
      if (rows.length === 0) return;
      const write = store.begin(rows.map((m) => ({ table: "teamMembers" as const, remove: m.id })));
      runtime.tasks
        .removeTeamMember({ workspaceId, teamId: team.id, userId: person })
        .then((left) => {
          write.settle({ teamMembers: left });
          store.forget(
            "teamMembers",
            rows.map((m) => m.id),
          );
        })
        .catch((e) => {
          write.fail();
          toast.error(friendlyError(e));
        });
    },
    [ready, store, runtime, workspaceId, members],
  );

  return {
    available,
    canEdit,
    teams,
    members,
    projects,
    archivedProjects,
    canManage,
    create,
    update,
    remove,
    addMember,
    removeMember,
  };
}

/** What a team is for, in one line, for anyone new to Moduo. */
const WHAT_TEAMS_DO =
  "Give a task to a team when you don't know who'll do it. Everyone in the team sees it on top of My tasks, and one of them takes it. A team opens no projects: its people see its tasks in projects shared with them.";

/** "New team": a name, and the letters it'll show. */
export function NewTeamPane({
  teams,
  onCreated,
}: {
  teams: WorkspaceTeams;
  onCreated: (team: Team) => void;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const trimmed = name.trim();
  const taken = teams.teams.some((t) => t.name.toLowerCase() === trimmed.toLowerCase());
  const submit = async () => {
    if (!trimmed || taken || saving) return;
    setSaving(true);
    const made = await teams.create(trimmed);
    setSaving(false);
    if (made) onCreated(made);
  };
  return (
    <div className="flex flex-col gap-5">
      <PaneHeader
        leading={trimmed ? <TeamMark name={trimmed} size="lg" /> : null}
        title="New team"
        subtitle="For example Design, Development or Marketing."
      />
      <ExplainStrip>{WHAT_TEAMS_DO}</ExplainStrip>
      <form
        className="flex flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Label htmlFor="team-new-name">Name</Label>
        <div className="flex items-center gap-2">
          <Input
            id="team-new-name"
            value={name}
            maxLength={60}
            autoFocus
            placeholder="Design"
            onChange={(e) => setName(e.target.value)}
            aria-invalid={taken || undefined}
          />
          <Button type="submit" disabled={!trimmed || taken || saving}>
            {saving ? "Creating…" : "Create team"}
          </Button>
        </div>
        {taken ? (
          <span className="text-xs text-destructive">There's already a team called that.</span>
        ) : trimmed ? (
          <span className="text-xs text-muted-foreground">
            It shows as {teamLettersOf(trimmed)}. Add its people next.
          </span>
        ) : null}
      </form>
    </div>
  );
}

/** One team: its name, letters, colour, default project and people. */
export function TeamEditor({ team, teams }: { team: Team; teams: WorkspaceTeams }) {
  const { userId } = useAuth();
  const { members: workspaceMembers } = useWorkspace();
  const editable = teams.canEdit;
  const manages = teams.canManage(team);
  const creatorName = workspaceMembers
    .find((w) => w.userId === team.createdBy && !w.removedAt)
    ?.displayName?.trim();
  // What's being typed (null: not editing), so a change a teammate made while
  // the pane was open shows, and leaving a field untouched never saves it.
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [lettersDraft, setLettersDraft] = useState<string | null>(null);
  const name = nameDraft ?? team.name;
  const letters = lettersDraft ?? team.mark;
  const people = useMemo(
    () =>
      teams.members
        .filter((m) => m.teamId === team.id)
        .map((m) => {
          const member = workspaceMembers.find((w) => w.userId === m.userId);
          return { userId: m.userId, name: member ? memberLabel(member) : "Former member" };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    [teams.members, team.id, workspaceMembers],
  );
  const addable = useMemo(
    () =>
      workspaceMembers
        .filter(
          (m) =>
            m.isActive &&
            !m.removedAt &&
            (m.role === "owner" || canBeAssignee(m.perms)) &&
            !people.some((p) => p.userId === m.userId),
        )
        .map((m) => ({ userId: m.userId, name: memberLabel(m) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [workspaceMembers, people],
  );
  const defaultProject =
    [...teams.projects, ...teams.archivedProjects].find((p) => p.id === team.defaultProjectId) ??
    null;
  // An archived default counts as none when a task is routed (TV-U16): say so.
  const defaultArchived = !!defaultProject?.archivedAt;
  // The store can't tell a project this person can't open from a deleted one,
  // so any default counts as set here (the server lets anyone replace one
  // whose project is gone: stricter here, never looser).
  const hasDefault = !!team.defaultProjectId;
  // Anyone may name a default while there's none; replacing one is for those
  // who manage the team (or, on the server, can edit the project it names).
  const projectEditable = editable && (manages || !hasDefault);
  const inTeam = people.some((p) => p.userId === userId);
  const autoHue = teamHue({ ...team, color: null });
  const autoColor = (
    TEAM_COLOR_OPTIONS.find((o) => o.value === autoHue)?.label ?? autoHue
  ).toLowerCase();

  const saveName = () => {
    if (nameDraft === null) return;
    const next = nameDraft.trim();
    setNameDraft(null);
    if (next && next !== team.name) void teams.update(team, { name: next });
  };
  const saveLetters = () => {
    if (lettersDraft === null) return;
    const next = lettersDraft.trim().toUpperCase();
    setLettersDraft(null);
    if (next !== team.mark) void teams.update(team, { mark: next });
  };

  return (
    <div className="flex flex-col gap-5">
      <PaneHeader
        leading={
          <TeamMark
            name={team.name}
            id={team.id}
            letters={team.mark}
            color={team.color}
            size="lg"
          />
        }
        title={<span className="truncate">{team.name}</span>}
        subtitle={`${people.length} ${people.length === 1 ? "person" : "people"}`}
        actions={
          manages ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => teams.remove(team)}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 aria-hidden />
              Delete
            </Button>
          ) : null
        }
      />
      <ExplainStrip>{WHAT_TEAMS_DO}</ExplainStrip>
      {editable && !manages ? (
        <p className="text-xs text-muted-foreground">
          Only {creatorName || "its creator"}, the workspace owner or an admin renames {team.name},
          changes its colour, replaces its default project or takes people out. You can add people
          {hasDefault ? "" : " or pick its default project"}
          {inTeam ? ", or leave it" : ""}.
        </p>
      ) : null}

      <div className="flex gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Label htmlFor={`team-name-${team.id}`}>Name</Label>
          <Input
            id={`team-name-${team.id}`}
            value={name}
            maxLength={60}
            disabled={!manages}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setNameDraft(null);
            }}
          />
        </div>
        <div className="flex w-32 shrink-0 flex-col gap-1.5">
          <Label htmlFor={`team-mark-${team.id}`}>Letters</Label>
          <Input
            id={`team-mark-${team.id}`}
            value={letters}
            maxLength={2}
            disabled={!manages}
            placeholder={teamLettersOf(team.name)}
            onChange={(e) => setLettersDraft(e.target.value.toUpperCase())}
            onBlur={saveLetters}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setLettersDraft(null);
            }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Colour</Label>
        <div className="flex flex-wrap items-center gap-1.5">
          <ColorChoice
            label="Automatic"
            selected={!team.color}
            disabled={!manages}
            onPick={() => void teams.update(team, { color: null })}
          >
            <TeamMark name={team.name} id={team.id} letters={team.mark} color={autoHue} />
          </ColorChoice>
          {TEAM_COLOR_OPTIONS.map((option) => (
            <ColorChoice
              key={option.value}
              label={option.label}
              selected={team.color === option.value}
              disabled={!manages}
              onPick={() => void teams.update(team, { color: option.value })}
            >
              <span
                aria-hidden
                data-label={option.value}
                className="tag-dot size-3 shrink-0 rounded-full"
              />
            </ColorChoice>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          Automatic picks one from the team and keeps it everywhere ({autoColor}).
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`team-project-${team.id}`}>Default project</Label>
        <Select
          value={team.defaultProjectId ?? NONE}
          disabled={!projectEditable}
          onValueChange={(v) =>
            void teams.update(team, { defaultProjectId: v === NONE ? null : v })
          }
        >
          <SelectTrigger id={`team-project-${team.id}`}>
            <SelectValue placeholder="None">
              {defaultProject
                ? `${defaultProject.name}${defaultArchived ? " (archived)" : ""}`
                : hasDefault
                  ? "Not available"
                  : "None"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>None</SelectItem>
            {teams.projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">
          {defaultArchived
            ? `“${defaultProject?.name}” is archived, so a task for ${team.name} needs a project picked. Pick a live one, or unarchive it.`
            : `A task for ${team.name} with no project goes here. Without one, whoever routes it picks a project. Pick one the team can open.`}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label id={`team-people-${team.id}`}>People</Label>
        {people.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nobody yet. Add the people who'll take {team.name}'s tasks.
          </p>
        ) : (
          <ul aria-labelledby={`team-people-${team.id}`} className="flex flex-col">
            {people.map((p) => (
              <li
                key={p.userId}
                className="flex min-h-(--row-h) items-center gap-2 rounded-md px-1 text-sm"
              >
                <PersonAvatar name={p.name} id={p.userId} size="sm" />
                <span className="min-w-0 flex-1 truncate">
                  {p.name}
                  {p.userId === userId ? (
                    <span className="text-muted-foreground"> · You</span>
                  ) : null}
                </span>
                {p.userId === userId ? (
                  editable ? (
                    <IconButton
                      icon={X}
                      label={`Leave ${team.name}`}
                      onClick={() => teams.removeMember(team, p.userId)}
                    />
                  ) : null
                ) : manages ? (
                  <IconButton
                    icon={X}
                    label={`Take ${p.name} out of ${team.name}`}
                    onClick={() => teams.removeMember(team, p.userId)}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {editable && addable.length > 0 ? (
          <Select value="" onValueChange={(v) => teams.addMember(team, v)}>
            <SelectTrigger aria-label={`Add someone to ${team.name}`} className="w-fit">
              <Plus aria-hidden className="size-icon" />
              <SelectValue placeholder="Add someone" />
            </SelectTrigger>
            <SelectContent>
              {addable.map((m) => (
                <SelectItem key={m.userId} value={m.userId}>
                  {m.name}
                  {m.userId === userId ? " (you)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>
    </div>
  );
}

function ColorChoice({
  label,
  selected,
  disabled,
  onPick,
  children,
}: {
  label: string;
  selected: boolean;
  disabled: boolean;
  onPick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-pressed={selected}
      aria-label={`Colour: ${label}`}
      title={label}
      disabled={disabled}
      onClick={onPick}
      className={cn("border", selected ? "border-foreground" : "border-transparent")}
    >
      {children}
    </Button>
  );
}
