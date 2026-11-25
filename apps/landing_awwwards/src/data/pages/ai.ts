// AI and MCP (/ai): how an assistant works in Moduo. Every claim maps to the connector
// (supabase/functions/moduo-mcp) and the app's API key settings, read on 27 October 2026; the
// tool catalog lives in ./mcp.ts. Assistants named are the ones the app's own copy names (Claude,
// ChatGPT, Claude Code); other clients are only said to work with a key, since nothing else is
// tested. Free keys read and paid keys edit as the plans say (the app doesn't enforce it yet).
import type { KeyModule, Level } from "./mcp";

export const ai = {
  title: "Connect Claude and ChatGPT over MCP",
  description:
    "Moduo is an MCP server. Connect Claude, ChatGPT or Claude Code, choose per module what your assistant can read or change, and see every change it makes.",
  name: "AI and MCP",
  line: "Your assistant works in Moduo, on a key you hold.",
  lead: "Moduo is an MCP server. Add it to Claude, ChatGPT or Claude Code, sign in, and set what your assistant can read or change, one module at a time.",
  docs: "Read the MCP docs",

  reach: {
    title: "Set the reach. The tools follow.",
    text: "A key has a level for each module: None, View or Edit. Change one, and what your assistant can call changes with it.",
    keyName: "Claude Desktop",
    keyMeta: "Connected app",
    status: "Connected",
    countOf: "of",
    countUnit: "tools open",
    legend: [
      { kind: "on", text: "Your assistant can call it" },
      { kind: "need", text: "Also needs Edit on another module" },
    ],
    /** A reach that reads well on arrival: two modules to write in, the rest to look at. */
    start: {
      tasks: "edit",
      notes: "edit",
      calendar: "view",
      email: "view",
      contacts: "view",
      chat: "none",
      links: "view",
    } satisfies Record<KeyModule, Level>,
    /** What each level lets the assistant do, in a line. */
    says: {
      tasks: {
        view: "Reads tasks, projects, your queue and tracked time.",
        edit: "Reads and changes tasks: creates, assigns, schedules, finishes, imports.",
      },
      notes: {
        view: "Reads and searches every note you can open.",
        edit: "Reads and writes notes, moves and archives them, live and undoable.",
      },
      calendar: {
        view: "Reads events and whole days, connected calendars included.",
        edit: "Reads the calendar, creates events, and places or finishes task blocks.",
      },
      email: {
        view: "Sees the threads you pulled into your work: sender, subject, snippet.",
        edit: "Sees those threads, snoozes them, sets follow-ups and links them.",
      },
      contacts: {
        view: "Reads people and companies, with everything linked to them.",
        edit: "Reads people and companies, adds, updates, links and imports them.",
      },
      chat: {
        view: "Reads channels and what’s waiting for you. Never direct messages.",
        edit: "Reads channels, posts, replies, reacts and marks decisions, as you.",
      },
      links: {
        view: "Sees links and comments on anything it can read.",
        edit: "Sees links and comments, makes and removes links, and comments.",
      },
    } satisfies Record<KeyModule, Record<"view" | "edit", string>>,
    none: "Nothing. For this key, the module isn’t there.",
  },

  asks: {
    title: "Ask in your own words.",
    text: "Your assistant picks the tools. Here is what four ordinary requests turn into, and what each one needs.",
    calls: "Calls",
    result: "In Moduo",
    rows: [
      {
        say: "Move whatever I didn’t finish this week to today.",
        calls: ["calendar_day", "calendar_roll_forward"],
        result: [
          { icon: "calendar", text: "4 tasks moved to today" },
          { icon: "clock-3", text: "Each keeps its own time" },
        ],
        needs: "Calendar and Tasks: Edit",
      },
      {
        say: "Snooze the hosting invoice until Monday, and remind me if Maciej doesn’t answer by Friday.",
        calls: ["email_search", "email_snooze", "email_follow_up"],
        result: [
          { icon: "clock-3", text: "Invoice for October, back Mon 9:00" },
          { icon: "bell", text: "Open alpha invite, follow up Fri" },
        ],
        needs: "Email: Edit",
      },
      {
        say: "Draft the 1.4.1 release notes from this week’s done tasks, and link them.",
        calls: ["tasks_list", "notes_create", "tasks_search", "notes_link"],
        result: [
          { icon: "file-text", text: "New note: 1.4.1 release notes" },
          { icon: "link-2", text: "Linked to 9 done tasks" },
        ],
        needs: "Notes and Links: Edit",
      },
      {
        say: "Bring this Todoist export into Tasks v2. If it looks wrong, undo it.",
        calls: ["imports_begin", "tasks_create ×38", "imports_finish"],
        result: [
          { icon: "import", text: "38 tasks in Tasks v2" },
          { icon: "refresh-cw", text: "One run, undone in one step" },
        ],
        needs: "Tasks: Edit",
      },
    ],
  },

  names: {
    title: "Every change has a name.",
    text: "The activity says who your assistant worked for and which app it came through. Nothing moves without a line in the trail.",
    points: [
      {
        title: "As you, never more",
        text: "A key reaches only what its person can open, and stops working when they leave the workspace.",
      },
      {
        title: "Live in your notes",
        text: "An edit it makes shows up as it happens, for anyone with the note open, and you can undo it.",
      },
      {
        title: "Its comments are its own",
        text: "A comment it leaves reads as written by the app, so nobody mistakes it for you.",
      },
    ],
    task: "Send the open alpha invite",
    note: "Invite review",
  },

  never: {
    title: "Out of reach, always.",
    items: [
      {
        no: "The body of an email.",
        why: "A key sees the threads you pulled into your work: sender, subject and a snippet. The message itself stays on your computer.",
      },
      {
        no: "Your direct messages.",
        why: "No key can read one. Private channels stay closed too, unless you switch them on for that key.",
      },
      {
        no: "A module set to None.",
        why: "Its tools don’t exist for that key. Your assistant can’t call them, or see that they’re there.",
      },
      {
        no: "Anything you can’t open.",
        why: "A key never reaches past the person who made it, however its levels are set.",
      },
      {
        no: "Admin.",
        why: "No key can be given admin rights, on any plan.",
      },
    ],
  },

  connect: {
    title: "Connected in three steps.",
    text: "No key to paste. Your assistant signs in to Moduo, and you choose its reach on Moduo’s own page.",
    steps: [
      {
        title: "Copy the connector URL",
        text: "In Moduo, open Settings, then API keys, and copy the connector URL.",
      },
      {
        title: "Add it to your assistant",
        text: "In Claude, ChatGPT or Claude Code, add a custom connector and paste it.",
      },
      {
        title: "Sign in and choose",
        text: "Pick the workspace and a level for each module. Change it any time.",
      },
    ],
    scripts:
      "A script, a scheduled job or another MCP client that can’t sign in uses a key instead: create one under API keys and send it as a header.",
    header: "Authorization: Bearer moduo_sk_…",
    headerLabel: "A key, sent as a header",
  },

  faq: {
    title: "Before you connect.",
    items: [
      {
        q: "Does Moduo train AI on my work?",
        a: "No. We don’t train models, and there is no model of ours inside Moduo. Your assistant follows its own provider’s rules for what it reads, so give each key only the modules it needs.",
      },
      {
        q: "Which assistants can connect?",
        a: "Claude, ChatGPT and Claude Code connect with the connector URL: you sign in and choose what they can reach. Other MCP clients that can send a header can connect with a key.",
      },
      {
        q: "Can I take access back?",
        a: "Any time. Revoke a key or disconnect an app under Settings, API keys, and it loses access on its next request. Keys can also expire after 30 days, 90 days or a year.",
      },
      {
        q: "Which plans include it?",
        a: "Every plan. On Free, keys can read; on Pro, Duo and Team they can also make changes. Chat is part of Duo and Team.",
      },
      {
        q: "What happens if I leave a workspace?",
        a: "Every key you made there stops working. A key never reaches further than the person who made it.",
      },
    ],
  },

  related: "Read next.",
} as const;
