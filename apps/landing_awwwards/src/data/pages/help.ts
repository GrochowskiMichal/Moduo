// The help center (/help): every question we can answer today, grouped the way people ask them.
// Answers are checked against the app on 27 October 2026 (sign-in, email connect, calendars,
// imports, export, the MCP connector); the ones the home page and pricing already answer keep
// their words. Plain text only: the page marks search matches inside it.
import { faq as homeFaq, pricing } from "../site";

export type HelpItem = { q: string; a: string; link?: { href: string; label: string } };
export type HelpGroup = { id: string; name: string; items: HelpItem[] };

const home = (q: string) => {
  const item = homeFaq.items.find((i) => i.q === q);
  if (!item) throw new Error(`help: no home question "${q}"`);
  return { q: item.q, a: item.a };
};
const plans = (q: string) => {
  const item = pricing.questions.find((i) => i.q === q);
  if (!item) throw new Error(`help: no pricing question "${q}"`);
  return { q: item.q, a: item.a };
};

export const help = {
  title: "Help center",
  description:
    "Answers about Moduo: invites and sign-in, email, tasks and calendar, notes and contacts, AI and MCP, plans and billing, and what happens to your data.",
  name: "Help",
  line: "Answers from the two people who build Moduo.",
  lead: "Search every question we’ve been asked so far, from invites to keys. If yours isn’t here, write to us and one of us writes back.",
  write: "Email us",
  search: {
    label: "Search the questions",
    placeholder: "Try Gmail, export or keys",
    all: "All",
    count: ["answer", "answers"],
    none: {
      title: "Nothing here matches yet.",
      text: "Write to hello@moduo.app and one of us answers. Then it goes on this page.",
    },
  },
  guides: {
    title: "Guides",
    text: "The longer answers, one page each.",
    slugs: ["import", "mcp", "shortcuts", "download", "security"],
  },
  stuck: {
    title: "Still stuck?",
    text: "Write to us. Two people build Moduo, and one of us reads your email and writes back.",
  },
  groups: [
    {
      id: "start",
      name: "Getting started",
      items: [
        home("When do invites go out?"),
        {
          q: "How do I sign in?",
          a: "With a code we send to your email. There’s no password to set, reuse or forget, and each code works for 10 minutes.",
        },
        home("Which platforms does it run on?"),
        {
          q: "Do I need the desktop app?",
          a: "Only for email. Tasks, notes, calendar, contacts and chat work the same on the web at app.moduo.app. Email lives in the desktop app because your mail stays on your computer.",
          link: { href: "/download", label: "Download Moduo" },
        },
        {
          q: "What is Home?",
          a: "The page Moduo opens on: a grid of widgets you choose, like today’s tasks, the day’s calendar, your inbox and what was linked lately. Add a widget, pick its size, and drag it where it belongs.",
        },
        {
          q: "How do I find something fast?",
          a: "Press ⌘K, or Ctrl K on Windows, from anywhere. It searches every module and opens what you pick.",
          link: { href: "/shortcuts", label: "Every shortcut" },
        },
        {
          q: "What does linked mean in Moduo?",
          a: "Two things that belong together point at each other: an email and the task it became, a note and the call it was written for. You make a link with a key, a mention or a drag, and it shows at both ends.",
        },
      ],
    },
    {
      id: "email",
      name: "Email",
      items: [
        home("Which email accounts can I connect?"),
        {
          q: "How do I connect Gmail?",
          a: "In the desktop app, open Settings, then Integrations, then Email, and choose Gmail. Enter your address and an app password from your Google account, which needs 2-Step Verification turned on.",
        },
        {
          q: "How do I connect iCloud Mail?",
          a: "Choose iCloud in the same place and enter an app-specific password. You create one at appleid.apple.com.",
        },
        home("Where does email work?"),
        {
          q: "Does my mail pass through Moduo’s servers?",
          a: "No. Mail travels between your provider and your computer and is stored there. Moduo keeps only your account details and a short record of the threads you act on: sender, subject, a snippet and the date.",
        },
        {
          q: "How much of my inbox syncs?",
          a: "You choose when you connect: the last 3, 6 or 12 months, or everything. Archived mail isn’t synced yet.",
        },
        {
          q: "How do I turn an email into a task?",
          a: "Press T on the open email. The task lands in your Tasks inbox with the email attached, and the email stays where it was.",
        },
        {
          q: "How do snooze and follow-up work?",
          a: "Snooze a thread until later today, tomorrow, the weekend or next week, and it comes back on time. A follow-up reminds you if nobody answers, and clears itself when they do.",
        },
      ],
    },
    {
      id: "tasks",
      name: "Tasks and calendar",
      items: [
        {
          q: "How do I capture a task without stopping?",
          a: "Press ⌘⇧K, or Ctrl Shift K, from anywhere, even mid-sentence. A bare title is a whole task; where it belongs can wait.",
        },
        {
          q: "What happens to the tasks I don’t finish?",
          a: "Roll them forward to the next day in one step. Nothing turns red, and nothing moves unless you move it.",
        },
        {
          q: "How does focus work?",
          a: "Start a focus session on a task and the minutes are recorded on it, so the next plan is based on what the work really took.",
        },
        {
          q: "Which calendars can I connect?",
          a: "Google Calendar, both ways: events you add to a linked Google calendar are created there too. In the desktop app you can also add iCloud, Fastmail, Nextcloud or any CalDAV calendar, and ICS feeds, read-only.",
        },
        {
          q: "Can I put tasks on my calendar?",
          a: "Drag a task onto a day and it becomes a block that’s still the task. Tick it from the block; if its time runs out first, the block asks: later, longer or remove.",
        },
        {
          q: "What are booking pages?",
          a: "A link of your own on moduo.app where people pick a time from your free hours. Guests need no account, and the booking lands on your calendar, with a Google Meet link if you want one.",
        },
      ],
    },
    {
      id: "notes",
      name: "Notes and contacts",
      items: [
        {
          q: "Can a note hold real tasks?",
          a: "Yes. Write a checkbox line and press ⌘⇧T, or Ctrl Shift T. Tick it in the note and it’s done in Tasks too.",
        },
        {
          q: "How do I link things while I write?",
          a: "Type @ to mention a person, or / to pick a task, a note or a contact. Each mention becomes a link you can open from either end.",
        },
        {
          q: "How do I bring my notes from Notion?",
          a: "Export your Notion workspace as Markdown & CSV, then drop the .zip on Import notes in the Notes sidebar. Folders become parent notes; the CSV and image files are skipped.",
          link: { href: "/import", label: "The import guide" },
        },
        {
          q: "Can I import tasks from another app?",
          a: "Yes, from Todoist, Trello, Linear, Jira and Asana exports, up to 2,000 tasks at a time. You check the preview first, and Undo this import takes the whole run back.",
        },
        {
          q: "How does a contact’s page fill in?",
          a: "From the work you link. Emails, tasks, notes, calls and channels linked to a person gather on their page, grouped, without you logging anything.",
        },
        {
          q: "Can I import my contacts?",
          a: "From a CSV. Match your columns to name, email, phone, title, company and status, and the preview marks each row as new, a merge or a duplicate before anything is saved.",
        },
      ],
    },
    {
      id: "ai",
      name: "AI and MCP",
      items: [
        {
          q: "Does Moduo have AI built in?",
          a: "No model of its own. Moduo is an MCP server: you connect the assistant you already use, and it works in your workspace as far as you let it.",
          link: { href: "/ai", label: "AI in Moduo" },
        },
        {
          q: "Which assistants can I connect?",
          a: "Claude, ChatGPT and Claude Code add Moduo as a connector with one URL and a sign-in. Other tools that speak MCP over HTTP can use a key you create in Settings.",
          link: { href: "/mcp", label: "The MCP docs" },
        },
        {
          q: "What can a connected assistant see?",
          a: "Only the modules you set to View or Edit, and only what you could open yourself. It never reads the body of an email or your direct messages.",
        },
        {
          q: "Can I take access back?",
          a: "Any time. Revoke a key or disconnect an app in Settings and it loses access at once. Keys can also expire after 30 days, 90 days or a year.",
        },
        {
          q: "Does Moduo train AI on my data?",
          a: "No. We don’t train AI models at all, so there’s nothing to train on your work. An assistant you connect follows its own provider’s rules, so give each key only the modules it needs.",
        },
        {
          q: "Can I see what an assistant changed?",
          a: "Yes. The activity trail names the person and the app behind every change, the way it names a teammate.",
        },
      ],
    },
    {
      id: "plans",
      name: "Plans and billing",
      items: [
        plans("How do plans and teams work?"),
        plans("When does my trial start?"),
        plans("What do I get for joining early?"),
        {
          q: "Is Chat on every plan?",
          a: "Chat comes with Duo and Team, since a conversation needs someone to talk to. Free and Pro have everything else.",
          link: { href: "/pricing", label: "Compare the plans" },
        },
      ],
    },
    {
      id: "data",
      name: "Your data and security",
      items: [
        {
          q: "Where is my work stored?",
          a: "On servers in London, run by Supabase, behind access rules tested on every change. Your email stays on your computer.",
          link: { href: "/security", label: "How it’s kept" },
        },
        {
          q: "Can I export everything?",
          a: "Yes. Settings, then Advanced, then Export data gives you one .zip of your tasks, notes, contacts, calendar, habits and chat. Notes also export as Markdown, task views as CSV and contacts as vCards.",
        },
        home("What happens to my data if I leave?"),
        {
          q: "Is there two-factor sign-in?",
          a: "Not yet. You sign in with a one-time code sent to your email, so there’s no password to reuse or leak.",
        },
        home("Does it work offline?"),
      ],
    },
  ] satisfies HelpGroup[],
} as const;
