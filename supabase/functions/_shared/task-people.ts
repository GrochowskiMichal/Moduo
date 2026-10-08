// People on a task, as the MCP connector shows them to agents (TV-D1): the
// assignee (null = Unassigned) and the creator. Pure, so it is tested with
// rstest; moduo-mcp imports it relatively.

export type TaskPerson = { id: string; name: string };

/** What the connector reads from a `tasks` row. */
export type TaskPeopleRow = {
  owner_id?: string | null;
  assignee_id?: string | null;
  creator_unknown?: boolean | null;
};

/** Someone no longer in the workspace keeps their tasks and reads like this. */
export const FORMER_MEMBER = "Former member";

function person(id: string, names: ReadonlyMap<string, string>): TaskPerson {
  return { id, name: names.get(id) ?? FORMER_MEMBER };
}

/**
 * The assignee and the creator of a task. Before the TV-D1 migration a row has
 * no assignee_id and owner_id was the assignee, so it is shown as that and no
 * creator is claimed; afterwards owner_id is the creator, left out when the
 * migration couldn't recover it.
 */
export function taskPeople(
  row: TaskPeopleRow,
  names: ReadonlyMap<string, string>,
): { assignee: TaskPerson | null; creator?: TaskPerson } {
  if (row.assignee_id === undefined) {
    return { assignee: row.owner_id ? person(row.owner_id, names) : null };
  }
  const out: { assignee: TaskPerson | null; creator?: TaskPerson } = {
    assignee: row.assignee_id ? person(row.assignee_id, names) : null,
  };
  if (row.owner_id && !row.creator_unknown) out.creator = person(row.owner_id, names);
  return out;
}

/**
 * The assignee's id (null = Unassigned), by taskPeople's rule: a row from
 * before the TV-D1 migration has no assignee_id, and owner_id was the assignee.
 * tasks_list's `assignee: "me"` filters on this.
 */
export function assigneeIdOf(row: TaskPeopleRow): string | null {
  return (row.assignee_id === undefined ? row.owner_id : row.assignee_id) ?? null;
}

/**
 * tasks_assign's assignee argument: null unassigns, "me" is the key's
 * creator, anything else is a member id (the op checks it).
 */
export function resolveAssigneeArg(raw: unknown, keyCreator: string): string | null {
  if (raw === null) return null;
  if (raw === "me") return keyCreator;
  if (typeof raw === "string" && raw.trim() !== "") return raw.trim();
  throw new Error("assignee_id must be a member id, \"me\" or null.");
}

export type AssigneeCandidate = {
  id: string;
  name: string;
  is_me: boolean;
  /** Only people who can work on tasks can be assigned (viewers can't). */
  can_be_assigned: boolean;
};

/**
 * Who a task can be assigned to, as tasks_op_assign decides it: the workspace
 * owner, or a member whose permissions include tasks.edit.
 */
export function assigneeCandidates(input: {
  members: ReadonlyArray<{ user_id: string; perms: readonly string[] | null }>;
  ownerId: string | null;
  names: ReadonlyMap<string, string>;
  me: string;
}): AssigneeCandidate[] {
  const ids = new Set(input.members.map((m) => m.user_id));
  if (input.ownerId) ids.add(input.ownerId);
  const perms = new Map(input.members.map((m) => [m.user_id, m.perms ?? []]));
  return [...ids]
    .map((id) => ({
      id,
      name: input.names.get(id) ?? "Member",
      is_me: id === input.me,
      can_be_assigned: id === input.ownerId || (perms.get(id) ?? []).includes("tasks.edit"),
    }))
    .sort((a, b) => Number(b.is_me) - Number(a.is_me) || a.name.localeCompare(b.name));
}
