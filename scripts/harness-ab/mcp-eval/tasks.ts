// The 15 user tasks of the MCP agent-experience eval (HV-29, AC38): what a person asks an assistant
// connected to Moduo, in their words. Each task seeds its own fresh workspace through the
// connector, has a reference solution (the calls a good agent makes, run by `check-tasks` to prove
// the oracle passes), and an oracle that reads the result back through the connector. `writes` are
// the write tools the job calls for: any other write, or a deprecated tool, is a wrong-tool call.

import { addDays, type Ctx, nextWeekday } from "./client";

export type McpTask = {
  id: string;
  /** The module it exercises, for the results table. */
  module: "tasks" | "projects" | "notes" | "links" | "contacts" | "calendar" | "chat";
  prompt: string;
  /** Write tools that do the job; reads are always fine. */
  writes: string[];
  seed?: (ctx: Ctx) => Promise<Record<string, any>>;
  /** The reference solution; returns the answer text for question tasks. */
  ref: (ctx: Ctx) => Promise<string | void>;
  /** null = pass, otherwise why it failed. `answer` is the agent's final message. */
  check: (ctx: Ctx, answer: string) => Promise<string | null>;
};

const findTask = async (ctx: Ctx, q: string) => {
  const hits = (await ctx.call("tasks_search", { q })) as any[];
  return hits.filter((t) => t.title.toLowerCase().includes(q.toLowerCase()));
};
const task = (ctx: Ctx, id: string) => ctx.call("tasks_get", { task_id: id });
const note = (ctx: Ctx, id: string) => ctx.call("notes_get", { note_id: id });
const findNote = async (ctx: Ctx, q: string) =>
  ((await ctx.call("notes_list", {})) as any[]).filter((n) =>
    n.title.toLowerCase().includes(q.toLowerCase()),
  );
/** A local wall-clock time on `date` as an ISO string with this machine's offset. */
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00`).toISOString();
const localDay = (iso: string) => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const localHour = (iso: string) => new Date(iso).getHours();
const has = (text: string, ...words: string[]) =>
  words.every((w) => text.toLowerCase().includes(w.toLowerCase()));

/** "Friday" from a weekday: today when it is Friday, else the coming one. */
const thisFriday = (today: string) =>
  new Date(`${today}T12:00:00`).getDay() === 5 ? today : nextWeekday(today, 5);

export const TASKS: McpTask[] = [
  {
    id: "01-task-with-due",
    module: "tasks",
    prompt: "Add a task to buy printer ink, due this Friday.",
    writes: ["tasks_create", "tasks_update"],
    ref: async (ctx) => {
      await ctx.call("tasks_create", { title: "Buy printer ink", due_on: thisFriday(ctx.today) });
    },
    check: async (ctx) => {
      const hits = await findTask(ctx, "printer ink");
      if (hits.length !== 1) return `${hits.length} printer-ink tasks`;
      const due = hits[0].due_on;
      return due === thisFriday(ctx.today) ? null : `due ${due}, wanted ${thisFriday(ctx.today)}`;
    },
  },
  {
    id: "02-complete-task",
    module: "tasks",
    prompt: "I sent the Acme invoice, so mark that task as done.",
    writes: ["tasks_set_status", "tasks_update"],
    seed: async (ctx) => ({
      task: await ctx.call("tasks_create", { title: "Send invoice to Acme" }),
      other: await ctx.call("tasks_create", { title: "Send contract to Globex" }),
    }),
    ref: async (ctx) => {
      await ctx.call("tasks_set_status", { task_id: ctx.seeded.task.id, status: "done" });
    },
    check: async (ctx) => {
      const t = await task(ctx, ctx.seeded.task.id);
      const o = await task(ctx, ctx.seeded.other.id);
      if (o.status_category === "done") return "completed the Globex task too";
      return t.status_category === "done" ? null : `status ${t.status}`;
    },
  },
  {
    id: "03-queue-question",
    module: "tasks",
    prompt: "What's next in my queue? Just list the task titles.",
    writes: [],
    seed: async (ctx) => {
      const a = await ctx.call("tasks_create", { title: "Call the bank about the card" });
      const b = await ctx.call("tasks_create", { title: "Draft the Q4 budget" });
      await ctx.call("tasks_create", { title: "Clean out the garage" });
      await ctx.call("tasks_queue_add", { task_id: a.id });
      await ctx.call("tasks_queue_add", { task_id: b.id });
      return {};
    },
    ref: async () => "1. Call the bank about the card\n2. Draft the Q4 budget",
    check: async (_ctx, answer) => {
      if (!has(answer, "bank") || !has(answer, "Q4 budget")) return "missing a queued task";
      return has(answer, "garage") ? "listed a task that isn't queued" : null;
    },
  },
  {
    id: "04-project-with-tasks",
    module: "projects",
    prompt:
      'Create a project called "Website relaunch" with three tasks in it: draft the copy, pick photos, and set up the domain.',
    writes: ["projects_create", "tasks_create", "sections_create", "tasks_update"],
    ref: async (ctx) => {
      const p = await ctx.call("projects_create", { name: "Website relaunch" });
      for (const title of ["Draft the copy", "Pick photos", "Set up the domain"])
        await ctx.call("tasks_create", { title, project_id: p.id });
    },
    check: async (ctx) => {
      const projects = ((await ctx.call("projects_list", {})) as any[]).filter((p) =>
        has(p.name, "website relaunch"),
      );
      if (projects.length !== 1) return `${projects.length} Website relaunch projects`;
      const list = (await ctx.call("tasks_list", { project_id: projects[0].id })) as any[];
      const titles = list.map((t) => t.title).join(" | ");
      return list.length === 3 && has(titles, "copy", "photo", "domain")
        ? null
        : `project holds: ${titles || "nothing"}`;
    },
  },
  {
    id: "05-move-task-to-project",
    module: "projects",
    prompt: "Move the task about booking the offsite venue into my Q4 planning project.",
    writes: ["tasks_update"],
    seed: async (ctx) => ({
      project: await ctx.call("projects_create", { name: "Q4 planning" }),
      task: await ctx.call("tasks_create", { title: "Book offsite venue" }),
    }),
    ref: async (ctx) => {
      await ctx.call("tasks_update", {
        task_id: ctx.seeded.task.id,
        project_id: ctx.seeded.project.id,
      });
    },
    check: async (ctx) => {
      const t = await task(ctx, ctx.seeded.task.id);
      return t.bucket_id === ctx.seeded.project.id ? null : `task is in ${t.bucket_id}`;
    },
  },
  {
    id: "06-note-create",
    module: "notes",
    prompt:
      'Make a note called "Acme kickoff" with these points: budget is 20k, launch in March, Jane owns design.',
    writes: ["notes_create", "notes_update", "notes_append"],
    ref: async (ctx) => {
      await ctx.call("notes_create", {
        title: "Acme kickoff",
        markdown: "- Budget is 20k\n- Launch in March\n- Jane owns design",
      });
    },
    check: async (ctx) => {
      const hits = await findNote(ctx, "Acme kickoff");
      if (hits.length !== 1) return `${hits.length} Acme kickoff notes`;
      const md = (await note(ctx, hits[0].id)).markdown as string;
      return has(md, "20k", "March", "Jane") ? null : `note reads: ${md.slice(0, 200)}`;
    },
  },
  {
    id: "07-note-append",
    module: "notes",
    prompt: "Add 'Thinking in Systems' to my reading list note.",
    writes: ["notes_append", "notes_update"],
    seed: async (ctx) => ({
      note: await ctx.call("notes_create", {
        title: "Reading list",
        markdown: "- Deep Work\n- The Mom Test",
      }),
    }),
    ref: async (ctx) => {
      await ctx.call("notes_append", {
        note_id: ctx.seeded.note.id,
        markdown: "- Thinking in Systems",
      });
    },
    check: async (ctx) => {
      const md = (await note(ctx, ctx.seeded.note.id)).markdown as string;
      if (!has(md, "Thinking in Systems")) return "not added";
      return has(md, "Deep Work", "Mom Test") ? null : "an existing entry was lost";
    },
  },
  {
    id: "08-note-question",
    module: "notes",
    prompt: "What's the guest wifi password? I saved it in a note somewhere.",
    writes: [],
    seed: async (ctx) => {
      await ctx.call("notes_create", { title: "Groceries", markdown: "- oat milk\n- coffee" });
      await ctx.call("notes_create", {
        title: "Office wifi",
        markdown:
          "Staff network: moduo-staff (ask Mike)\n\nGuest network: moduo-guest, password sunflower42",
      });
      return {};
    },
    ref: async () => "The guest wifi (moduo-guest) password is sunflower42.",
    check: async (_ctx, answer) =>
      has(answer, "sunflower42") ? null : "no password in the answer",
  },
  {
    id: "09-link-note-to-task",
    module: "links",
    prompt: "Link my Acme contract draft note to the task for reviewing the Acme contract.",
    writes: ["links_create", "notes_link"],
    seed: async (ctx) => ({
      note: await ctx.call("notes_create", { title: "Acme contract draft", markdown: "Terms…" }),
      task: await ctx.call("tasks_create", { title: "Review Acme contract" }),
    }),
    ref: async (ctx) => {
      await ctx.call("links_create", {
        source_type: "note",
        source_id: ctx.seeded.note.id,
        target_type: "task",
        target_id: ctx.seeded.task.id,
      });
    },
    check: async (ctx) => {
      const links = (await ctx.call("links_list", {
        entity_type: "task",
        entity_id: ctx.seeded.task.id,
      })) as any[];
      const ends = links.flatMap((l) => [l.source?.id, l.target?.id]);
      return ends.includes(ctx.seeded.note.id) ? null : `${links.length} links, none to the note`;
    },
  },
  {
    id: "10-contact-create",
    module: "contacts",
    prompt: "Add Jane Cooper from Northwind as a contact. Her email is jane@northwind.test.",
    writes: ["contacts_create", "contacts_update"],
    ref: async (ctx) => {
      await ctx.call("contacts_create", { name: "Jane Cooper", email: "jane@northwind.test" });
    },
    check: async (ctx) => {
      const r = (await ctx.call("contacts_search", { query: "Cooper" })) as any;
      const people = (r.contacts ?? []).filter((c: any) => has(c.name, "Jane Cooper"));
      if (people.length !== 1) return `${people.length} Jane Cooper contacts`;
      return people[0].email === "jane@northwind.test" ? null : `email ${people[0].email}`;
    },
  },
  {
    id: "11-calendar-event",
    module: "calendar",
    prompt: "Put a 30-minute call with Jane on my calendar tomorrow at 10am.",
    writes: ["calendar_create_event"],
    ref: async (ctx) => {
      const day = addDays(ctx.today, 1);
      await ctx.call("calendar_create_event", {
        title: "Call with Jane",
        starts_at: at(day, "10:00"),
        ends_at: at(day, "10:30"),
      });
    },
    check: async (ctx) => {
      const day = addDays(ctx.today, 1);
      const events = (await ctx.call("calendar_list_events", {
        from: addDays(ctx.today, -1),
        to: addDays(ctx.today, 3),
      })) as any[];
      const calls = events.filter((e) => has(e.title, "Jane"));
      if (calls.length !== 1) return `${calls.length} events with Jane`;
      const e = calls[0];
      const mins = (Date.parse(e.ends_at) - Date.parse(e.starts_at)) / 60_000;
      if (localDay(e.starts_at) !== day || localHour(e.starts_at) !== 10)
        return `starts ${e.starts_at}`;
      return mins === 30 ? null : `${mins} minutes`;
    },
  },
  {
    id: "12-schedule-task-block",
    module: "calendar",
    prompt: "Block two hours tomorrow at 2pm to work on my Q4 report task.",
    writes: [
      "calendar_schedule_task",
      "tasks_reschedule",
      "tasks_update",
      "tasks_work_session_add",
    ],
    seed: async (ctx) => ({
      task: await ctx.call("tasks_create", { title: "Write the Q4 report" }),
    }),
    ref: async (ctx) => {
      await ctx.call("tasks_update", {
        task_id: ctx.seeded.task.id,
        scheduled_at: at(addDays(ctx.today, 1), "14:00"),
        duration_minutes: 120,
      });
    },
    check: async (ctx) => {
      const t = await task(ctx, ctx.seeded.task.id);
      const day = addDays(ctx.today, 1);
      const blocks = [
        ...(t.scheduled_at ? [{ start: t.scheduled_at, minutes: t.duration_minutes }] : []),
        ...(t.work_sessions ?? []).map((s: any) => ({
          start: s.starts_at ?? s.scheduled_at,
          minutes:
            s.duration_minutes ??
            (s.ends_at && s.starts_at
              ? (Date.parse(s.ends_at) - Date.parse(s.starts_at)) / 60_000
              : null),
        })),
      ].filter((b) => b.start);
      const ok = blocks.some(
        (b) => localDay(b.start) === day && localHour(b.start) === 14 && b.minutes === 120,
      );
      return ok ? null : `blocks: ${JSON.stringify(blocks)}`;
    },
  },
  {
    id: "13-chat-post",
    module: "chat",
    prompt: "Post in the #launch channel that the release is moving to Thursday.",
    writes: ["chat_post"],
    seed: async (ctx) => {
      await ctx.call("chat_create_channel", { name: "launch" });
      await ctx.call("chat_create_channel", { name: "random" });
      return {};
    },
    ref: async (ctx) => {
      await ctx.call("chat_post", {
        channel: "launch",
        text: "Heads up: the release is moving to Thursday.",
      });
    },
    check: async (ctx) => {
      const r = (await ctx.call("chat_read", { channel: "launch" })) as any;
      const posts = (r.messages ?? []).filter((m: any) => has(m.text ?? m.body ?? "", "Thursday"));
      const random = (await ctx.call("chat_read", { channel: "random" })) as any;
      if ((random.messages ?? []).length > 0) return "posted in #random too";
      return posts.length === 1 ? null : `${posts.length} posts about Thursday in #launch`;
    },
  },
  {
    id: "14-push-due-date",
    module: "tasks",
    prompt: "Push the domain renewal task to next Monday.",
    writes: ["tasks_update", "tasks_reschedule"],
    seed: async (ctx) => ({
      task: await ctx.call("tasks_create", { title: "Renew the domain", due_on: ctx.today }),
    }),
    ref: async (ctx) => {
      await ctx.call("tasks_update", {
        task_id: ctx.seeded.task.id,
        due_on: nextWeekday(ctx.today, 1),
      });
    },
    check: async (ctx) => {
      const t = await task(ctx, ctx.seeded.task.id);
      const monday = nextWeekday(ctx.today, 1);
      const scheduled = t.scheduled_at ? localDay(t.scheduled_at) : null;
      // A due date that stays on today while only a time block moves is not "pushed".
      return t.due_on === monday || (scheduled === monday && t.due_on !== ctx.today)
        ? null
        : `due ${t.due_on}, scheduled ${scheduled}, wanted ${monday}`;
    },
  },
  {
    id: "15-task-comment",
    module: "tasks",
    prompt: "Leave a comment on the Acme contract review task saying legal approved it.",
    writes: ["tasks_comment", "comments_add"],
    seed: async (ctx) => ({
      task: await ctx.call("tasks_create", { title: "Review Acme contract" }),
      other: await ctx.call("tasks_create", { title: "Review Globex contract" }),
    }),
    ref: async (ctx) => {
      await ctx.call("tasks_comment", { task_id: ctx.seeded.task.id, body: "Legal approved it." });
    },
    check: async (ctx) => {
      const list = async (id: string) =>
        (((await ctx.call("comments_list", { entity_type: "task", entity_id: id })) as any)
          .comments ?? []) as any[];
      if ((await list(ctx.seeded.other.id)).length) return "commented on the Globex task";
      const mine = (await list(ctx.seeded.task.id)).filter((c) => has(c.body, "legal"));
      return mine.length === 1 ? null : `${mine.length} comments about legal`;
    },
  },
];
