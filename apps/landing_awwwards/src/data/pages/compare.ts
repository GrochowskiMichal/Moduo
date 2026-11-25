// Compare (/compare): Moduo next to the apps it replaces. Named apps are allowed here (brand 62:
// honest comparison and import pages). Every sentence about Moduo is checked against the app on
// 27 October 2026; every "keep it if" is about Moduo's own limits or what the app category is
// for, never a claim about another company's features or prices. Prices are pricing.stack's,
// with its source.

export type CompareCategory = {
  id: string;
  module: string;
  apps: string;
  moduo: string;
  move: string;
  /** Finishes "Keep <keepWho, else the apps> if …". */
  keep: string;
  keepWho?: string;
  href: string;
};

export const compare = {
  title: "Moduo vs Notion, Todoist, Gmail and Slack",
  description:
    "Compare Moduo with Gmail, Superhuman, Todoist, Notion, Google Calendar, HubSpot and Slack: what Moduo does, how your work moves over, and when to keep the app.",
  name: "Compare",
  line: "Your stack of apps, or one window.",
  lead: "An honest look at the apps Moduo replaces: what changes when the work sits in one place, how it comes across, and when you’re better off keeping what you have.",
  // The signature: one morning of Moduo's own work, kept in a stack and in Moduo.
  where: {
    title: "One morning, ten copies.",
    text: "Follow one email from Maciej through a typical stack. Every copy is something you made by hand, and something that can drift from the original.",
    toggle: { stack: "Your stack", moduo: "Moduo" },
    // Column k is the app (and in Moduo the module) where thing k lives.
    apps: ["Mail", "To-do list", "Notes", "Calendar", "CRM", "Team chat"],
    modules: ["Email", "Tasks", "Notes", "Calendar", "Contacts", "Chat"],
    things: [
      { name: "Maciej’s email", copies: [1, 4], why: "pasted into a task, logged in the CRM" },
      {
        name: "The task it became",
        copies: [2, 3],
        why: "copied into the invite note, blocked on the calendar",
      },
      { name: "The invite note", copies: [3, 5], why: "pasted into the event, shared in chat" },
      { name: "The invite review", copies: [4], why: "logged in the CRM" },
      { name: "Maciej Grzywacz", copies: [0, 3], why: "a contact in mail, a guest on the call" },
      { name: "The alpha channel", copies: [2], why: "its decision copied into a note" },
    ],
    stackCount: { places: "places", copies: "copies" },
    moduoCount: { places: "places", copies: "copies", links: "links" },
    // Under the chain, in Moduo: what each window holds.
    links: [
      "Email to task",
      "Task to note",
      "Note to calendar",
      "Calendar to contact",
      "Contact to chat",
    ],
    caption:
      "In the stack, each thing lives where it was made and again wherever you needed it. In Moduo it lives once, in its module, and the next module gets a window onto it.",
  },
  categories: {
    title: "App by app.",
    text: "What Moduo does in each place, how your work comes across, and when to keep what you have.",
    labels: { moduo: "In Moduo", move: "Moving over", keep: "When to keep it" },
    items: [
      {
        id: "email",
        module: "Email",
        apps: "Gmail, Superhuman",
        moduo:
          "Moduo is a mail client for your Gmail, iCloud or IMAP account, so your address and your provider stay as they are. What changes is what sits beside a message: the sender’s page, and one key that turns the email into a task.",
        move: "Nothing to import. Connect the account in the desktop app and choose how much of your inbox to sync.",
        keep: "you read most of your mail on a phone or in a browser tab. Moduo’s email runs in the desktop app, on Mac and Windows.",
        href: "/email",
      },
      {
        id: "tasks",
        module: "Tasks",
        apps: "Todoist, Things",
        moduo:
          "Lists, a plan for today, repeats you can skip without breaking them, and focus time recorded on the task. A task keeps the email or the note it came from.",
        move: "Import a Todoist export, preview it with your statuses and people matched, and take the whole run back with Undo this import. Trello, Linear, Jira and Asana exports work the same way.",
        keep: "you plan your day on your phone. Moduo has no iPhone or Android app yet.",
        href: "/tasks",
      },
      {
        id: "notes",
        module: "Notes",
        apps: "Notion, Obsidian",
        moduo:
          "Markdown notes with pages inside pages, mentions of people and tasks, and checkbox lines that become real tasks you can tick from either side.",
        move: "Drop a Notion export (Markdown & CSV) or a folder of Markdown files on Import notes. Folders become parent notes.",
        keep: "your work runs on tables and views you designed, or you want your notes as files in a folder on your own disk. Moduo keeps notes in your workspace, and won’t grow tables, on purpose.",
        href: "/notes",
      },
      {
        id: "calendar",
        module: "Calendar",
        apps: "Google Calendar, Fantastical",
        moduo:
          "Your events and the blocks you give your tasks share one week. Tick a task inside its block; a block that runs out asks: later, longer or remove.",
        move: "Connect Google Calendar and it stays in sync both ways. In the desktop app, add iCloud, Fastmail, Nextcloud or any CalDAV calendar, and ICS feeds, to read.",
        keepWho: "Fantastical",
        keep: "you edit events on an iCloud or CalDAV calendar: Moduo reads those but doesn’t write to them. Google Calendar you keep either way, since Moduo writes to it.",
        href: "/calendar",
      },
      {
        id: "contacts",
        module: "Contacts",
        apps: "folk, HubSpot",
        moduo:
          "People and companies whose pages fill in from the work you link: emails, tasks, notes, calls and channels. A status and a next step, without a pipeline to build.",
        move: "Import a CSV, match its columns, and check every row as new, a merge or a duplicate before anything is saved.",
        keep: "you run a sales team on stages, forecasts and sequences. Moduo’s contacts are for knowing a client well, not for selling at volume.",
        href: "/contacts",
      },
      {
        id: "chat",
        module: "Chat",
        apps: "Slack",
        moduo:
          "Channels tied to a client or a project, reply chains you wrap up, and the decision marked so anyone can find it later.",
        move: "Start clean: there is no chat import. Link each channel to its client as you make it.",
        keep: "most of your conversations are with people outside your team, or you work alone. Chat comes with Duo and Team.",
        href: "/chat",
      },
    ] satisfies CompareCategory[],
  },
  cost: {
    title: "And the bill.",
    text: "Five of those apps cost one person {total} a month at list price. Moduo Pro is {pro}, and every module comes linked.",
    link: "See every plan",
  },
  questions: [
    {
      q: "Can I try Moduo next to the apps I use now?",
      a: "Yes. Moduo works with your Gmail, iCloud or IMAP account and with Google Calendar, so you can run both while you decide.",
    },
    {
      q: "Do I have to move everything at once?",
      a: "No. Start with the module you need most, say Email or Tasks, and bring the rest over when you’re ready.",
    },
    {
      q: "What can’t I bring over?",
      a: "Chat history, the tables inside a Notion export, and the images in a notes export. Task imports can be undone; notes and contact imports show a preview first instead.",
    },
    {
      q: "Is Moduo cheaper than the apps it replaces?",
      a: "For one person, Pro is $12 a month, or $10 a month billed yearly. Free covers tasks, notes, calendar, email and contacts for one person, all linked.",
    },
  ],
} as const;
