// Seed data for the product lab (e2e/lab/lab.config.ts). One person per variant, because a
// plan allows one workspace per owner: "default" is a founder's realistic week, "empty" a new
// workspace with nothing in it, "dense" a heavy one, "long" one where every name is too long,
// and "first-run" a person who has never seen Tasks' welcome. Everything goes through the same
// ops the app uses (RLS applies); nothing touches dev@moduo.local's workspace.

import {
  endFocusRuns,
  markWelcomeSeen,
  rest,
  rpc,
  type Session,
  setLocalPassword,
  signIn,
  stackKeys,
} from "../tests/support/local-stack.ts";

export type Variant = "default" | "empty" | "dense" | "long" | "first-run";

export type Seeded = {
  people: Record<Variant, { session: Session; workspaceId: string }>;
};

const PEOPLE: Record<Variant, { email: string; name: string }> = {
  default: { email: "lab@moduo.local", name: "Robin Hale" },
  empty: { email: "lab-empty@moduo.local", name: "Jo Park" },
  dense: { email: "lab-dense@moduo.local", name: "Sam Ortiz" },
  long: { email: "lab-long@moduo.local", name: "Alexandra Konstantinidou-Whitfield" },
  "first-run": { email: "lab-new@moduo.local", name: "Kit Moreau" },
};
const PASSWORD = "local-lab-person";

export const day = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

async function ensurePerson(email: string, name: string): Promise<Session> {
  const { url, service } = stackKeys();
  const admin = {
    apikey: service,
    Authorization: `Bearer ${service}`,
    "Content-Type": "application/json",
  };
  const list = await fetch(`${url}/auth/v1/admin/users?per_page=1000`, { headers: admin });
  const users = ((await list.json()) as { users: Array<{ id: string; email: string }> }).users;
  let user = users.find((u) => u.email === email);
  if (!user) {
    const created = await fetch(`${url}/auth/v1/admin/users`, {
      method: "POST",
      headers: admin,
      body: JSON.stringify({
        email,
        email_confirm: true,
        user_metadata: { full_name: name, display_name: name },
      }),
    });
    user = (await created.json()) as { id: string; email: string };
  }
  setLocalPassword(user.id, PASSWORD);
  await rest("service", `profiles?id=eq.${user.id}`, {
    method: "PATCH",
    body: { display_name: name },
  });
  return signIn({ email, password: PASSWORD });
}

/** A fresh workspace for this person; their older lab workspaces are soft-deleted first. */
async function freshWorkspace(who: Session, name: string): Promise<string> {
  await rest("service", `workspaces?owner_id=eq.${who.user.id}&deleted_at=is.null`, {
    method: "PATCH",
    body: { deleted_at: new Date().toISOString() },
  });
  const [row] = await rest<Array<{ id: string }>>(who, "workspaces", {
    method: "POST",
    body: { name, owner_id: who.user.id },
  });
  return row.id;
}

export async function project(who: Session, ws: string, name: string, color = "blue") {
  const id = crypto.randomUUID();
  await rpc(who, "projects_op_create", { p_workspace_id: ws, p_project: { id, name, color } });
  return id;
}

export async function task(
  who: Session,
  ws: string,
  title: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const id = crypto.randomUUID();
  await rpc(who, "tasks_op_create", { p_workspace_id: ws, p_task: { id, title, ...extra } });
  return id;
}

async function founderWeek(who: Session, ws: string): Promise<void> {
  const site = await project(who, ws, "Website relaunch", "blue");
  const round = await project(who, ws, "Seed round", "green");
  const hiring = await project(who, ws, "Hiring", "amber");
  await task(who, ws, "Draft the homepage copy", {
    bucket_id: site,
    due_on: day(0),
    priority: "high",
  });
  await task(who, ws, "Review the pricing page with Ana", { bucket_id: site, due_on: day(1) });
  await task(who, ws, "Pick the hero photo", { bucket_id: site, due_on: day(3) });
  await task(who, ws, "Fix the broken signup link", {
    bucket_id: site,
    due_on: day(-2),
    priority: "medium",
  });
  await task(who, ws, "Write the launch announcement", { bucket_id: site });
  await task(who, ws, "Update the investor deck metrics", { bucket_id: round, due_on: day(0) });
  await task(who, ws, "Send the data room link to Northwind", { bucket_id: round, due_on: day(2) });
  await task(who, ws, "Call Priya about the term sheet", { bucket_id: round, due_on: day(1) });
  await task(who, ws, "Model the 18-month runway", { bucket_id: round, estimate_minutes: 90 });
  await task(who, ws, "Interview: product designer", { bucket_id: hiring, due_on: day(1) });
  await task(who, ws, "Write the backend engineer role", { bucket_id: hiring });
  await task(who, ws, "Reply to the three candidates from Friday", {
    bucket_id: hiring,
    due_on: day(-1),
  });
  for (const [name, color] of [
    ["launch", "green"],
    ["investors", "blue"],
  ] as const) {
    await rest(who, "tags", {
      method: "POST",
      body: { workspace_id: ws, owner_id: who.user.id, name, color },
    });
  }

  // Notes: a few pages, one with a child, titles only (bodies are Yjs documents).
  const note = async (title: string, parent: string | null = null) => {
    const row = await rpc<{ id: string } | Array<{ id: string }>>(who, "notes_op_create", {
      p_workspace_id: ws,
      p_id: null,
      p_parent_id: parent,
      p_title: title,
      p_position: "",
      p_icon: null,
    });
    return Array.isArray(row) ? row[0].id : row.id;
  };
  const plan = await note("Launch plan");
  await note("Press list", plan);
  await note("Launch-day checklist", plan);
  await note("Investor update, October");
  await note("Interview questions: product designer");
  await note("Pricing ideas");

  // Contacts: the people this week's work is about.
  for (const [name, email, title] of [
    ["Ana Ruiz", "ana@studio-ruiz.example", "Brand designer"],
    ["Priya Natarajan", "priya@northwind.example", "Partner, Northwind Ventures"],
    ["Tom Becker", "tom@becker-legal.example", "Startup lawyer"],
    ["Mei Lin", "mei@candidates.example", "Product designer (candidate)"],
    ["Jonas Weber", "jonas@acme.example", "Head of Ops, Acme"],
    ["Sofia Costa", "sofia@costa.example", "Angel investor"],
  ]) {
    await rpc(who, "contacts_op_create", {
      p_workspace_id: ws,
      p_name: name,
      p_email: email,
      p_title: title,
    });
  }

  // Calendar: today and the next few days, at working hours.
  const at = (offset: number, h: number, m = 0) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    d.setHours(h, m, 0, 0);
    return d.toISOString();
  };
  for (const [title, offset, h, mins] of [
    ["Team standup", 0, 9, 15],
    ["Investor call: Northwind", 0, 14, 45],
    ["Design review with Ana", 1, 11, 60],
    ["Interview: Mei Lin", 1, 15, 45],
    ["Board prep", 2, 10, 90],
    ["Lunch with Sofia", 3, 12, 60],
  ] as const) {
    const start = at(offset, h);
    const end = new Date(new Date(start).getTime() + mins * 60_000).toISOString();
    await rpc(who, "calendar_op_event_create", {
      p_workspace_id: ws,
      p_title: title,
      p_starts_at: start,
      p_ends_at: end,
    });
  }
}

/** Chat needs a Duo plan and a second member; both bootstrap, then talk in General. */
async function teamChat(owner: Session, ws: string): Promise<void> {
  const mate = await ensurePerson("lab-mate@moduo.local", "Ana Ruiz");
  await rest("service", `profiles?id=eq.${owner.user.id}`, {
    method: "PATCH",
    body: { plan_tier: "duo" },
  });
  const member = await rest<unknown[]>(
    "service",
    `workspace_members?workspace_id=eq.${ws}&user_id=eq.${mate.user.id}&select=id`,
  );
  if (member.length === 0) {
    await rest("service", "workspace_members", {
      method: "POST",
      body: { workspace_id: ws, user_id: mate.user.id, role: "member" },
    });
  }
  await rpc(owner, "chat_op_bootstrap", { p_workspace_id: ws });
  await rpc(mate, "chat_op_bootstrap", { p_workspace_id: ws });
  const [general] = await rest<Array<{ id: string }>>(
    owner,
    `chat_channels?workspace_id=eq.${ws}&is_default=is.true&select=id`,
  );
  if (!general) return;
  for (const [who, body] of [
    [mate, "Morning! I pushed the new hero options to the drive, three directions."],
    [owner, "Nice. The second one feels closest to what we said about calm."],
    [mate, "Agreed. I'll take it further today and send the final by Thursday."],
    [owner, "Perfect, that lines up with the launch-day checklist."],
    [mate, "Also: Priya asked for the updated deck before the call at 2."],
  ] as const) {
    await rpc(who, "chat_op_send", {
      p_id: crypto.randomUUID(),
      p_channel_id: general.id,
      p_body: body,
      p_reply_to_id: null,
    });
  }
}

async function denseWorkspace(who: Session, ws: string): Promise<void> {
  const verbs = [
    "Review",
    "Draft",
    "Ship",
    "Plan",
    "Fix",
    "Call",
    "Send",
    "Update",
    "Check",
    "Book",
  ];
  const things = [
    "the onboarding email",
    "Q4 budget",
    "the pricing test",
    "the API docs",
    "the board update",
    "invoices",
    "the roadmap",
    "support replies",
  ];
  for (let p = 0; p < 6; p++) {
    const id = await project(who, ws, `Workstream ${p + 1}`, ["blue", "green", "amber"][p % 3]);
    for (let i = 0; i < 50; i++) {
      await task(
        who,
        ws,
        `${verbs[(i + p) % verbs.length]} ${things[(i * 3 + p) % things.length]} ${i + 1}`,
        {
          bucket_id: id,
          ...(i % 3 === 0 ? { due_on: day((i % 14) - 4) } : {}),
        },
      );
    }
  }
}

async function longWorkspace(who: Session, ws: string): Promise<void> {
  const id = await project(
    who,
    ws,
    "Customer onboarding and implementation programme for enterprise accounts in the DACH region",
    "blue",
  );
  await task(
    who,
    ws,
    "Prepare the quarterly business review deck for the enterprise customer success team, including churn analysis, expansion pipeline and the renewal risk register for every account over fifty seats",
    { bucket_id: id, due_on: day(1) },
  );
  await task(
    who,
    ws,
    "Follow up with procurement about the vendor security questionnaire (sections 4.2 to 9.7) before Thursday's call",
    { bucket_id: id, due_on: day(0) },
  );
  await task(
    who,
    ws,
    "Zusammenfassung der Anforderungen für die Datenschutz-Folgenabschätzung übersetzen und an die Rechtsabteilung schicken",
    { bucket_id: id },
  );
  await task(
    who,
    ws,
    "https://example.com/a/really/long/link/that/someone/pasted/as/a/task/title/without/any/spaces/at/all",
    { bucket_id: id },
  );
}

export async function seed(log: (...a: string[]) => void = () => {}): Promise<Seeded> {
  const people = {} as Seeded["people"];
  for (const [variant, p] of Object.entries(PEOPLE) as Array<
    [Variant, { email: string; name: string }]
  >) {
    const session = await ensurePerson(p.email, p.name);
    await endFocusRuns(session.user.id);
    const workspaceId = await freshWorkspace(
      session,
      variant === "default" ? "Hale & Co" : `Lab ${variant}`,
    );
    if (variant !== "first-run") await markWelcomeSeen(session.user.id);
    log(`seed ${variant}`);
    if (variant === "default") {
      await founderWeek(session, workspaceId);
      await teamChat(session, workspaceId);
    }
    if (variant === "dense") await denseWorkspace(session, workspaceId);
    if (variant === "long") await longWorkspace(session, workspaceId);
    people[variant] = { session, workspaceId };
  }
  return { people };
}
