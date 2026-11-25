// The MCP docs (/mcp), and the tool catalog /ai's toolbelt reads too. Every tool, level and limit
// here is read from the connector (supabase/functions/moduo-mcp, modules/*.ts and registry.ts, and
// _shared/contracts/mcp-key-scopes.ts) on 27 October 2026, Moduo 1.4.0: 110 tools, 5 of them
// deprecated. The one-line descriptions are ours, in plain words; the server's own are written
// for models. Re-read the modules before changing a line.

export type KeyModule = "tasks" | "notes" | "calendar" | "email" | "contacts" | "chat" | "links";
export type Level = "none" | "view" | "edit";

export type Tool = {
  name: string;
  module: KeyModule;
  /** The level the tool needs on its own module. */
  access: "view" | "edit";
  does: string;
  /** Another module the tool also needs at Edit (MCP_TOOL_NEEDS). */
  needs?: KeyModule;
};

/** The key card's order (Settings, API keys) and the app's labels. */
export const keyModules: { id: KeyModule; name: string; touches: string }[] = [
  { id: "tasks", name: "Tasks", touches: "Tasks, tags and the day’s plan" },
  { id: "notes", name: "Notes", touches: "Notes and what’s in them" },
  { id: "calendar", name: "Calendar", touches: "Events and scheduled tasks" },
  { id: "email", name: "Email", touches: "Threads and follow-ups, never full message bodies" },
  { id: "contacts", name: "Contacts", touches: "People and companies" },
  { id: "chat", name: "Chat", touches: "Channels, never direct messages" },
  {
    id: "links",
    name: "Links",
    touches: "Links, comments and search across the modules this key can see",
  },
];

export const levels: { id: Level; name: string }[] = [
  { id: "none", name: "None" },
  { id: "view", name: "View" },
  { id: "edit", name: "Edit" },
];

const t = (
  module: KeyModule,
  access: "view" | "edit",
  name: string,
  does: string,
  needs?: KeyModule,
): Tool => ({
  name,
  module,
  access,
  does,
  ...(needs ? { needs } : {}),
});

export const tools: Tool[] = [
  // Tasks: projects and the shape around them
  t(
    "tasks",
    "view",
    "projects_list",
    "Projects you can see, in sidebar order, with status, dates and client",
  ),
  t("tasks", "view", "areas_list", "The areas your sidebar groups projects under"),
  t("tasks", "view", "sections_list", "A project’s sections, in order, with their dates"),
  t("tasks", "view", "statuses_list", "A project’s statuses, or the workspace’s default set"),
  t("tasks", "view", "teams_list", "The workspace’s teams, their members and default projects"),
  t("tasks", "view", "templates_list", "Task and project templates you can use"),
  // Tasks: reading
  t("tasks", "view", "tasks_list", "Tasks, one short row each"),
  t("tasks", "view", "tasks_get", "One task in full: description, tags, subtasks, blockers"),
  t("tasks", "view", "tasks_search", "Find tasks by words, by handle or by an import’s key"),
  t("tasks", "view", "tasks_history", "A repeating task’s past cycles, done or skipped"),
  t("tasks", "view", "tasks_time_report", "Tracked time for a period, by task or by day"),
  t("tasks", "view", "tasks_attachments_list", "A task’s files, with links that last five minutes"),
  t("tasks", "view", "tasks_activity", "Who did what on a task, people and apps alike"),
  t("tasks", "view", "tasks_list_assignees", "Who a task can be assigned to"),
  t("tasks", "view", "tasks_list_tags", "The workspace’s tags and how often each is used"),
  t("tasks", "view", "tasks_drift", "Open tasks whose scheduled time has passed"),
  t("tasks", "view", "tasks_queue", "Your queue: what you lined up to do next"),
  t("tasks", "view", "tasks_focus_settings", "Your Focus settings: work and break lengths, chime"),
  // Tasks: changing
  t("tasks", "edit", "tasks_create", "Create a task with its project, status, assignee and dates"),
  t("tasks", "edit", "tasks_update", "Edit a task’s title, description, project or dates"),
  t("tasks", "edit", "tasks_set_status", "Move a task to another status, done included"),
  t("tasks", "edit", "tasks_reschedule", "Move a scheduled task to a new time"),
  t("tasks", "edit", "tasks_unschedule", "Clear a stale scheduled time and keep the task"),
  t("tasks", "edit", "tasks_assign", "Assign a task to a teammate, or unassign it"),
  t("tasks", "edit", "tasks_route_team", "Route a task to a team, or take it off one"),
  t("tasks", "edit", "tasks_claim", "Take a task routed to one of your teams"),
  t("tasks", "edit", "tasks_handoff", "Hand a task off: it waits on a person or a thing"),
  t("tasks", "edit", "tasks_waiting_clear", "Clear what a task is waiting on"),
  t("tasks", "edit", "tasks_comment", "Comment on a task when someone asked it to", "links"),
  t(
    "tasks",
    "edit",
    "tasks_session_status",
    "Post an agent’s status: working, needs you, ready, failed",
  ),
  t("tasks", "edit", "tasks_reminder_add", "Remind you at a time, or before a task is due"),
  t("tasks", "edit", "tasks_reminder_remove", "Remove one of your reminders"),
  t("tasks", "edit", "tasks_work_session_add", "Block time for a task on the calendar"),
  t("tasks", "edit", "tasks_work_session_update", "Move or resize a work session"),
  t("tasks", "edit", "tasks_work_session_remove", "Remove a work session"),
  t("tasks", "edit", "tasks_skip_occurrence", "Skip a repeating task’s next occurrence"),
  t("tasks", "edit", "tasks_move_occurrence", "Move one occurrence of a repeating task"),
  t("tasks", "edit", "tasks_queue_add", "Add a task to your queue, at the end or the top"),
  t("tasks", "edit", "tasks_queue_remove", "Take a task out of your queue"),
  t("tasks", "edit", "tasks_queue_reorder", "Reorder your queue"),
  t("tasks", "edit", "projects_create", "Create a project with its area, dates, lead and client"),
  t("tasks", "edit", "projects_update", "Edit a project’s name, status, dates, lead or client"),
  t("tasks", "edit", "projects_duplicate", "Copy a project’s sections and open tasks"),
  t("tasks", "edit", "sections_create", "Add a section to a project"),
  t("tasks", "edit", "areas_create", "Add an area to the sidebar"),
  t("tasks", "edit", "templates_apply", "Make a task or a project from a template"),
  t("tasks", "edit", "imports_begin", "Start an import run, so it can be undone as one"),
  t("tasks", "edit", "imports_finish", "Finish an import run and report what it made"),
  t("tasks", "edit", "imports_undo", "Undo an import run"),
  // Notes
  t("notes", "view", "notes_list", "The note tree: every note’s title and parent"),
  t("notes", "view", "notes_get", "One note, as Markdown"),
  t("notes", "view", "notes_search", "Search note titles and text"),
  t("notes", "edit", "notes_create", "Write a note from Markdown, under a parent or in the Inbox"),
  t("notes", "edit", "notes_append", "Add to the end of a note, live and undoable"),
  t("notes", "edit", "notes_update", "Rewrite or rename a note, live and undoable"),
  t("notes", "edit", "notes_move", "Move a note and its pages under another note"),
  t("notes", "edit", "notes_archive", "Archive a note and its pages"),
  t("notes", "edit", "notes_trash", "Move a note to the Trash, kept for 30 days"),
  t("notes", "edit", "notes_link", "Link a note to a task, a person or anything else", "links"),
  // Calendar
  t(
    "calendar",
    "view",
    "calendar_list_events",
    "Events in a date range, connected calendars included",
  ),
  t("calendar", "view", "calendar_day", "A whole day: events, task blocks, what’s unfinished"),
  t("calendar", "edit", "calendar_create_event", "Create an event, repeating if you like"),
  t("calendar", "edit", "calendar_update_event", "Edit a Moduo event"),
  t("calendar", "edit", "calendar_delete_event", "Delete a Moduo event"),
  t("calendar", "edit", "calendar_schedule_task", "Put a task on the calendar at a time", "tasks"),
  t("calendar", "edit", "calendar_move_block", "Move a task’s block to a new time", "tasks"),
  t("calendar", "edit", "calendar_complete_block", "Finish a task from its block", "tasks"),
  t(
    "calendar",
    "edit",
    "calendar_roll_forward",
    "Move the past week’s unfinished tasks to today",
    "tasks",
  ),
  // Email
  t("email", "view", "email_list", "Threads you pulled into your work: sender, subject, snippet"),
  t("email", "view", "email_get", "One thread’s details, never the message itself"),
  t("email", "view", "email_search", "Search those threads by sender, subject or snippet"),
  t("email", "edit", "email_snooze", "Snooze a thread until a time"),
  t("email", "edit", "email_unsnooze", "Bring a snoozed thread back now"),
  t("email", "edit", "email_follow_up", "Ask to be reminded if nobody replies"),
  t("email", "edit", "email_clear_follow_up", "Clear a follow-up reminder"),
  t("email", "edit", "email_link", "Link a thread to a task, a note or a person"),
  t(
    "email",
    "edit",
    "email_remove",
    "Take a thread out of your workspace; the mailbox is untouched",
  ),
  // Contacts
  t("contacts", "view", "contacts_list", "Every person and company in the workspace"),
  t("contacts", "view", "contacts_get", "A person or company, with everything linked to them"),
  t("contacts", "view", "contacts_search", "Find people and companies by name or email"),
  t("contacts", "edit", "contacts_create", "Add a person, ready to mention"),
  t("contacts", "edit", "contacts_update", "Edit a person’s details"),
  t("contacts", "edit", "contacts_set_status", "Set a person’s status"),
  t("contacts", "edit", "contacts_link", "Link a person to a company, a task or anything else"),
  t("contacts", "edit", "contacts_unlink", "Remove one of a contact’s links"),
  t("contacts", "edit", "contacts_delete", "Delete a contact and its links"),
  t("contacts", "edit", "contacts_import", "Add many people at once, merging the ones you have"),
  // Chat
  t("chat", "view", "chat_list_channels", "The channels this key can read"),
  t("chat", "view", "chat_read", "Read a channel, or one reply chain"),
  t("chat", "view", "chat_search", "Search messages in those channels"),
  t("chat", "view", "chat_addressed_to_me", "What’s waiting for you in Catch up"),
  t("chat", "edit", "chat_post", "Post a message as you, marked with the app’s name"),
  t("chat", "edit", "chat_reply", "Reply to a message in its chain"),
  t("chat", "edit", "chat_react", "React to a message"),
  t("chat", "edit", "chat_mark_decision", "Mark a message as the decision"),
  t("chat", "edit", "chat_wrap_up", "Wrap up a reply chain with the reply that settled it"),
  t("chat", "edit", "chat_create_channel", "Create a channel, if your role allows it"),
  // Links and comments
  t("links", "view", "links_search_entities", "Find anything you could link or mention, by name"),
  t("links", "view", "links_list", "Every link touching an item"),
  t("links", "view", "comments_list", "An item’s comments, oldest first"),
  t("links", "edit", "links_suggest", "Suggested links for an item, never applied on their own"),
  t("links", "edit", "links_create", "Link two items"),
  t("links", "edit", "links_set_kind", "Change what kind of link it is"),
  t("links", "edit", "links_delete", "Remove a link"),
  t("links", "edit", "comments_add", "Comment on any item, mentioning teammates"),
];

/** Still answered, kept for older clients; each names the tool that replaced it. */
export const deprecated: { name: string; use: string }[] = [
  { name: "tasks_list_buckets", use: "projects_list" },
  { name: "tasks_today", use: "tasks_queue" },
  { name: "tasks_commit", use: "tasks_queue_add" },
  { name: "tasks_uncommit", use: "tasks_queue_remove" },
  { name: "tasks_skip_today", use: "tasks_queue_remove" },
];

/** May a key with these levels call this tool? Its own level, plus Edit on what it also needs. */
export function opens(tool: Tool, reach: Record<KeyModule, Level>): boolean {
  const own = reach[tool.module];
  const ok = tool.access === "view" ? own !== "none" : own === "edit";
  return ok && (!tool.needs || reach[tool.needs] === "edit");
}

export const mcp = {
  title: "MCP docs: connector, keys and tools",
  description:
    "Connect an assistant to Moduo over MCP: the connector URL, sign-in and keys, access levels, limits, and all 105 tools an assistant can call, module by module.",
  name: "MCP docs",
  line: "Connect an assistant, and know what it can do.",
  lead: "The connector URL, signing in and keys, access levels and limits, then every tool an assistant can call, module by module.",
  url: "https://mcp.moduo.app",
  howTo: [
    {
      title: "Copy the connector URL",
      text: "In Moduo, open Settings, then API keys, and copy the connector URL: https://mcp.moduo.app.",
    },
    {
      title: "Add it to your assistant",
      text: "In Claude, ChatGPT or Claude Code, add a custom connector and paste the URL.",
    },
    {
      title: "Sign in and choose its reach",
      text: "A Moduo page opens. Pick the workspace and a level for each module, None, View or Edit, then approve.",
    },
  ],
  keyHeader: "Authorization: Bearer moduo_sk_…",
  mcpJson: `{
  "mcpServers": {
    "moduo": {
      "type": "http",
      "url": "https://mcp.moduo.app",
      "headers": { "Authorization": "Bearer moduo_sk_…" }
    }
  }
}`,
  claudeCodeSignIn: "claude mcp add --transport http moduo https://mcp.moduo.app",
  claudeCodeKey: `claude mcp add --transport http moduo https://mcp.moduo.app \\
  --header "Authorization: Bearer moduo_sk_…"`,
  specs: [
    { k: "Transport", v: "Streamable HTTP. POST only, JSON responses, no event stream." },
    { k: "Sessions", v: "None. Every request stands alone, so any request can go to any server." },
    {
      k: "Protocol",
      v: "The 2025 revisions up to 2025-11-25, and 2026-07-28, which Claude speaks.",
    },
    {
      k: "Sign-in",
      v: "OAuth 2.1 with PKCE and dynamic client registration, or a key sent as a Bearer header.",
    },
    { k: "Offers", v: "Tools only. No resources, no prompts." },
    { k: "Reach", v: "Your workspace only. No tool fetches anything from the open web." },
    {
      k: "Rate limits",
      v: "None per key, with one exception: posting in chat, 10 messages in 10 seconds and 30 a minute.",
    },
    { k: "Email", v: "Thread details only: sender, subject, snippet, date. Never a message body." },
    {
      k: "Chat",
      v: "Never direct messages. Private channels only when the key’s person switches them on.",
    },
    { k: "Files", v: "A task’s attachments come as download links that last five minutes." },
  ],
} as const;

/** The docs, part by part. In the text, `code` is set in mono and [words](/path) is a link. */
export const doc = {
  how: {
    id: "how",
    title: "How it works",
    text: [
      "Moduo is a remote MCP server. Your assistant connects to one URL, signs in as you, and gets the tools your choices allow. It works inside your workspace only: no tool reaches the open web, and nothing it does goes unrecorded.",
      "There is no model inside Moduo, and nothing you do is used to train one. The assistant is yours, from the company you chose; Moduo decides only what it can reach.",
    ],
  },
  url: {
    id: "url",
    title: "The connector URL",
    text: [
      "One address for every assistant and every workspace. You’ll also find it in Moduo under Settings, API keys, with a button that copies it.",
    ],
  },
  signin: {
    id: "sign-in",
    title: "Sign in from your assistant",
    text: [
      "Claude, ChatGPT and Claude Code sign in to Moduo the way you sign in to an app: no key to copy, nothing to paste but the URL.",
    ],
    claude:
      "In Claude, add a custom connector under Settings, Connectors. The connection belongs to your Claude account, so it’s there in claude.ai and in the Claude desktop app.",
    code: "In Claude Code, add the server, then run `/mcp` and choose moduo to sign in:",
    codeNote:
      "Claude Code finishes signing in on your own computer (a loopback address), so Moduo’s page says “Moduo hasn’t checked this app.” That’s expected for it.",
    under:
      "Under the hood this is OAuth 2.1 with PKCE and dynamic client registration. Your assistant never holds a password or a key you made; you can see each connection, and when it was last used, under API keys.",
  },
  keys: {
    id: "keys",
    title: "Keys for scripts",
    text: [
      "A script, a scheduled job or an MCP client that can’t sign in uses a key. In Settings, API keys, under “For scripts and tools that can’t sign in”, give it a name, a level for each module and when it expires, then press Create key.",
      "The key appears once. Copy it then: Moduo keeps only a fingerprint of it (a SHA-256 hash), so nobody can show it to you again. A new key starts with Tasks: View and nothing else; a workspace can hold 20 active keys.",
      "Send it with every request as a header:",
    ],
    json: "In a `.mcp.json` file, or any client that reads the same format:",
    cli: "In Claude Code, from the command line:",
  },
  access: {
    id: "access",
    title: "Access levels",
    text: [
      "Each key, and each connected app, has a level for each of seven modules. Tools a level doesn’t allow are left out of the tool list entirely, and refused if called anyway.",
    ],
    levels: [
      { k: "None", v: "The module’s tools aren’t listed and can’t be called." },
      { k: "View", v: "The module’s reading tools." },
      { k: "Edit", v: "Its reading tools and the tools that change things." },
    ],
    modulesLead: "What each module’s tools touch:",
    needsLead:
      "Six tools change two modules at once, so they need Edit on both. A calendar block is the task itself, and links and comments are their own module:",
    ceiling: [
      "A key never reaches past the person who made it. Its levels are capped by what that person can do right now, so a key made by a Viewer can only read, and a key whose person leaves the workspace stops working.",
      "Admin rights can’t be given to a key. Chat is part of the Duo and Team plans, so a Chat level does nothing on Free and Pro.",
    ],
  },
  recorded: {
    id: "recorded",
    title: "What’s recorded",
    text: [
      "Every change a key makes goes into the item’s activity as the person it works for, through the app it came from: “Alex · via Claude Desktop”. Nothing is changed quietly.",
      "An edit to a note shows up live for anyone who has it open, and they can undo it. A comment a key adds reads as written by the app, not by the person.",
    ],
  },
  revoke: {
    id: "revoke",
    title: "Revoke and expiry",
    text: [
      "Revoke a key, or disconnect an app, under Settings, API keys. Moduo checks every request, so access ends on the next one: “Anything connected with this key loses access immediately. This can’t be undone.”",
      "A key can expire after 30 days, 90 days or a year, or never. An expired or revoked key is answered with `401 Unauthorized`.",
    ],
  },
  transport: {
    id: "transport",
    title: "Transport and limits",
  },
  tools: {
    id: "tools",
    title: "Tools",
    text: [
      "All 105, module by module, with the level each one needs. The names are what your assistant sees; the lines are ours.",
    ],
  },
  old: {
    id: "deprecated",
    title: "Deprecated tools",
    text: [
      "Still answered, so older clients keep working. Each one has a replacement; new work should use it.",
    ],
  },
} as const;
