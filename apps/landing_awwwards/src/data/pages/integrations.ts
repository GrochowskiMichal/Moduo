// /integrations: everything Moduo connects to, reads in or writes out, as shipped (surveyed 27
// October 2026). Email: features/email/ui/email-connect-dialog.tsx (Gmail, iCloud, custom IMAP;
// Outlook deferred) and the desktop app's IMAP and SMTP code. Calendar:
// features/settings/sections/integrations-section.tsx (Google two-way), calendar-connect-dialog.tsx
// (CalDAV and ICS, read-only, desktop), calendar/booking (public pages, Google Meet). Import:
// notes/ui/note-import-dialog.tsx, tasks/importers, contacts import. Export: settings/advanced.ts,
// notes row menu, tasks view export, contact vCard. AI: settings/sections/api-keys-section.tsx
// names Claude, ChatGPT and Claude Code for the connector; keys cover the rest. Outlook calendar
// and Zoom are left out until a shipped build is checked.

export type IntegrationKind = "email" | "calendar" | "import" | "export" | "ai";

export type Integration = {
  name: string;
  text: string;
  /** How it connects: the words the app uses (Sign in, App password, File, Read-only…). */
  how: string[];
  /** Where it runs. */
  where: string;
  href: string;
};

export const integrations = {
  title: "Integrations: email, calendars, imports and AI",
  description:
    "Connect Gmail, iCloud or any IMAP inbox, Google Calendar both ways, CalDAV and ICS feeds, import from Notion, Todoist or Trello, and bring Claude or ChatGPT over MCP.",
  name: "Integrations",
  line: "Bring what you use. Keep one window.",
  lead: "Your mail, your calendars, the files you’re leaving behind and the assistant you already pay for. Each one lands inside the same links as the rest of your work.",
  cta: { label: "See the import guide", href: "/import" },

  // The plate: the six module strokes, what feeds each one from above, and the assistants'
  // bus under all six. Chat has nothing to import: it fills as you talk.
  plate: {
    title: "Where each one plugs in.",
    text: "Mail feeds Email, calendars feed Calendar, the apps you leave feed Tasks, Notes and Contacts. Your assistant reaches all six, as far as its key allows.",
    label:
      "The six module strokes with what feeds each: Gmail, iCloud Mail and any IMAP mailbox into Email; Todoist, Trello, Linear, Jira and Asana into Tasks; Notion and Markdown into Notes; Google Calendar, CalDAV and ICS feeds into Calendar; a CSV into Contacts. Under all six, a line for assistants over MCP.",
    columns: [
      { module: "email", kinds: ["email"], names: ["Gmail", "iCloud Mail", "Any IMAP"] },
      {
        module: "tasks",
        kinds: ["import"],
        names: ["Todoist", "Trello", "Linear", "Jira", "Asana"],
      },
      { module: "notes", kinds: ["import"], names: ["Notion", "Markdown"] },
      {
        module: "calendar",
        kinds: ["calendar"],
        names: ["Google Calendar", "CalDAV", "ICS feeds"],
      },
      { module: "contacts", kinds: ["import"], names: ["CSV"] },
      { module: "chat", kinds: [], names: [], empty: "Fills as you talk" },
    ] as {
      module: "email" | "tasks" | "notes" | "calendar" | "contacts" | "chat";
      kinds: IntegrationKind[];
      names: string[];
      empty?: string;
    }[],
    ai: {
      names: ["Claude", "ChatGPT", "Claude Code", "Any MCP client"],
      note: "Over MCP, into each module its key allows",
    },
  },

  filter: { label: "Show", all: "All" },

  groups: [
    {
      kind: "email",
      name: "Email",
      text: "Mail runs in the desktop app and stays on your computer. Moduo keeps only a short record of the threads you act on.",
      items: [
        {
          name: "Gmail",
          text: "Your Gmail inbox beside your tasks. Press T on any email and it becomes a task with the email attached.",
          how: ["App password", "Google sign-in"],
          where: "Desktop",
          href: "/email",
        },
        {
          name: "iCloud Mail",
          text: "Your iCloud address, its folders, search and attachments, with snooze and follow-ups on top.",
          how: ["App-specific password"],
          where: "Desktop",
          href: "/email",
        },
        {
          name: "Any IMAP mailbox",
          text: "Your own domain or your company’s server: an IMAP host for reading and an SMTP host for sending.",
          how: ["Server and password"],
          where: "Desktop",
          href: "/email",
        },
      ],
    },
    {
      kind: "calendar",
      name: "Calendar",
      text: "Outside calendars sit in the same week as your time blocks, so one look shows the whole day.",
      items: [
        {
          name: "Google Calendar",
          text: "Your Google events next to your blocks. Events you add on a linked Google calendar are created in Google too.",
          how: ["Sign in", "Two-way"],
          where: "Web and desktop",
          href: "/calendar",
        },
        {
          name: "iCloud, Fastmail and Nextcloud",
          text: "Any CalDAV calendar, shown in your week so you plan around it.",
          how: ["CalDAV", "Read-only"],
          where: "Desktop",
          href: "/calendar",
        },
        {
          name: "Calendar feeds",
          text: "Subscribe to an ICS feed: a team’s holidays, a school term, a public schedule.",
          how: ["Feed URL", "Read-only"],
          where: "Desktop",
          href: "/calendar",
        },
        {
          name: "Booking pages",
          text: "A page at moduo.app/book where people pick a time from your free hours. Guests need no account, and a Google Meet link can come with the booking.",
          how: ["Built in", "Google Meet"],
          where: "Web and desktop",
          href: "/calendar",
        },
      ],
    },
    {
      kind: "import",
      name: "Import",
      text: "Bring the work, not the app. Every import shows you a preview before anything is saved.",
      items: [
        {
          name: "Notion",
          text: "Export your workspace as Markdown and drop the .zip in. Pages become notes and folders become parent notes.",
          how: ["File", ".zip"],
          where: "Web and desktop",
          href: "/import#notes",
        },
        {
          name: "Markdown",
          text: "Loose .md files or a zipped folder of them. Run it again and nothing is duplicated.",
          how: ["File", ".md or .zip"],
          where: "Web and desktop",
          href: "/import#notes",
        },
        {
          name: "Todoist",
          text: "A project’s CSV export comes in with its sections, subtasks, priorities, due dates and comments.",
          how: ["File", "CSV", "Undo"],
          where: "Web and desktop",
          href: "/import#tasks",
        },
        {
          name: "Trello",
          text: "A board’s JSON export. Open lists become statuses, cards become tasks, checklists become subtasks and labels become tags.",
          how: ["File", "JSON", "Undo"],
          where: "Web and desktop",
          href: "/import#tasks",
        },
        {
          name: "Linear",
          text: "Issues from a CSV export. Projects stay projects, milestones become sections, and each state lands on the status it means.",
          how: ["File", "CSV", "Undo"],
          where: "Web and desktop",
          href: "/import#tasks",
        },
        {
          name: "Jira",
          text: "Issues from a CSV export with all fields. Epics become sections and sub-tasks become subtasks.",
          how: ["File", "CSV", "Undo"],
          where: "Web and desktop",
          href: "/import#tasks",
        },
        {
          name: "Asana",
          text: "A project’s CSV export, with its sections, and assignees matched by their email.",
          how: ["File", "CSV", "Undo"],
          where: "Web and desktop",
          href: "/import#tasks",
        },
        {
          name: "Contacts from a CSV",
          text: "The spreadsheet you’ve been running clients in. Map its columns, and a preview marks every row new, merged or duplicate.",
          how: ["File", "CSV"],
          where: "Web and desktop",
          href: "/import#contacts",
        },
      ],
    },
    {
      kind: "export",
      name: "Export",
      text: "Taking your work out is a button, not a request. Use it whenever you like.",
      items: [
        {
          name: "Your whole workspace",
          text: "One .zip from Settings: tasks, notes, contacts, calendar, habits and chat, with every conversation as Markdown too.",
          how: ["JSON", "Markdown"],
          where: "Web and desktop",
          href: "/security",
        },
        {
          name: "Notes as Markdown",
          text: "Any note as an .md file, or a note with all its subpages as a .zip.",
          how: ["Markdown"],
          where: "Web and desktop",
          href: "/notes",
        },
        {
          name: "Task views as CSV",
          text: "Whatever list you’re looking at, as a spreadsheet, as text, or printed.",
          how: ["CSV"],
          where: "Web and desktop",
          href: "/tasks",
        },
        {
          name: "Contacts as vCard",
          text: "Share a person as a .vcf file any address book opens.",
          how: ["vCard"],
          where: "Web and desktop",
          href: "/contacts",
        },
      ],
    },
    {
      kind: "ai",
      name: "AI",
      text: "Moduo is an MCP server. Your assistant reaches only the modules you choose, and every change it makes carries its name.",
      items: [
        {
          name: "Claude",
          text: "Add Moduo as a connector in Claude, sign in, and choose what it can read or change.",
          how: ["Connector", "Sign in"],
          where: "Over MCP",
          href: "/ai",
        },
        {
          name: "ChatGPT",
          text: "The same connector URL, the same sign-in, the same per-module reach.",
          how: ["Connector", "Sign in"],
          where: "Over MCP",
          href: "/ai",
        },
        {
          name: "Claude Code",
          text: "Your coding agent picks up a task, posts how it’s going and hands the work back in the same workspace.",
          how: ["Connector", "Key"],
          where: "Over MCP",
          href: "/mcp",
        },
        {
          name: "Scripts and other clients",
          text: "Anything that speaks MCP over HTTP and can’t sign in uses a key, with its own reach and an expiry date.",
          how: ["Key"],
          where: "Over MCP",
          href: "/mcp",
        },
      ],
    },
  ] as { kind: IntegrationKind; name: string; text: string; items: Integration[] }[],

  notYet: {
    title: "Not here yet.",
    items: [
      { name: "Outlook mail", text: "Gmail, iCloud and IMAP come first." },
      { name: "Phone apps", text: "iPhone and Android follow Mac, Windows and the web." },
      { name: "Linux", text: "The desktop app runs on Mac and 64-bit Windows." },
    ],
  },

  questions: [
    {
      q: "Does connecting Gmail send my email to Moduo’s servers?",
      a: "No. Mail travels between your provider and your computer and is stored there. Moduo keeps a short record of the threads you act on: the sender, the subject, a snippet and the date.",
    },
    {
      q: "Which calendars sync both ways?",
      a: "Google Calendar. CalDAV calendars and ICS feeds show in your week read-only, in the desktop app.",
    },
    {
      q: "Can I undo an import?",
      a: "Task imports can be undone from Your imports. Notes and contacts can’t, so both show a full preview before anything is saved, and running a notes import twice doesn’t duplicate anything.",
    },
    {
      q: "Can an assistant read my email?",
      a: "It can see the details of a thread, never the message itself, and only if its key can view Email. Direct messages in chat stay out of reach too.",
    },
  ],
} as const;
