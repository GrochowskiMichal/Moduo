// A Trello board's JSON export (TV-U18; Menu → Print, export and share →
// Export as JSON): the board is one project; its open lists become the
// project's statuses, each with a category the preview asks you to confirm
// (spec §15); cards become tasks, their checklist items subtasks, their
// labels tags (a label with no name by its colour), their comments comments.
// A card's key is its short link (what its URL shows). Archived cards and
// the cards of archived lists stay behind. Due times are moments: they land
// on the date and time they were in your Time & region zone. Trello's
// export names members without emails, so assignees aren't matched.

import type { TaskStatusCategory } from "@contracts/vocabularies";
import { dueFromInstant, isoDay } from "./dates";
import {
  addStatus,
  bump,
  categoryFromName,
  cleanTags,
  clipDescription,
  emptyPlan,
  type ImportPlan,
  keepComments,
  type PlanComment,
  personFrom,
  planTask,
  projectNamed,
  shapeProjectTasks,
} from "./plan";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** A Trello board export: an object with lists and cards. */
export function looksLikeTrello(data: unknown): boolean {
  const o = obj(data);
  return Array.isArray(o.lists) && Array.isArray(o.cards);
}

/** The category a list's name suggests; a list with no telling name is To do. */
export function listCategory(name: string): TaskStatusCategory {
  const n = name.toLowerCase();
  return (
    categoryFromName(name) ?? (/\b(waiting|blocked|review)\b/.test(n) ? "in_progress" : "todo")
  );
}

const byPos = (a: Obj, b: Obj) => Number(a.pos ?? 0) - Number(b.pos ?? 0);

export function readTrello(data: unknown, fileName: string, zone: string): ImportPlan {
  const board = obj(data);
  const name = str(board.name).trim() || fileName.replace(/\.json$/i, "");
  const plan = emptyPlan("trello", name);
  const project = projectNamed(plan, name);
  project.description = clipDescription(str(board.desc));

  const lists = arr(board.lists).sort(byPos);
  const openLists = new Map<string, string>();
  for (const list of lists) {
    if (list.closed === true) continue;
    const kept = addStatus(
      project,
      str(list.name) || "Untitled list",
      listCategory(str(list.name)),
    );
    if (kept) openLists.set(str(list.id), kept);
  }
  const labelName = new Map<string, string>();
  for (const label of arr(board.labels)) {
    labelName.set(str(label.id), str(label.name).trim() || str(label.color).trim());
  }
  // Board members by id: their full name (Trello's export carries no emails).
  const memberNames = new Map<string, string>();
  for (const m of arr(board.members)) {
    memberNames.set(str(m.id), str(m.fullName).trim() || str(m.username).trim());
  }
  const memberOf = (id: string) =>
    personFrom(memberNames.get(id) ?? "") ?? { name: "A Trello member", email: null };
  const checklistsOf = new Map<string, Obj[]>();
  for (const cl of arr(board.checklists).sort(byPos)) {
    const card = str(cl.idCard);
    checklistsOf.set(card, [...(checklistsOf.get(card) ?? []), cl]);
  }
  // Comments go oldest first (the export lists actions newest first).
  const commentsOf = new Map<string, PlanComment[]>();
  const actions = arr(board.actions).sort((a, b) => str(a.date).localeCompare(str(b.date)));
  for (const action of actions) {
    if (str(action.type) !== "commentCard") continue;
    const data = obj(action.data);
    const card = str(obj(data.card).id);
    const text = str(data.text).trim();
    if (!card || !text) continue;
    const author = str(obj(action.memberCreator).fullName).trim() || null;
    commentsOf.set(card, [
      ...(commentsOf.get(card) ?? []),
      { author, on: isoDay(str(action.date)), text },
    ]);
  }

  const cards = arr(board.cards).sort((a, b) => {
    const la = lists.findIndex((l) => l.id === a.idList);
    const lb = lists.findIndex((l) => l.id === b.idList);
    return la - lb || byPos(a, b);
  });
  for (const card of cards) {
    const status = openLists.get(str(card.idList));
    if (card.closed === true || !status) {
      bump(plan.skipped, "archived");
      continue;
    }
    const title = str(card.name).trim();
    if (!title) {
      bump(plan.skipped, "untitled");
      continue;
    }
    const key = str(card.shortLink) || str(card.id);
    const due = card.due ? dueFromInstant(str(card.due), zone) : null;
    if (card.start) bump(plan.notes, "start_dropped");
    const attachments = Number(obj(card.badges).attachments ?? 0);
    if (attachments > 0) bump(plan.notes, "attachments_dropped", attachments);
    const tags = cleanTags(
      (Array.isArray(card.idLabels) ? card.idLabels : [])
        .map((id) => labelName.get(String(id)) ?? "")
        .filter(Boolean),
    );
    const firstMember = Array.isArray(card.idMembers) ? card.idMembers[0] : undefined;
    project.tasks.push(
      planTask({
        key,
        title,
        description: clipDescription(str(card.desc)),
        status,
        category: project.statuses.find((s) => s.name === status)?.category ?? "todo",
        dueOn: due?.dueOn ?? null,
        dueTime: due?.dueTime ?? null,
        tags,
        // A card's first member is its one assignee (Moduo has one).
        assignee: firstMember ? memberOf(String(firstMember)) : null,
        comments: keepComments(plan, commentsOf.get(str(card.id)) ?? []),
      }),
    );
    const checklists = checklistsOf.get(str(card.id)) ?? [];
    for (const cl of checklists) {
      const prefix = checklists.length > 1 && str(cl.name).trim() ? `${str(cl.name).trim()}: ` : "";
      for (const item of arr(cl.checkItems).sort(byPos)) {
        const itemTitle = str(item.name).trim();
        if (!itemTitle) {
          bump(plan.skipped, "untitled");
          continue;
        }
        const itemDue = item.due ? dueFromInstant(str(item.due), zone) : null;
        project.tasks.push(
          planTask({
            key: `${key}/${str(item.id)}`,
            parentKey: key,
            title: `${prefix}${itemTitle}`,
            category: str(item.state) === "complete" ? "done" : "todo",
            dueOn: itemDue?.dueOn ?? null,
            dueTime: itemDue?.dueTime ?? null,
            assignee: item.idMember ? memberOf(str(item.idMember)) : null,
          }),
        );
      }
    }
  }
  shapeProjectTasks(plan, project);
  if (project.tasks.length === 0) plan.projects = [];
  return plan;
}
