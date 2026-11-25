// Every visible string on the site lives here, so copy changes never touch markup.
//
// Sources and assumptions (mirrored in DESIGN.md):
// - Lines the brand fixes are verbatim (.design/brand/BRAND_BRIEF.md §11): the campaign line,
//   the brand line, the boilerplate. Hero subcopy, FAQ answers, plans and the founders' quotes
//   are the strings shipped on apps/landing (vetted there).
// - Every product claim maps to shipped behavior: email → task (features/email/convert.ts, T),
//   note checkbox lines → tasks (notes/editor/plugins/task-line-plugin.tsx, ⌘⇧T), event notes
//   with @ and / (calendar/ui/event-detail-panel.tsx), the contact roll-up, channels linked to a
//   client (chat/linking.ts), snooze and follow-up, roll forward, booking pages, focus sessions,
//   MCP keys per module (supabase/functions/moduo-mcp).
// - Prices are the planned launch prices published on the current landing.
// - Every demo picture is Moduo's own workspace (DESIGN.md §15, "Moduo in Moduo"): Mike and
//   Maciej building Moduo in Moduo, this week of the open alpha. Demo content, never customer data.

export const site = {
  name: "Moduo",
  url: "https://moduo.app",
  appUrl: "https://app.moduo.app",
  email: "hello@moduo.app",
  brandLine: "One window for the whole working life.",
  campaignLine: "Fire ten apps. Keep the work.",
  boilerplate:
    "Moduo is a lightweight workspace that links email, tasks, notes, calendar, contacts and chat in one window.",
  description:
    "Moduo links email, tasks, notes, calendar, contacts and chat in one window, so nothing lives in two places. Private beta, invites go out in waves.",
  status: "Private beta",
  socials: [
    { label: "X", href: "https://x.com/Moduo_App" },
    { label: "LinkedIn", href: "https://www.linkedin.com/company/moduo_app/" },
    { label: "Product Hunt", href: "https://www.producthunt.com/@moduo_app" },
    { label: "Reddit", href: "https://www.reddit.com/user/Moduo_app/" },
    { label: "Instagram", href: "https://www.instagram.com/moduo_app/" },
    { label: "YouTube", href: "https://www.youtube.com/@Moduo_app" },
  ],
} as const;

export const nav = [
  { label: "Modules", href: "/#modules" },
  { label: "AI", href: "/ai" },
  { label: "Pricing", href: "/pricing" },
  { label: "Download", href: "/download" },
  { label: "Manifesto", href: "/manifesto" },
] as const;

export const waitlist = {
  label: "Email address",
  placeholder: "you@company.com",
  button: "Join the waitlist",
  note: "One email when your invite is ready. No spam.",
  doneTitle: "You’re on the list.",
  doneText: "We’ll email you when your invite is ready.",
  again: "Use a different email",
  privacy: "How we handle your email",
  errors: {
    empty: "Enter your email to join.",
    invalid: "That email doesn’t look right. Check it and try again.",
    rate: "Too many tries from this network. Give it a few minutes and try again.",
    offline: "Couldn’t reach the server. Check your connection and try again.",
    server: "Something went wrong on our side. Try again in a moment.",
  },
  close: "Close",
  // The header's button once you're on the list.
  onList: "On the list",
  // The dialog (components/WaitlistDialog.astro): the form beside the one email the list sends.
  dialogTitle: "Join the waitlist",
  dialogText: "Moduo opens in waves. When yours opens, this is the one email we send.",
  // The invite as it will sit in the inbox: the real subject (supabase/functions/_shared/email/
  // templates/waitlist-invite.ts); "To" is what the visitor types.
  invite: {
    caption:
      "The invite email, as it will arrive: from Moduo, “Your Moduo invite is ready”, to the email you enter.",
    from: "Moduo",
    when: "When your wave opens",
    subject: "Your Moduo invite is ready",
    to: "To",
    queued: "Queued",
  },
} as const;

// ── Home ─────────────────────────────────────────────────────────────────────

export const hero = {
  // The line (2026-10-30, Mike's), "What You touch stays in touch.", as a lockup with the word
  // set once: the two short lines on the left, the one word at the height of both ending each
  // (components/home/Scene.astro). "You" takes a capital (Mike's call, the same day): the line
  // is to the reader. The campaign line (brand 61) stays the campaign line: the page title, the
  // press kit, the specimen.
  line: { first: "What You", word: "touch", second: "stays in", end: "." },
  // Under it, a sentence a line: what Moduo is, then the rule it keeps (the colophon reads it as
  // "the line under our headline").
  sub: [
    "Email, tasks, notes, calendar, contacts and chat in one window.",
    "Nothing lives in two places.",
  ],
  activityLabel: "Moduo, today",
  activity: [
    { time: "9:12", text: "Maciej emailed “Open alpha invite”" },
    { time: "9:13", text: "You turned the email into a task" },
    { time: "9:15", text: "The task joined the alpha plan note" },
    { time: "9:20", text: "You linked the note to Monday’s call" },
    { time: "9:21", text: "The call showed up on Maciej’s page" },
    { time: "9:24", text: "Maciej replied in #open-alpha" },
  ],
} as const;

// Dusk, the hero as a story (components/home/Dusk.astro, motion/dusk.ts, DESIGN.md §13): one
// email, from before dawn to sunrise. Seven chapters; each is a line in Paper and a second thought
// in the reading grey, two short lines each so they fit a phone (at most 16 characters a Paper
// line, 20 a grey one). The first chapter is the page's opening line alone, set larger than the
// story's (Mike's, 2026-11-03); the story starts with the scroll.
// `label` names the chapter for its button and for readers of the story's list; `when` is the
// hour and the module under each chapter's lines (the sky is the clock, this is its reading).
export const dusk = {
  chapters: [
    {
      label: "Your space to think, dream and build",
      lines: [["Your space", "to think, dream", "and build."]],
    },
    {
      label: "Maciej writes",
      when: "05:52 · Email",
      lines: [["Maciej writes."], ["The alpha invite", "needs your eyes."]],
    },
    {
      label: "Moduo knows him",
      when: "05:53 · Contacts",
      lines: [["Moduo knows him."], ["Every thread with", "him, one card away."]],
    },
    {
      label: "Make it work",
      when: "05:54 · Tasks",
      lines: [["Make it work."], ["Press T. His email", "is now a task."]],
    },
    {
      label: "His time, your day",
      when: "06:12 · Calendar",
      lines: [
        ["His time,", "your day."],
        ["Three slots go out.", "Maciej takes 14:00."],
      ],
    },
    {
      label: "Everyone's in",
      when: "06:20 · Chat",
      lines: [["Everyone’s in."], ["It lands in chat.", "No forward needed."]],
    },
    {
      label: "Still in touch",
      when: "06:41 · Home",
      lines: [["Still in touch."], ["One email, one key,", "and the sun’s up."]],
    },
  ],
  // The chapter row's hint before the first move, and its count after.
  scrollHint: "Scroll",
  // The window, for readers: what the story shows.
  windowLabel:
    "Moduo’s own Home before dawn, the week of the open alpha: Maciej’s email about the invite arrives in the inbox, his contact card opens beside it, one key turns the email into a task, he takes Thursday 14:00 on the calendar, and the team picks it up in chat.",
} as const;

/** The six modules, in brand order (75). */
export const moduleOrder = ["email", "tasks", "notes", "calendar", "contacts", "chat"] as const;
export type ModuleSlug = (typeof moduleOrder)[number];

export const interlock = {
  closing: {
    title: "In Moduo they overlap.",
    text: "Where two modules meet, a link opens. You make it while you work: a key, a mention, a drag.",
  },
  done: {
    title: "One email. Five links. Nothing copied.",
    text: "That was our own morning, the week of the open alpha. Every link here is one gesture in the app, and none of it was filed by hand.",
  },
  grown: {
    title: "Then the next email, and the next.",
    text: "Every email, task, note, call and conversation joins the same way, with one gesture, for as long as you work.",
  },
  // The stage's running count, bottom right, in the footer's spec-sheet grammar.
  readout: { strokes: ["stroke", "strokes"], windows: ["window", "windows"] },
  // Window k sits between moduleOrder[k] and moduleOrder[k + 1].
  links: [
    {
      title: "Email to task",
      text: "Press T on Maciej’s email. It becomes a task, and the email stays attached.",
    },
    {
      title: "Task to note",
      text: "Add the task to the alpha plan note as a checkbox line. Tick it there, and it’s done in Tasks too.",
    },
    {
      title: "Note to calendar",
      text: "Type / in Thursday’s review to link the alpha plan note. It opens with the call.",
    },
    {
      title: "Calendar to contact",
      text: "Mention @Maciej in the call’s notes and the call shows up on his page, next to his emails and tasks. Nobody filed it.",
    },
    {
      title: "Contact to chat",
      text: "Link #open-alpha to the project, and the whole conversation sits with it.",
    },
  ],
  // The same five links as our own story (the open alpha invite), each drawn as the thing it is in the app
  // (components/home/LinkCard.astro): the task, the note, the event, the contact, the channel.
  // Each carries the one before it as a linked row, named the way the app names the relation.
  cards: [
    {
      kind: "task",
      module: "Tasks",
      icon: "circle-check",
      title: "Review the alpha invite",
      project: "Open alpha",
      due: "Thu",
      link: { icon: "mail", text: "Open alpha invite", rel: "Created from" },
    },
    {
      kind: "note",
      module: "Notes",
      icon: "file-text",
      title: "Open alpha plan",
      line: "First wave from the waitlist on the 16th.",
      link: { task: true, text: "Review the alpha invite", rel: "Task" },
    },
    {
      kind: "event",
      module: "Calendar",
      icon: "calendar",
      title: "Invite review",
      when: "Thu 14:00 · 1 h",
      guests: ["MA", "MI"],
      link: { icon: "file-text", text: "Open alpha plan", rel: "Linked" },
    },
    {
      kind: "person",
      module: "Contacts",
      icon: "contact",
      title: "Maciej Grzywacz",
      initials: "MA",
      role: "Co-founder, product and design · Moduo",
      link: { icon: "calendar", text: "Invite review", rel: "Attendee" },
    },
    {
      kind: "channel",
      module: "Chat",
      icon: "message-circle",
      title: "open-alpha",
      message: {
        initials: "MA",
        name: "Maciej Grzywacz",
        text: "Links in the invite all check out.",
      },
      link: { initials: "MA", text: "Maciej Grzywacz", rel: "Conversation" },
    },
  ],
} as const;

// The modules' section (components/home/ModulesIndex.astro): the problem as its title, each
// module taking over the apps it replaces (ten in all), and the answer with the keys at the end.
export const modulesIntro = {
  title: "Six kinds of work, spread over ten apps.",
  answer: "Six modules. One window.",
  // The apps each module takes the place of, struck out as it comes into the window.
  was: {
    email: ["Mail"],
    tasks: ["To-do list", "Planner", "Time tracker", "Habits"],
    notes: ["Notes", "Docs"],
    calendar: ["Calendar"],
    contacts: ["CRM"],
    chat: ["Team chat"],
  },
  // The window's bar keeps the count.
  tally: (n: number) => `${n} of 10 apps`,
  // Each module's one gesture as the window shows it: the key pressed (or none: a drag, a click),
  // and the note the app shows for what it did. Every one is shipped behavior.
  moments: {
    email: {
      key: "T",
      icon: "list-checks",
      title: "Task made",
      text: "Open alpha invite",
      tag: "Email attached",
    },
    tasks: {
      key: "⏎",
      icon: "circle-check",
      title: "Done",
      text: "Prep the invite review",
      tag: "24 min on the task",
    },
    notes: {
      key: "⌘ ⇧ T",
      icon: "circle-check",
      title: "Task made",
      text: "Test the invite links",
      tag: "Linked to this note",
    },
    calendar: {
      key: "",
      icon: "calendar",
      title: "Accepted",
      text: "Invite review, Thu 14:00",
      tag: "Maciej Grzywacz",
    },
    contacts: {
      key: "",
      icon: "link-2",
      title: "Linked",
      text: "Maciej to Open alpha",
      tag: "From 3 threads",
    },
    chat: {
      key: "",
      icon: "flag",
      title: "Decision",
      text: "First wave on the 16th",
      tag: "Wrapped up in open-alpha",
    },
  },
} as const;

/** The home page's module cards: each one's moment, in a line or two. */
export const modulesBento: Record<ModuleSlug, string> = {
  email:
    "Gmail, iCloud or IMAP in one inbox. Press T and the email becomes a task, still attached.",
  tasks: "A plan for today, and a focus timer that writes the minutes onto the task.",
  notes: "Docs that mention people. One shortcut turns a checkbox line into a real task.",
  calendar:
    "Events and the blocks you set for tasks share one week. A block that runs out asks what next.",
  contacts:
    "Open a client and everything you share is there, each with how it links. New faces at their company offer to join.",
  chat: "Channels tied to clients. Wrap a thread up and flag what was decided.",
};

export const keys = {
  // Rendered as one sentence; {k:…} becomes a live keycap (motion/keys.ts lights it when pressed).
  parts: [
    { k: "⌘ K" },
    " finds anything in any module, ",
    { k: "⌘ 1" },
    " to ",
    { k: "⌘ 6" },
    " jump between them, and ",
    { k: "?" },
    " shows the rest.",
  ],
} as const;

export const ai = {
  title: "Bring any AI. It only sees what you allow.",
  text: "Moduo is an MCP server. Connect Claude, ChatGPT, Gemini or a model running on your own machine, then choose per module what each key can see or change.",
  trust:
    "We don’t train AI models, so there’s nothing to train on your work. An assistant you connect follows its own provider’s rules, so limit what each key can see, or run a local model and no AI company sees your work.",
  keyName: "Claude",
  askTitle: "Ask about your week",
  askText: "Your assistant answers from your own work, as far as its key reaches.",
  rightsTitle: "Each key, its own reach",
  keyNote: "What this key can do. Change any module, and watch the answer.",
  levels: ["None", "View", "Edit"] as const,
  // The app's order (Settings, API keys).
  access: [
    { module: "Tasks", level: 2 },
    { module: "Notes", level: 2 },
    { module: "Calendar", level: 1 },
    { module: "Email", level: 1 },
    { module: "Contacts", level: 1 },
    { module: "Chat", level: 0 },
  ],
  prompt: "What’s still open before the invite review?",
} as const;

// Home, the page you arrange (components/home/Board.astro): a live board of widgets.
export const board = {
  title: "Home is the page you arrange.",
  text: "Every module has a widget, and so do the small things: a focus timer, a clock, the days left before a launch. Put each one where you want it. Give one more room and it shows more.",
  hintFine:
    "Drag a widget by its name and pull its corner to resize it. On a focused widget, the arrow keys move it, Shift with the arrows resizes it, and Delete takes it off the board.",
  hintTouch: "Hold a widget by its name to move it, and pull its corner to resize it.",
  presets: [
    { id: "monday", name: "Monday" },
    { id: "focus", name: "Deep work" },
    { id: "client", name: "Release day" },
  ],
  shelf: "Add a widget",
  shelfEmpty: "Everything is on the board.",
  label: "A Moduo Home board you can arrange: move, resize, add and remove its widgets.",
  note: "Home, redrawn from the app and taken a step further. Its look is still changing.",
} as const;

export const yours = {
  title: "Your work stays yours.",
  lead: "Take it out, keep it from every model, take a key back, or leave. Each is a setting you change yourself, not a request you send us.",
  items: [
    { word: "Export", text: "Tasks, notes, calendar, email and contacts, whenever you want them." },
    { word: "Import", text: "Notion and Markdown notes, and contacts from a CSV." },
    { word: "Revoke", text: "Every assistant uses a key you control. Take it back any time." },
    {
      word: "No training",
      text: "Moduo never trains on your data. There is no model of ours to feed.",
    },
    { word: "Leave", text: "Delete your account and everything goes with it. No exit interview." },
  ],
} as const;

export const refusals = {
  title: "What we won’t build.",
  text: "Saying no keeps Moduo light. These are on purpose.",
  items: [
    {
      no: "Databases you design before you work",
      instead: "You came here to work, not to model your life in tables.",
    },
    {
      no: "An AI button on every screen",
      instead: "Bring your own model over MCP, and give it only the keys it needs.",
    },
    {
      no: "A scheduler that moves your day for you",
      instead: "Nothing moves unless you move it. Your plan stays yours.",
    },
    {
      no: "A wall of red overdue tasks",
      instead: "Falling behind is normal. Shame isn’t a feature.",
    },
  ],
} as const;

// ── Pricing ──────────────────────────────────────────────────────────────────

export type Plan = {
  id: "free" | "pro" | "duo" | "team";
  name: string;
  who: string;
  people: string;
  /** Glyph: strokes in the figure (people), and whether the single stroke is an outline. */
  strokes: number;
  outline?: boolean;
  monthly: string;
  yearly: string;
  unit: string;
  billedYearly: string;
  billedMonthly: string;
  founding?: string;
  features: string[];
  pick?: boolean;
};

export const pricing = {
  title: "Plans for one, two or a whole team.",
  text: "Start free. Try Pro for 14 days with no card, or 30 days with one. Early members keep the founding price.",
  // Pro saves 17% yearly, Duo and Team 20%.
  yearlySave: "Save up to 20%",
  plans: [
    {
      id: "free",
      name: "Free",
      who: "For one person, on web and desktop",
      people: "1 person",
      strokes: 1,
      outline: true,
      monthly: "$0",
      yearly: "$0",
      unit: "",
      billedYearly: "Free for good",
      billedMonthly: "Free for good",
      features: [
        "Tasks, notes, calendar, email and contacts, all linked",
        "1 workspace, 1 email account",
        "AI keys that can read",
      ],
    },
    {
      id: "pro",
      name: "Pro",
      who: "For one person, with room to grow",
      people: "1 person",
      strokes: 1,
      monthly: "$12",
      yearly: "$10",
      unit: "/mo",
      billedYearly: "Billed $120 a year",
      billedMonthly: "Billed monthly",
      founding: "Founding price $8/mo",
      features: [
        "Everything in Free",
        "Unlimited workspaces and email accounts",
        "AI keys that can edit",
        "Full history, more storage, priority support",
      ],
    },
    {
      id: "duo",
      name: "Duo",
      who: "For exactly two people",
      people: "2 people",
      strokes: 2,
      monthly: "$20",
      yearly: "$16",
      unit: "/mo for two",
      billedYearly: "Billed $192 a year",
      billedMonthly: "Billed monthly",
      founding: "Founding price $13/mo",
      pick: true,
      features: [
        "Pro for both of you",
        "Shared workspaces",
        "Assign tasks and mention each other",
        "Chat and calls",
      ],
    },
    {
      id: "team",
      name: "Team",
      who: "For three people or more",
      people: "3 or more",
      strokes: 4,
      monthly: "$15",
      yearly: "$12",
      unit: "/seat/mo",
      billedYearly: "Per seat, billed yearly",
      billedMonthly: "Per seat, billed monthly",
      founding: "Founding price $10 a seat for the first year",
      features: [
        "Everything in Duo",
        "Three seats or more, no minimum beyond that",
        "Roles, permissions and guests",
        "Admin controls",
      ],
    },
  ] satisfies Plan[],
  fine: "Moduo is in private beta. Prices in USD, before tax. Your trial starts when your invite arrives.",
  compare: {
    title: "Compare every plan",
    head: ["", "Free", "Pro", "Duo", "Team"],
    rows: [
      ["People", "1", "1", "2", "3 or more"],
      ["Tasks, notes, calendar, contacts and the Home grid", "Yes", "Yes", "Yes", "Yes"],
      ["Email (desktop app)", "1 account", "Unlimited", "Unlimited", "Unlimited"],
      ["Workspaces", "1", "Unlimited", "Unlimited", "Unlimited"],
      ["Links between everything", "Yes", "Yes", "Yes", "Yes"],
      ["AI keys over MCP", "Read", "Read and edit", "Read and edit", "Read and edit"],
      ["Version history", "Short", "Full", "Full", "Full"],
      ["Assigning and mentions", "No", "No", "Yes", "Yes"],
      ["Chat and calls", "No", "No", "Yes", "Yes"],
      ["Roles, guests, admin", "No", "No", "No", "Yes"],
      ["Support", "Email", "Priority", "Priority", "Priority"],
    ],
  },
  stack: {
    title: "What five of those ten apps cost one person.",
    text: "The five you would pay for first, each doing one part, none of them linked, before you count the time spent copying between them.",
    rows: [
      { app: "Notion Plus", does: "Notes", price: 12.0 },
      { app: "Todoist Pro", does: "Tasks", price: 7.0 },
      { app: "Fantastical Premium", does: "Calendar", price: 6.99 },
      { app: "Superhuman Starter", does: "Email", price: 30.0 },
      { app: "folk Standard", does: "Contacts", price: 30.0 },
    ],
    moduo: { app: "Moduo Pro", does: "All of it, linked", price: 12.0 },
    source:
      "List prices for one person on monthly billing, from each vendor’s US pricing page on 2 October 2026. Moduo’s price is the planned launch price.",
  },
  questions: [
    {
      q: "What do I get for joining early?",
      a: "The founding price: Pro at $8 a month for as long as you stay subscribed. Duo is $13 a month, and Team is $10 a seat for the first year.",
    },
    {
      q: "How do plans and teams work?",
      a: "Free is for one person, with tasks, notes, calendar, email, contacts and Home, all linked. Pro adds unlimited workspaces and email accounts, and AI keys that can edit. Duo is Pro for exactly two people, plus shared workspaces, chat and calls. Team starts at three seats and adds roles, guests and admin controls.",
    },
    {
      q: "When does my trial start?",
      a: "When your invite arrives. Pro’s trial runs 14 days without a card, or 30 days if you add one.",
    },
  ],
} as const;

// ── Makers ───────────────────────────────────────────────────────────────────

export const makers = {
  title: "Made by a duo.",
  text: "We were running our work across a stack of apps and still copying the same things between them. So we started building the one workspace we wanted.",
  name: "Mod for modular. Duo for the two of us.",
  more: "What our coding agent makes of us",
  type: "The typeface we cut from our mark",
  people: [
    {
      name: "Maciej Grzywacz",
      role: "Product and design",
      does: "Product concept, design and the front end",
      photo: "maciej",
      quote:
        "Clients, projects, hobbies and ideas, spread over too many apps, subscriptions and automations. I spent more time organizing my work than doing it. Moduo is the one place I wanted instead.",
    },
    {
      name: "Mike Grochowski",
      role: "Engineering",
      does: "The back end, the servers and the technical core",
      photo: "mike",
      quote:
        "Startups, hackathons, events I organized, trips to San Francisco to meet clients and learn. I needed one place that holds all of it, so I can skip the setup and get straight to work.",
    },
  ],
} as const;

// ── Questions ────────────────────────────────────────────────────────────────

export const faq = {
  title: "Questions.",
  text: "Something we didn’t cover, or a project you’d like to talk through? Write to hello@moduo.app. We read everything, and a person writes back.",
  items: [
    {
      q: "When do invites go out?",
      a: "In waves, starting soon. Join the waitlist and we’ll send you one email when it’s your turn.",
    },
    {
      q: "Where does email work?",
      a: "In the desktop app, on Mac and Windows. On the web you still see follow-ups, snoozed threads and everything linked to an email.",
    },
    {
      q: "Which email accounts can I connect?",
      a: "Gmail, iCloud and any other provider that supports IMAP.",
    },
    {
      q: "Which platforms does it run on?",
      a: "Mac, Windows and the web, all at launch. iPhone and Android apps come after.",
    },
    {
      q: "Can I bring my notes and contacts?",
      a: "Yes. Import a Notion export or Markdown files, and contacts from a CSV.",
    },
    {
      q: "Does Moduo train AI on my data?",
      a: "We don’t train AI models at all. If you connect an assistant over MCP, it follows its own provider’s data rules, so limit what each key can see, or run a model on your own machine.",
    },
    {
      q: "Does it work offline?",
      a: "Losing your connection won’t stop you working. Your changes sync when you’re back online.",
    },
    {
      q: "What happens to my data if I leave?",
      a: "Export your workspace data from Settings whenever you like, and delete your account in one step.",
    },
  ],
} as const;

// The footer is the production landing's spec-sheet grid (apps/landing), carried over: six lists
// in six cells (components/Footer.astro). A link without an href is a page that doesn't exist
// yet: it shows a "Soon" tag.
export type FooterLink = { label: string; href?: string; external?: boolean };

export const footer = {
  lede: "Email, tasks, notes, calendar, contacts and chat in one connected workspace. Close the other nine tabs.",
  product: [
    { label: "Overview", href: "/" },
    { label: "How it connects", href: "/#interlock" },
    { label: "AI and MCP", href: "/ai" },
    { label: "Integrations", href: "/integrations" },
    { label: "Security", href: "/security" },
    { label: "Pricing", href: "/pricing" },
    { label: "Download", href: "/download" },
    { label: "Compare", href: "/compare" },
    { label: "Log in", href: "/login" },
  ] as FooterLink[],
  // Under the modules, in the same cell: who Moduo is for.
  for: [
    { label: "Freelancers", href: "/for/freelancers" },
    { label: "Founders", href: "/for/founders" },
    { label: "Small teams", href: "/for/teams" },
  ] as FooterLink[],
  company: [
    { label: "About us", href: "/about" },
    { label: "Manifesto", href: "/manifesto" },
    { label: "Press kit", href: "/press" },
    { label: "Colophon", href: "/colophon" },
    { label: "Typeface", href: "/typeface" },
    { label: "Changelog", href: "/changelog" },
    { label: "Contact", href: "mailto:hello@moduo.app" },
  ] as FooterLink[],
  resources: [
    { label: "Help center", href: "/help" },
    { label: "Import guide", href: "/import" },
    { label: "MCP docs", href: "/mcp" },
    { label: "Shortcuts", href: "/shortcuts" },
    { label: "Questions", href: "/#faq" },
    { label: "Status" },
  ] as FooterLink[],
  follow: [
    { label: "X", href: "https://x.com/Moduo_App", external: true },
    { label: "LinkedIn", href: "https://www.linkedin.com/company/moduo_app/", external: true },
    { label: "Product Hunt", href: "https://www.producthunt.com/@moduo_app", external: true },
    { label: "Reddit", href: "https://www.reddit.com/user/Moduo_app/", external: true },
    { label: "Instagram", href: "https://www.instagram.com/moduo_app/", external: true },
    { label: "TikTok", href: "https://www.tiktok.com/@moduo_app", external: true },
    { label: "GitHub" },
    { label: "YouTube", href: "https://www.youtube.com/@Moduo_app", external: true },
    { label: "Discord" },
  ] as FooterLink[],
  hello: "Questions, ideas, or a project you’d like to talk through. A person writes back.",
  legend: "Point at the letters. There are two words inside.",
  meaning: {
    mod: "Mod, as in modular. Small blocks you can change, swap or add.",
    duo: "Duo, as in two. You and your tools, and the two of us building it.",
    both: "Mod and duo share the d. Moduo: your work, assembled your way.",
  },
  legal: [
    { label: "Privacy", href: "/privacy" },
    { label: "Terms", href: "/terms" },
    { label: "DPA", href: "/dpa" },
    { label: "Acceptable use", href: "/aup" },
  ],
  copyright: "© 2026 Moduo. All rights reserved.",
  // The credit line: the typeface's name opens its page, the sentence opens the colophon.
  colophon: {
    set: "Set in",
    name: "Oudom",
    rest: "Every shape on this site, the letters included, is one stroke of the Moduo mark.",
  },
} as const;

// ── Module pages ─────────────────────────────────────────────────────────────

export type ModulePage = {
  slug: ModuleSlug;
  name: string;
  title: string;
  description: string;
  line: string;
  lead: string;
  moment: { title: string; text: string };
  features: { title: string; text: string }[];
  keys: { k: string; does: string }[];
  plan?: string;
};

export const modules: Record<ModuleSlug, ModulePage> = {
  email: {
    slug: "email",
    name: "Email",
    title: "Email",
    description:
      "Gmail, iCloud or any IMAP account in Moduo’s desktop app, with the sender’s contact beside every message and one key to turn an email into a task.",
    line: "Your inbox, with the rest of your work beside it.",
    lead: "Connect Gmail, iCloud or any IMAP account in the desktop app. Open a message and the sender’s page sits next to it, with every task, note and call you share.",
    moment: {
      title: "One key turns an email into a task.",
      text: "Press T and the email becomes a task. It keeps the email attached and shows up on the sender’s page, so the follow-up can’t rot in the inbox.",
    },
    features: [
      {
        title: "Every account in one inbox",
        text: "Gmail, iCloud and any provider that supports IMAP, side by side.",
      },
      {
        title: "The sender is already there",
        text: "Moduo matches the address to a contact and shows what’s still open with them.",
      },
      {
        title: "Snooze and follow up",
        text: "Snooze a thread until it matters, or ask to be reminded if nobody replies.",
      },
      {
        title: "Link it to anything",
        text: "Attach a thread to a task, a note or a contact with a drag or a mention.",
      },
      {
        title: "On the web too",
        text: "Email runs in the desktop app on Mac and Windows. The web shows follow-ups, snoozed threads and everything linked to an email.",
      },
    ],
    keys: [
      { k: "T", does: "Turn the open email into a task" },
      { k: "⌘ K", does: "Find a thread, a person or a task" },
    ],
  },
  tasks: {
    slug: "tasks",
    name: "Tasks",
    title: "Tasks",
    description:
      "Lists, a daily plan, habits and focus in Moduo. Capture a bare title from anywhere, commit to a day, and roll unfinished work forward without a wall of red.",
    line: "A plan for today that survives the afternoon.",
    lead: "Lists, a daily plan, habits and focus. Capture a bare title and sort it out later; nothing asks you for a project first.",
    moment: {
      title: "Focus on one thing, and keep the time.",
      text: "Start a focus session on a task. The minutes you spend are recorded on it, so next time you plan, you know what it really takes.",
    },
    features: [
      {
        title: "Capture without a destination",
        text: "⇧⌘K catches a thought from anywhere. A bare title is a whole task.",
      },
      {
        title: "Commit to a day",
        text: "Pick what you’ll do today. Unfinished work rolls forward in one move, never into a wall of red.",
      },
      { title: "Waiting on someone", text: "Mark a task as waiting and see who’s holding it." },
      {
        title: "Repeat without guilt",
        text: "Repeat a task on a schedule and skip a day without breaking it.",
      },
      {
        title: "Hand it over",
        text: "On Duo and Team, assign a task and its email, note and history go with it.",
      },
    ],
    keys: [
      { k: "⇧ ⌘ K", does: "Capture a task from anywhere" },
      { k: "⌘ N", does: "New task where you are" },
    ],
  },
  notes: {
    slug: "notes",
    name: "Notes",
    title: "Notes",
    description:
      "Markdown notes in Moduo that mention people and tasks. A checkbox line becomes a real task, done everywhere when you tick it in the note.",
    line: "Notes that know what they mention.",
    lead: "Write in markdown with a slash menu. Mention a person or a task as you type, and the link is made.",
    moment: {
      title: "A checkbox in a note is a real task.",
      text: "Write a checkbox line and make it a task with ⌘⇧T. Tick it in the note and it’s done in Tasks; reschedule it in Tasks and the note follows.",
    },
    features: [
      {
        title: "Mention anything",
        text: "@ for a person, / for a task, a note or a contact. Every mention is a live chip.",
      },
      {
        title: "Pages inside pages",
        text: "Nest pages, and every page lists the pages inside it at its foot.",
      },
      {
        title: "Capture first, file later",
        text: "A new note opens empty and ready. Where it belongs can wait.",
      },
      { title: "Bring your notes", text: "Import a Notion export or a folder of Markdown files." },
    ],
    keys: [
      { k: "⌘ ⇧ T", does: "Make the checkbox line a task" },
      { k: "/", does: "Link a task, a note or a contact" },
    ],
  },
  calendar: {
    slug: "calendar",
    name: "Calendar",
    title: "Calendar",
    description:
      "Moduo’s calendar puts events and tasks on one grid. Drag a task in to block time, tick it from the block, and roll unfinished blocks forward in one step.",
    line: "Time blocks that finish the work.",
    lead: "Your events and your tasks on one grid. Drag a task onto the week and it becomes a block that still knows it’s a task.",
    moment: {
      title: "Close the loop from the block.",
      text: "Tick a task inside its block. When a block runs out with the task still open, it waits, dashed, for later, longer or remove. Nothing turns red.",
    },
    features: [
      {
        title: "Drag to schedule",
        text: "Drop a task on the week to give it time. The block stays linked to the task.",
      },
      { title: "Roll forward", text: "Move everything unfinished to the next day in one step." },
      {
        title: "Booking pages",
        text: "Share a page where people pick a time. The booking lands on your calendar.",
      },
      {
        title: "Notes on every event",
        text: "Write notes on an event and link them with @ and /.",
      },
      {
        title: "Google Calendar",
        text: "Connect Google Calendar and see your events next to your blocks.",
      },
    ],
    keys: [
      { k: "⌘ K", does: "Find an event or a task" },
      { k: "/", does: "Link a note from an event" },
    ],
  },
  contacts: {
    slug: "contacts",
    name: "Contacts",
    title: "Contacts",
    description:
      "People and companies in Moduo, each with a page that rolls up every linked email, task, note, call and channel. No logging, no pipeline to build.",
    line: "A contact page that fills itself in.",
    lead: "People and companies, each with the whole history of what you’ve done together, and you never log a thing.",
    moment: {
      title: "Open a client, see everything.",
      text: "Emails, tasks, notes, calls and channels linked to a person gather on their page, grouped, each with the line that matters.",
    },
    features: [
      {
        title: "People and companies",
        text: "People belong to companies. Open either one and see both.",
      },
      {
        title: "A status and a next step",
        text: "Give a contact a status and a follow-up task. No pipeline to build.",
      },
      {
        title: "Links that suggest themselves",
        text: "An email from a known address offers to link itself. One tap accepts, and a no is remembered.",
      },
      { title: "Import a CSV", text: "Bring the spreadsheet you’ve been running your clients in." },
    ],
    keys: [
      { k: "@", does: "Mention a contact anywhere you write" },
      { k: "⌘ K", does: "Open anyone’s page" },
    ],
  },
  chat: {
    slug: "chat",
    name: "Chat",
    title: "Chat",
    description:
      "Channels and direct messages in Moduo for Duo and Team, linked to the client or project they’re about, with threads you can wrap up and decisions you can find.",
    line: "Talk next to the work, not in another app.",
    lead: "Channels and direct messages for Duo and Team. Link a channel to a client or a project, and the conversation sits with it.",
    moment: {
      title: "Wrap up a thread.",
      text: "When a reply chain is settled, wrap it up and mark the decision, so it’s findable later without scrolling a week of messages.",
    },
    features: [
      {
        title: "Linked channels",
        text: "A channel can belong to a client, a project or a team, and shows up there.",
      },
      { title: "What needs you", text: "Every message addressed to you, in one place." },
      {
        title: "Decisions stay findable",
        text: "Mark a message as the decision. It’s the first thing anyone sees.",
      },
      { title: "Calls next", text: "Calls are on the way for Duo and Team." },
    ],
    keys: [{ k: "@", does: "Mention a teammate" }],
    plan: "Chat is part of Duo and Team.",
  },
};

export const modulesIndex: { slug: ModuleSlug; name: string; text: string }[] = [
  { slug: "email", name: "Email", text: "Gmail, iCloud or IMAP, in the desktop app." },
  { slug: "tasks", name: "Tasks", text: "Lists, a daily plan, habits and focus." },
  { slug: "notes", name: "Notes", text: "Notes and docs that mention people and tasks." },
  {
    slug: "calendar",
    name: "Calendar",
    text: "Events, booking pages and time blocks for your tasks.",
  },
  { slug: "contacts", name: "Contacts", text: "People and companies, with their whole history." },
  {
    slug: "chat",
    name: "Chat",
    text: "Channels for Duo and Team, linked to clients and projects.",
  },
];

// ── Other pages ──────────────────────────────────────────────────────────────

// ── About: the two of us, according to the coding agent we build with ────────

// Measured from this repository's history on 23 October 2026: commits by each of us, by hour of
// the author's own clock. Merges are left out, and so are rebased copies (a commit counts once
// per author date and message). Re-run the numbers before changing a sentence that quotes them.
export const rhythm = {
  asOf: "16 February to 23 October 2026",
  hours: {
    mike: [
      139, 200, 229, 255, 340, 168, 204, 108, 36, 15, 52, 138, 48, 82, 10, 72, 48, 15, 28, 105, 21,
      61, 75, 115,
    ],
    maciej: [
      68, 106, 100, 88, 64, 23, 11, 19, 3, 0, 11, 27, 45, 57, 119, 75, 107, 131, 65, 66, 92, 73,
      124, 81,
    ],
  },
  days: {
    mike: [371, 620, 122, 330, 859, 656, 3],
    maciej: [97, 238, 251, 443, 319, 167, 77],
  },
  dayNames: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  merges: 1038,
  /** Merge commits by day, as [days since 16 February 2026, merges] for each of us. */
  mergeDays: {
    mike: [
      [9, 1],
      [87, 2],
      [163, 1],
      [167, 1],
      [179, 3],
      [182, 3],
      [214, 6],
      [219, 1],
      [226, 8],
      [227, 35],
      [228, 22],
      [231, 1],
      [232, 30],
      [233, 9],
      [234, 24],
      [235, 9],
      [236, 2],
      [239, 4],
      [240, 4],
      [241, 7],
      [242, 9],
      [243, 31],
      [245, 44],
      [246, 53],
      [247, 2],
      [248, 23],
      [249, 62],
    ],
    maciej: [
      [86, 1],
      [87, 2],
      [110, 2],
      [116, 5],
      [117, 4],
      [118, 1],
      [120, 12],
      [128, 3],
      [129, 3],
      [130, 1],
      [131, 7],
      [132, 3],
      [133, 2],
      [136, 8],
      [137, 8],
      [138, 23],
      [141, 1],
      [142, 2],
      [143, 3],
      [144, 6],
      [145, 27],
      [146, 9],
      [147, 11],
      [154, 1],
      [163, 12],
      [164, 6],
      [179, 4],
      [228, 4],
      [229, 1],
      [232, 1],
      [233, 17],
      [234, 150],
      [235, 18],
      [236, 24],
      [237, 12],
      [239, 36],
      [240, 54],
      [241, 44],
      [242, 92],
      [243, 11],
      [247, 1],
    ],
  },
  /** Days since 16 February 2026 to the 23 October cut-off. */
  span: 249,
  /** The first day of each month, as days since 16 February 2026. */
  months: [
    ["Feb", 0],
    ["Mar", 13],
    ["Apr", 44],
    ["May", 74],
    ["Jun", 105],
    ["Jul", 135],
    ["Aug", 166],
    ["Sep", 197],
    ["Oct", 227],
  ],
} as const;

export const about = {
  title: "About us",
  description:
    "Mike and Maciej as our coding agent reads us from the repository, and how Moduo started: the first commit, the quiet, the night it became a duo.",
  h1: "Mike and Maciej, according to our agent.",
  lead: "We asked the coding agent we build Moduo with what it makes of us, from eight months of commits, pull requests, prompts and arguments inside Moduo. Its answer comes first, then how Moduo started.",
  chart: {
    caption: "Commits by hour of each author's own clock, merges and rebased copies left out.",
    now: "now",
  },
} as const;

// What the agent wrote about each of us, one column each, mirrored on a centre line. The read is
// Claude's (a note Mike shared from the dogfood workspace), rewritten plainly: every line is
// about one person, and `proof` is the evidence from the repository, checked on 23 October 2026.
export const aboutRead = {
  title: "What it wrote about us.",
  intro:
    "Five lines each, with the evidence it pointed to. It calls the whole thing a hypothesis, and says it had less to go on for Maciej.",
  people: {
    mike: {
      name: "Mike",
      role: "Engineering",
      read: [
        {
          text: "Starts before it makes sense to.",
          proof: "First commit, 16 February, almost three months before there was a team",
        },
        { text: "Works in bursts, mostly at night.", proof: "Busiest hour: 04:00, 340 commits" },
        { text: "Decides fast, corrects on the way.", proof: "Shortest commit message: “.”" },
        {
          text: "Builds the tools around the work as much as the work.",
          proof: "Guard rails for the agents, a reviewer for their output, an audit of the setup",
        },
        {
          text: "Wants the plain answer, sources included.",
          proof: "Asks for research checked against primary sources",
        },
      ],
    },
    maciej: {
      name: "Maciej",
      role: "Product and design",
      read: [
        {
          text: "Starts with the rules.",
          proof: "First commit, 11 May: “add design foundation: tokens, ruleset, briefs”",
        },
        {
          text: "Works steadily, afternoons into the night, all week.",
          proof: "77 commits on Sundays",
        },
        {
          text: "Thinks every case through, then builds it once.",
          proof: "45% of commits touch a test",
        },
        {
          text: "Builds for the person who isn't in the room.",
          proof: "“deleting an area can be undone”",
        },
        {
          text: "Keeps it consistent, and keeps it small.",
          proof: "One set of design tokens; 23 screens on their way down to 5 to 7",
        },
      ],
    },
  },
} as const;

// The bridge from the read to the story: the one problem we both had. The lead is set as our
// quote, the rest as our account under it; drafted from our own words on the home page
// (makers.people[].quote), ours to sign off.
export const aboutBridge = {
  lead: "We came at it from opposite ends and ran into the same wall.",
  quote:
    "Maciej had clients, projects, hobbies and ideas spread over too many apps, subscriptions and automations, and spent more time organizing the work than doing it. Mike had startups, hackathons, events and trips to San Francisco, and kept setting up the same tools again before getting to work. Different lives, one problem: mail in one app, tasks in another, notes in a third, and the two of us copying things between them.",
  by: "Mike and Maciej",
} as const;

// How it started, told along the git history. Every date, time, hash and commit message here is
// quoted from the repository (rebased copies counted once); re-check them before changing a line.
export const aboutStory = {
  title: "How it started",
  start: {
    stamp: "Monday, 16 February, 23:01",
    title: "Mike makes the first commit.",
    text: [
      "Then a second one, 28 minutes later. The first is called “Initial commit” and the second “first commit”. By 3:47 a.m. there are notes.",
      "In two weeks there are tasks, forms, widgets, mind maps, mail and a calendar: everything at once, the way you build it when you're tired of paying for it in pieces.",
    ],
    log: [
      ["233db5e", "16 Feb 23:01", "Initial commit"],
      ["25a239a", "16 Feb 23:29", "first commit"],
      ["28c5a55", "17 Feb 01:02", "fresh"],
      ["620deb8", "17 Feb 03:47", "notes"],
      ["c9e8deb", "17 Feb 23:06", "notes,tasks,forms"],
      ["9937c62", "20 Feb 23:26", "."],
      ["613fe86", "25 Feb 19:19", "few widgets+complete endv mindmaps"],
      [
        "8d09f32",
        "26 Feb 00:39",
        "few more widgets; fixed notes UX and UI; mails wired for pre-mvp; …",
      ],
      ["aac1772", "28 Feb 04:17", "tasks and calendar merged into plan ft"],
      ["b81cd01", "18 Mar 01:06", "pre wind build"],
      ["cc99683", "18 Mar 01:26", "fix portable bypass tauri build"],
    ],
  },
  gap: {
    title: "Then the log goes quiet.",
    days: 54,
    unit: "days without a commit",
    text: "From 18 March to 11 May, the repository has nothing to say. Not a fix, not a dot.",
  },
  duo: {
    stamp: "Monday, 11 May",
    title: "Then everything lands at once.",
    text: [
      "At 00:10 Mike pushes one commit that touches 380 files. Its message: “huge push”. The quiet was never idle; the work just hadn't made it into the log.",
      "At 01:46 comes Maciej's first commit, and 31 more follow that day: buttons, dialogs, menus, a whole design system before a single new feature. That's the night Moduo became a duo.",
    ],
    day: "11 May, hour by hour",
    // Each commit that day as [minutes after midnight, message], one list each.
    mike: [
      [10, "huge push"],
      [53, "fixing issues with duplicating the notes - prev it duplicated only metadata"],
    ],
    maciej: [
      [106, "add design foundation: tokens, ruleset, briefs"],
      [115, "number build phases in TASKS.md"],
      [122, "wire design tokens into global.css"],
      [126, "add shadcn/ui config (manual init for rsbuild)"],
      [129, "install design-system font packages"],
      [131, "add useAppearance hook and pre-paint application"],
      [133, "add stylelint with token-discipline rules"],
      [135, "add lint:tw script for arbitrary Tailwind value enforcement"],
      [148, "add Button primitive"],
      [150, "add Input, Textarea, Label primitives"],
      [151, "add Dialog primitive"],
      [152, "add Sheet primitive"],
      [155, "add Dropdown Menu and Context Menu primitives"],
      [156, "add Popover primitive"],
      [158, "add Command palette primitive"],
      [159, "add Tabs primitive"],
      [161, "add Tooltip primitive"],
      [162, "add Toast primitive (Sonner) and mount Toaster at root"],
      [165, "add Switch, Select, RadioGroup primitives"],
      [166, "add Separator, Card, ScrollArea primitives"],
      [168, "add Avatar and Badge primitives"],
      [173, "wire @/src alias into Storybook vite config"],
      [1343, "migrate AppChrome to tokens"],
      [1352, "recompose AppChromeMenus on popover surfaces"],
      [1353, "restyle FeaturePanelsShell and add responsive collapse"],
      [1354, "recompose WorkspaceSwitcher on DropdownMenu and Avatar"],
      [1355, "recompose UserMenu on DropdownMenu and Avatar"],
      [1356, "recompose NotificationCenter on Sheet"],
      [1357, "recompose IntegrationsModal on Dialog"],
      [1358, "recompose WorkspaceSettingsModal on Dialog"],
      [1359, "restyle TagInput with tokens and Badge chips"],
      [1360, "expose Icon size token enum (sm/md/lg)"],
    ],
  },
  since: {
    title: "Since then.",
    text: "4,123 commits between the two of us and 1,038 merges, and Moduo is built inside Moduo: the plan is a project of tasks, the briefs are notes, the arguments happen in chat, and our coding agent works in all of it through the same connector you'll get.",
    today: "today",
  },
} as const;

export const aboutClose = {
  title: "It asked us where it's wrong.",
  text: "You can tell us the same, about it, about us, or about Moduo. A person writes back.",
} as const;

// ── Colophon: the footer's credit line, unfolded ─────────────────────────────

export const colophon = {
  title: "Colophon",
  description:
    "How this site is made, as a printer would tell it: set in Oudom, our own typeface, and every shape drawn from one stroke of the Moduo mark.",
  // The credit line as it stands in the footer; the page reads it word by word.
  line: [
    "Set in Oudom.",
    "Every shape on this site, the letters included, is one stroke of the Moduo mark.",
  ],
  // The opening (components/colophon/Closer.astro): the line set small, as a book's colophon
  // is, then read closer, until one stroke of the d fills the screen.
  closer: {
    kicker: "Colophon",
    cue: "Scroll to read closer",
    // One endless scroll, one camera: from the line to one stroke, stroke by stroke to the mark,
    // on to a chain, down to the blank, back to one and into the line again, where it starts
    // over (components/colophon/Closer.astro, motion/colophon.ts).
    beats: [
      {
        id: "read",
        title: "Read closer.",
        text: "Every letter here is a few strokes, laid one over another.",
      },
      {
        id: "stem",
        title: "Closer still.",
        text: "The stem of the d: two straight sides, its top cut at 45°.",
      },
      {
        id: "one",
        title: "One stroke.",
        text: "Cut its foot the same way and there it is: the middle stroke of our mark, and the only shape this site is drawn with.",
      },
      {
        id: "two",
        title: "Two.",
        text: "Lay a second over it and the overlap cancels into a window. Mod and duo share a d the same way; Maciej and Mike share one product.",
      },
      {
        id: "three",
        title: "Three.",
        text: "A third, and it's our mark. Three is the fewest strokes where one is held on both sides, and the fewest that read as an m.",
      },
      {
        id: "window",
        title: "The window.",
        text: "Nobody drew it. It's what two strokes leave where they meet, and it's the point of the mark: where two parts meet, something opens. On a browser tab we'd sooner thin the strokes than let it close.",
      },
      {
        id: "more",
        title: "More than three.",
        text: "Past three it's never the mark: it's a chain, one stroke for each thing in a row. In the app, the modules. Here, the company pages, and you're on the fourth.",
      },
      {
        id: "blank",
        title: "The blank.",
        text: "Lay one stroke exactly on another and both cancel, leaving only the edge. An outlined mark is on our list of misuses, but nobody draws this one. On the pricing page it means Free. And two set apart open nothing: that's the 404.",
      },
      {
        id: "back",
        title: "And back.",
        text: "Slide the last one on and the blank fills. Odd shows, even cancels: that's the whole rule.",
      },
    ],
  },
} as const;

// ── Oudom: the typeface page (/typeface) ───────────────────────────────────────
// Every number here is read from the font (docs/local/Moduo Joiner/nib, v1.3): 466 glyphs for 377
// characters, 2,043 kerning pairs, stems 64 units wide at Light and 142 at Bold, the 45 degree cuts
// in the mark's own corners (0.2 of the stroke), square corners at 0.3, x-height 520, cap height
// 700, 38 KB as woff2. The name
// and its story are DESIGN.md §16: Moduo read from the far end, the way a compositor reads metal
// type; oud and dom share the same d that mod and duo do.

export const typeface = {
  title: "Oudom, Moduo's typeface",
  description:
    "Oudom, Moduo's typeface: our name read from the far end, as a compositor reads metal type. Every letter is cut from one stroke of the mark.",
  // The page is one specimen sheet read by one camera (DESIGN.md §20; components/typeface/Sheet).
  kicker: "Typeface",
  name: "Oudom",
  lead: "Moduo's own typeface, and our name read from the far end. Every letter in it is cut from one stroke of the mark.",
  spec: ["Version 1.3", "Light 300 to Bold 700", "466 glyphs", "Say it oo-dom"],
  cue: "Scroll to read the sheet",
  // The scene's words, one beat at a time at the stage's foot.
  beats: [
    {
      id: "turn",
      title: "From the far end.",
      text: "Metal type is cast backwards, so a compositor reads a line from its far end, where every d looks like a b. Read oudom that way and it's moduo, our name.",
    },
    {
      id: "rule",
      title: "Oud and dom.",
      text: "Oud is Arabic for wood, and that wood gave the lute its name. Dom is Polish for home. The two words share one d, the way mod and duo do.",
    },
    {
      id: "weights",
      title: "Light to Bold.",
      text: "Our home page's first line, run from Light to Bold and set down at every hundred on the way. Two drawings made from the same strokes, and every weight between them, in one file of 38 KB.",
    },
    {
      id: "kreska",
      title: "Polish first.",
      text: "The line holds all nine Polish letters. The mark over ś, ć, ź, ń and ó is a kreska, Polish for stroke, and it isn't an acute: Adam Twardoch's guide sets it steeper and further right. In Oudom it's the mark's stroke at the size of an accent.",
      link: {
        text: "Adam Twardoch's guide",
        href: "https://www.twardoch.com/download/polishhowto/kreska.html",
      },
    },
    {
      id: "figures",
      title: "Figures that keep time.",
      text: "Your time, now. Tabular figures keep one width, so a running clock never shifts, and the colon rises to sit level with them.",
    },
    {
      id: "set",
      title: "466 glyphs.",
      text: "Every character among them, one at a time, as it was drawn: the points, the handles that bend each curve, the strokes laid over one another. Kerned in 2,043 pairs, and set on this site only; it isn't licensed for download.",
    },
  ],
  // On the sheet: the two words under the name, the home page's line at five weights, the
  // pangram, the glyph's readout, the imprint. At the end the scene is a poster: its head of facts
  // over the name, the lockup and the imprint at its foot.
  halves: ["wood, in Arabic", "home, in Polish"],
  line: "Your space to think, dream and build.",
  poster: {
    head: [
      ["Oudom", "Typeface", "© 2026 Moduo"],
      ["Version 1.3", "466 glyphs", "2,043 kerning pairs"],
      ["Light 300", "Bold 700", "38 KB"],
    ],
  },
  pangram: "Zażółć gęślą jaźń",
  // Beside the clock: numbers the app shows.
  numbers: [
    "9:12 Maciej emailed you",
    "$12 a month, $10 yearly",
    "Mon 2 Nov, 11:00 to 11:45",
    "4,123 commits",
  ],
  imprint: ["Oudom 1.3 · 3 November 2026", "Drawn by Mike Grochowski"],
  // The sheet as a still figure (reduced motion, no script).
  still:
    "The specimen sheet: the Polish pangram, the time in tabular figures, every character Oudom draws, and the g drawn with its points and handles.",
} as const;

export const notFound = {
  title: "Nothing links here.",
  text: "This page doesn’t exist, or it moved. These two pieces don’t touch, so nothing opens between them.",
  home: "Back to the home page",
} as const;

// The login page (pages/login.astro). The words are the app's own sign-in screen's
// (apps/app/src/components/auth/email-auth-panel.tsx), so the two read as one step; the form
// hands the address to app.moduo.app, where the code is sent and the session lives.
export const login = {
  description:
    "Log in to Moduo, or create your account with the address your invite went to. We email you a six-digit code.",
  // The header's and the menu's way in.
  link: "Log in",
  title: "Log in or create account",
  sub: "We’ll email you a secure code to continue.",
  label: "Email address",
  placeholder: "you@example.com",
  button: "Continue with email",
  note: "You continue at app.moduo.app. New accounts need an invite for now.",
  going: "Opening app.moduo.app",
  errors: {
    empty: "Enter your email address.",
    invalid: "That email doesn’t look right. Check it and try again.",
  },
  ask: "No invite yet?",
  specimen: "Moduo’s mark as a solid, set in a grid of type and turning slowly.",
  legal: [
    { label: "Home", href: "/" },
    { label: "Terms", href: "/terms" },
    { label: "Privacy", href: "/privacy" },
    { label: "Security", href: "/security" },
    { label: "Help center", href: "/help" },
  ],
} as const;

export const consent = {
  title: "Can we count your visit?",
  text: "A cookie and anonymous session recordings show us how the site is used. Never ad networks.",
  more: "Privacy policy",
  decline: "Decline",
  accept: "Accept",
  settings: "Cookie settings",
} as const;

// ── Manifesto (the founders' text from apps/landing/manifesto.html; the dropped overclaim,
// brand decision 61, is left out) ─────────────────────────────────────────────────────────

export const manifesto = {
  title: "Every app you need. None you don’t.",
  intro: [
    "You open the computer to finish an hour. The tools around that hour are a row of apps that never meet, or one suite with the whole product switched on. The screen stops being the work.",
    "Moduo is a modular workspace. One home. Only the page in front of you. Everything else connected, and out of the room.",
  ],
  sections: [
    {
      title: "Open on the work.",
      text: [
        "Home is a grid, and it is already enough to start. Today’s tasks, which you finish on the tile. What’s left on the calendar. A line you can capture. The time. You don’t build a system. You just work.",
      ],
    },
    {
      title: "The page is the switch.",
      text: [
        "Add a widget. Choose its size. It takes the first open slot. Drag it, resize it, take it off. When the page is full, the next widget starts another page.",
        "The page you are on is the hour. The other pages wait. Every workspace keeps its own board.",
      ],
    },
    {
      title: "Go further only when the tile runs out.",
      text: [
        "Notes, tasks, calendar, email, contacts, and chat sit one click past the widget. The row opens the exact thing. The small act stays on Home. The module is for the rest of it. Then you are back on the same board.",
      ],
    },
    {
      title: "A link happens while you work.",
      text: [
        "Drag one thing onto another. Mention it as you write. Moduo offers one suggestion. Accept it, or dismiss it and it stays dismissed. No tagging.",
        "The link shows up on Home, and either end opens. A module can be closed. The work still knows itself.",
      ],
    },
    {
      title: "Your AI sees what you allow.",
      text: [
        "Plug in Claude, ChatGPT, Cursor, or any assistant. It can search, link, and act across the workspace, tool by tool, with your permission. The hour stays yours.",
      ],
    },
    {
      title: "Leave with everything.",
      text: [
        "Free to start. Turn on what this workspace needs today. Add the rest when the work asks for it. If you go, your data goes with you.",
      ],
    },
  ],
  end: "Close the other tabs.",
} as const;
