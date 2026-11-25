// The "Moduo for" pages (/for/freelancers, /for/founders, /for/teams): who each is for, one
// working day told as six moments, what it replaces, the plan that fits, and a few questions.
//
// Every moment is shipped behavior (checked against the app on 27 October 2026): T turns an email
// or a chat message into a task, a task dragged onto the calendar becomes a block that is still
// the task, focus sessions keep their minutes on the task, a block that runs out asks Later,
// Longer or Remove, booking pages need no account from the guest (Google Meet), / links a note
// from an event, ⌘⇧T makes a note's checkbox line a task, an assigned task carries its email, note
// and history, a channel links to a project, a company or a contact, threads wrap up with the
// decision marked, MCP keys are set per module and their changes are attributed, roles are Owner,
// Admin, Member, Viewer or custom, built module by module. The cast is Moduo's own (story bible,
// 3 November 2026): Mike Grochowski (MI) and Maciej Grzywacz (MA) building Moduo in Moduo, plus
// You (YO) as the reader; demo content, never customers. Freelancers: Moduo is your client.
// Founders: you're in Mike's seat. Teams: you join Moduo's two as a copywriter.
import type { PageSlug } from "../pages";

/** A mention inside a line of text: "{@Maciej Grzywacz}" renders as the app's mention chip. */
export type Rich = string;

export type Pic =
  | {
      kind: "mail";
      from: string;
      initials: string;
      time: string;
      subject: string;
      body: string;
      task: string;
      due: string;
    }
  | {
      kind: "week";
      day: string;
      /** at: hours after 9:00; len: hours. A "late" block ran out and asks what next. */
      slots: {
        t: string;
        at: number;
        len: number;
        kind: "event" | "block" | "late";
        meta: string;
      }[];
      now: number;
    }
  | {
      kind: "focus";
      task: string;
      project: string;
      clock: number;
      est: string;
      sessions: [string, string][];
      total: string;
    }
  | {
      kind: "booking";
      url: string;
      host: string;
      title: string;
      days: [string, string][];
      day: number;
      times: string[];
      time: number;
      guest: string;
      when: string;
    }
  | {
      kind: "note";
      crumb: [string, string];
      title: string;
      text: Rich;
      lines: { t: Rich; due?: string; done?: boolean }[];
    }
  | {
      kind: "contact";
      name: string;
      initials: string;
      sub: string;
      rows: {
        cap: string;
        icon: "mail" | "circle-check" | "file-text" | "calendar" | "message-square";
        t: string;
        rel: string;
      }[];
    }
  | {
      kind: "home";
      tasks: { t: string; m: string; c: string }[];
      day: { t: string; m: string }[];
      catchup: { who: string; initials: string; c: string; time: string; text: string };
    }
  | {
      kind: "assign";
      task: string;
      project: string;
      due: string;
      from: { icon: "mail" | "message-square"; t: string; rel: string };
      people: { name: string; initials: string; c: string; on?: boolean }[];
    }
  | {
      kind: "channel";
      name: string;
      linked: string;
      msgs: {
        who: string;
        initials: string;
        c: string;
        time: string;
        text: string;
        task?: boolean;
        decision?: boolean;
      }[];
      wrapped?: string;
    }
  | {
      kind: "key";
      name: string;
      client: string;
      levels: [string, 0 | 1 | 2][];
      expires: string;
    }
  | {
      kind: "roles";
      members: { name: string; initials: string; c: string; role: string; on?: boolean }[];
      levels: [string, 0 | 1 | 2][];
    };

export type Moment = {
  time: string;
  /** Where in Moduo it happens: the picture's caption. */
  where: string;
  /** The gesture that joins this moment to the one before (none on the first). */
  joint?: { key: string; text: string };
  title: string;
  /** "[⌘ ⇧ T]" in the text renders as a keycap. */
  text: string;
  pic: Pic;
};

export type UseCase = {
  slug: "freelancers" | "founders" | "teams";
  page: PageSlug;
  title: string;
  description: string;
  crumb: string;
  name: string;
  line: string;
  lead: string;
  plan: "pro" | "duo" | "team";
  planNote: string;
  day: { title: string; text: string; moments: Moment[] };
  juggle: { title: string; text: string; rows: { was: string; now: string }[] };
  fit: { title: string; text: string };
  questions: { q: string; a: string }[];
  related: { title: string; slugs: PageSlug[] };
};

const blue = "var(--ap-blue)";
const green = "var(--ap-green)";
const amber = "var(--ap-amber)";
const teal = "var(--ap-teal)";
const violet = "var(--ap-violet)";
const pink = "var(--ap-pink)";

export const usecases: UseCase[] = [
  {
    slug: "freelancers",
    page: "freelancers",
    title: "Moduo for freelancers: every client in one window",
    description:
      "Moduo gives freelancers one window for client email, tasks, notes, calls and bookings, each filed on the client’s page, and a focus timer that keeps the hours.",
    crumb: "For freelancers",
    name: "Freelancers",
    line: "Every client, filed by who it’s for.",
    lead: "You’re the studio, the sales team and the back office. Moduo keeps each client’s email, tasks, notes and calls on one page, so changing clients takes one click, not ten tabs.",
    plan: "pro",
    planNote: "Free to start. Pro is $12 a month, or $10 billed yearly.",
    day: {
      title: "A Thursday, client by client.",
      text: "Six moments from one working day, and the one gesture that joins each to the next.",
      moments: [
        {
          time: "9:12",
          where: "Email",
          title: "Maciej’s email becomes the task.",
          text: "Maciej at Moduo wants three spot drawings for the alpha invite by Friday. Press [T] on his email and it’s a task, due Friday, with the email attached. The follow-up is on your list now, not buried in the inbox.",
          pic: {
            kind: "mail",
            from: "Maciej Grzywacz",
            initials: "MA",
            time: "9:12",
            subject: "Alpha drawings",
            body: "The open alpha invite needs three spot drawings. Could you send first drafts by Friday?",
            task: "Send Maciej the drawings",
            due: "Fri",
          },
        },
        {
          time: "9:20",
          where: "Calendar",
          joint: { key: "Drag", text: "onto the week" },
          title: "The task takes the afternoon.",
          text: "Drag it onto Thursday at 13:00. The block on your calendar is still the task, so ticking one ticks the other, and the morning stays free for other clients.",
          pic: {
            kind: "week",
            day: "Thu 5",
            now: 0.35,
            slots: [
              { t: "Weekly planning", at: 1, len: 0.75, kind: "event", meta: "10:00" },
              { t: "Send Maciej the drawings", at: 4, len: 2, kind: "block", meta: "13:00" },
              {
                t: "Brief call",
                at: 6.5,
                len: 0.75,
                kind: "event",
                meta: "15:30 · Maciej Grzywacz",
              },
            ],
          },
        },
        {
          time: "13:00",
          where: "Tasks",
          joint: { key: "Focus", text: "from the block" },
          title: "Focus, and the hours keep themselves.",
          text: "Start a focus session from the block. The minutes land on the task, so the next time Moduo asks for drawings, you quote what they really took.",
          pic: {
            kind: "focus",
            task: "Send Maciej the drawings",
            project: "Moduo",
            clock: 3121,
            est: "of ~1h",
            sessions: [
              ["9:40", "45m"],
              ["10:40", "38m"],
              ["Now", "52m"],
            ],
            total: "2h 15m",
          },
        },
        {
          time: "15:30",
          where: "Booking page",
          joint: { key: "Link", text: "your booking page" },
          title: "Your client books himself in.",
          text: "Maciej picked a slot on your booking page to talk through the brief. Guests don’t need an account. The call is on your calendar, with a Google Meet link waiting.",
          pic: {
            kind: "booking",
            url: "moduo.app/book/your-studio",
            host: "Your studio",
            title: "Brief call · 30 min",
            days: [
              ["Wed", "4"],
              ["Thu", "5"],
              ["Fri", "6"],
              ["Mon", "9"],
            ],
            day: 1,
            times: ["11:00", "14:00", "15:30", "16:30"],
            time: 2,
            guest: "Maciej Grzywacz",
            when: "Thu 5 Nov, 15:30",
          },
        },
        {
          time: "16:05",
          where: "Notes",
          joint: { key: "/", text: "links the note" },
          title: "The call’s notes stay with the call.",
          text: "Type [/] in the event to link a fresh note. Write down what Maciej needs, then turn the promise into a task with [⌘ ⇧ T]. Send the sketches, tick it, and both places agree.",
          pic: {
            kind: "note",
            crumb: ["Moduo", "Brief call"],
            title: "Brief call",
            text: "{@Maciej Grzywacz} wants three spots that sit with Oudom. Two rounds, one send date.",
            lines: [
              { t: "Send Maciej three sketches", due: "Fri" },
              { t: "Share three past drawings" },
              { t: "Ask which sizes the email needs", done: true },
            ],
          },
        },
        {
          time: "18:10",
          where: "Contacts",
          joint: { key: "@", text: "files it on the client" },
          title: "Each client’s page fills itself in.",
          text: "Open Maciej’s page: his email, the drawings task, the brief call and every note that mentions him, each with how it links to him. Every other client’s page works the same way. You filed none of it.",
          pic: {
            kind: "contact",
            name: "Maciej Grzywacz",
            initials: "MA",
            sub: "Co-founder, design · Moduo",
            rows: [
              { cap: "Emails", icon: "mail", t: "Alpha drawings", rel: "From" },
              {
                cap: "Tasks",
                icon: "circle-check",
                t: "Send Maciej the drawings",
                rel: "Created from",
              },
              { cap: "Events", icon: "calendar", t: "Brief call · Thu 15:30", rel: "Attendee" },
              { cap: "Notes", icon: "file-text", t: "Brief call", rel: "Mentions" },
            ],
          },
        },
      ],
    },
    juggle: {
      title: "What you stop juggling.",
      text: "The apps a one-person business collects, and what does that job in Moduo.",
      rows: [
        {
          was: "A mail app and a client list",
          now: "Email in the desktop app, with the sender’s page beside every message.",
        },
        {
          was: "A to-do app and a planner",
          now: "Tasks you drag onto the week, kept as tasks on the calendar.",
        },
        { was: "A time tracker", now: "Focus sessions that write their minutes onto the task." },
        { was: "A scheduling link", now: "Booking pages that land the call on your calendar." },
        {
          was: "A notes app",
          now: "Notes linked to the call they came from, with real tasks inside.",
        },
      ],
    },
    fit: {
      title: "Pro is built for one person with many clients.",
      text: "Start free, with tasks, notes, calendar, email and contacts already linked. Pro adds unlimited workspaces and email accounts when the clients add up.",
    },
    questions: [
      {
        q: "Can I keep my clients apart?",
        a: "Each client has a page that gathers what’s linked to them, so their work never mixes on screen. If you want a harder line, Pro gives you unlimited workspaces, and a long contract can have its own.",
      },
      {
        q: "Do clients need Moduo to book a call?",
        a: "No. Your booking page works for anyone with a browser. They pick a time, answer the questions you set, and the call lands on your calendar.",
      },
      {
        q: "Can I see how long the work took?",
        a: "Every focus session is kept on its task, so the hours sit with the work they went into. Moduo doesn’t send invoices; export a task view as CSV and take the numbers to yours.",
      },
    ],
    related: { title: "When it’s more than you.", slugs: ["founders", "teams", "pricing"] },
  },

  {
    slug: "founders",
    page: "founders",
    title: "Moduo for founders: the company in one window",
    description:
      "Moduo for two co-founders: customers, hiring, the plan and every decision in one shared workspace, with tasks you hand over and chat linked to each customer.",
    crumb: "For founders",
    name: "Founders",
    line: "Two founders. One window for the company.",
    lead: "Customers, hiring and the plan usually live in six apps and two heads. Duo gives the two of you one workspace, where every email, task and decision links to the customer it’s about.",
    plan: "duo",
    planNote: "Duo is $20 a month for both of you, or $16 billed yearly.",
    day: {
      title: "Our Tuesday, between the two of us.",
      text: "One day of Moduo’s two founders, building Moduo in Moduo. You’re in Mike’s seat.",
      moments: [
        {
          time: "8:40",
          where: "Home",
          title: "The morning opens on what changed.",
          text: "Home shows today’s tasks, the calendar and Catch up, where Maciej’s late messages wait. One of them asks you a question; the rest can wait until the coffee.",
          pic: {
            kind: "home",
            tasks: [
              { t: "Pick the first wave", m: "Today", c: blue },
              { t: "Write the 1.4.1 notes", m: "Today", c: amber },
              { t: "Renew moduo.app", m: "Fri", c: green },
            ],
            day: [
              { t: "Founders’ sync", m: "9:30" },
              { t: "Tasks v2 design review", m: "14:00" },
            ],
            catchup: {
              who: "Maciej Grzywacz",
              initials: "MA",
              c: violet,
              time: "23:48",
              text: "Can you check the invite links before we pick the wave?",
            },
          },
        },
        {
          time: "10:15",
          where: "Notes",
          joint: { key: "@", text: "brings Maciej in" },
          title: "The release notes get a second pair of eyes.",
          text: "You draft the 1.4.1 release notes as a note and mention Maciej on the images line. One note with both of you in it, instead of two drafts drifting apart. The line that says ship it by Friday becomes a task with [⌘ ⇧ T].",
          pic: {
            kind: "note",
            crumb: ["Release", "Release 1.4.1"],
            title: "Release 1.4.1",
            text: "Mail sync fixes, a steadier Windows build. Screenshots from {@Maciej Grzywacz}.",
            lines: [
              { t: "Ship 1.4.1", due: "Fri" },
              { t: "Update the changelog" },
              { t: "Test the Windows build", done: true },
            ],
          },
        },
        {
          time: "11:30",
          where: "Tasks",
          joint: { key: "T", text: "turns the ask into work" },
          title: "A tester asks. Maciej gets the whole story.",
          text: "An alpha tester reports that onboarding skips the invite step. [T] turns the feedback email into a task, and you assign it to Maciej. The email and its history go along, so nobody forwards anything.",
          pic: {
            kind: "assign",
            task: "Fix the onboarding invite step",
            project: "Closed alpha",
            due: "Mon",
            from: { icon: "mail", t: "Onboarding skips a step", rel: "Created from" },
            people: [
              { name: "Mike Grochowski", initials: "MI", c: pink },
              { name: "Maciej Grzywacz", initials: "MA", c: violet, on: true },
            ],
          },
        },
        {
          time: "14:40",
          where: "Chat",
          joint: { key: "Link", text: "the channel to the project" },
          title: "The first-wave debate ends in a decision.",
          text: "The #open-alpha channel is linked to the Open alpha project, so the thread sits with it. Once you agree, wrap it up and mark the answer. In three months, neither of you scrolls back to find it.",
          pic: {
            kind: "channel",
            name: "open-alpha",
            linked: "Open alpha",
            msgs: [
              {
                who: "Maciej Grzywacz",
                initials: "MA",
                c: violet,
                time: "14:31",
                text: "The whole waitlist on the 16th, or a small first wave?",
              },
              {
                who: "Mike Grochowski",
                initials: "MI",
                c: pink,
                time: "14:38",
                text: "Forty on the 16th, then a wave a week. We read the feedback each Friday.",
                decision: true,
              },
            ],
            wrapped: "4 replies",
          },
        },
        {
          time: "17:20",
          where: "AI",
          joint: { key: "Key", text: "sets what it can reach" },
          title: "The changelog starts as a draft.",
          text: "Your assistant connects on a key that can read Tasks and Chat and write Notes, and nothing else. Ask for this week’s changelog and the draft lands as a note, with its history saying which key wrote it.",
          pic: {
            kind: "key",
            name: "Changelog draft",
            client: "Claude",
            levels: [
              ["Tasks", 1],
              ["Notes", 2],
              ["Calendar", 0],
              ["Email", 0],
              ["Contacts", 0],
              ["Chat", 1],
            ],
            expires: "90 days",
          },
        },
        {
          time: "18:30",
          where: "Contacts",
          joint: { key: "@", text: "keeps it with Maciej" },
          title: "Maciej’s page tells the whole week.",
          text: "Maciej’s page holds his invite email, the task it became, the channel you share and the release note. When one of you is on a flight, the other opens one page and is caught up.",
          pic: {
            kind: "contact",
            name: "Maciej Grzywacz",
            initials: "MA",
            sub: "Co-founder, design · Moduo",
            rows: [
              { cap: "Emails", icon: "mail", t: "Open alpha invite", rel: "From" },
              {
                cap: "Tasks",
                icon: "circle-check",
                t: "Review the open alpha invite",
                rel: "Created from",
              },
              { cap: "Channels", icon: "message-square", t: "open-alpha", rel: "Conversation" },
              { cap: "Notes", icon: "file-text", t: "Release 1.4.1", rel: "Mentions" },
            ],
          },
        },
      ],
    },
    juggle: {
      title: "What you stop keeping in sync.",
      text: "The tools two founders pick up in the first year, and where that work goes instead.",
      rows: [
        {
          was: "Team chat",
          now: "Channels that belong to a customer, with decisions you can find.",
        },
        {
          was: "A CRM nobody updates",
          now: "Contact pages that fill in from your email, tasks, notes and calls.",
        },
        {
          was: "A project tracker",
          now: "Tasks you assign with their email and history attached.",
        },
        { was: "A docs tool", now: "Notes with mentions, and checkbox lines that are real tasks." },
        {
          was: "An AI that sees everything",
          now: "Keys that reach only the modules you pick, and log what they change.",
        },
      ],
    },
    fit: {
      title: "Duo is priced for exactly two.",
      text: "Pro for both of you, plus what two people need together: shared workspaces, assigning and mentions, and chat. Calls are on the way.",
    },
    questions: [
      {
        q: "Why Duo and not two Pro plans?",
        a: "Duo is Pro for both of you, plus shared workspaces, assigning, mentions and chat, for $20 a month or $16 billed yearly. Two Pro plans would cost more and couldn’t share a workspace.",
      },
      {
        q: "What happens when we hire?",
        a: "Move to Team. It starts at three seats and adds roles, permissions and admin controls, and your workspace and everything in it stays as it is.",
      },
      {
        q: "Can each of us keep private work?",
        a: "Yes. Duo includes unlimited workspaces for each of you, so keep a private one beside the company’s shared workspace.",
      },
    ],
    related: {
      title: "Before and after the two of you.",
      slugs: ["freelancers", "teams", "compare"],
    },
  },

  {
    slug: "teams",
    page: "teams",
    title: "Moduo for small teams: shared work, one window",
    description:
      "Moduo for teams of three or more: a channel for every client, tasks that carry their history when you hand them over, and roles that fit who does what.",
    crumb: "For small teams",
    name: "Small teams",
    line: "Shared work, without the shared mess.",
    lead: "A studio of five shouldn’t need a project tool, a chat app, a CRM and a wiki to know who’s doing what. In Moduo the team works in one workspace, and every thread, task and note links to the client it’s for.",
    plan: "team",
    planNote: "Team is $12 a seat a month, billed yearly, from three seats.",
    day: {
      title: "A Monday in the Moduo workspace.",
      text: "One project, two founders, and every hand-off kept where the next person will look.",
      moments: [
        {
          time: "9:05",
          where: "Chat",
          title: "Feedback lands in the project’s channel.",
          text: "The first alpha feedback goes to the #open-alpha channel, so it sits with the project instead of in someone’s inbox. Maciej reads it over his first coffee.",
          pic: {
            kind: "channel",
            name: "open-alpha",
            linked: "Open alpha",
            msgs: [
              {
                who: "Mike Grochowski",
                initials: "MI",
                c: pink,
                time: "9:02",
                text: "The first alpha feedback is in. The big one: onboarding feels too long.",
              },
              {
                who: "Maciej Grzywacz",
                initials: "MA",
                c: violet,
                time: "9:05",
                text: "Agreed. I’ll redraw the first run this week.",
                task: true,
              },
            ],
          },
        },
        {
          time: "9:25",
          where: "Tasks",
          joint: { key: "T", text: "on the message" },
          title: "The message becomes Maciej’s task.",
          text: "Press [T] on the message to make it a task, and assign it to Maciej. The message, the thread and who asked travel with it, so he starts with the whole story, not a one-line ticket.",
          pic: {
            kind: "assign",
            task: "Redraw the onboarding flow",
            project: "Open alpha",
            due: "Wed",
            from: {
              icon: "message-square",
              t: "Agreed. I’ll redraw the first run…",
              rel: "Created from",
            },
            people: [
              { name: "Mike Grochowski", initials: "MI", c: pink },
              { name: "Maciej Grzywacz", initials: "MA", c: violet, on: true },
            ],
          },
        },
        {
          time: "13:00",
          where: "Calendar",
          joint: { key: "Drag", text: "into his afternoon" },
          title: "Maciej gives it the afternoon.",
          text: "He drags the task onto Monday. When the block runs out before the redraw is done, it asks: later, longer or remove. Nothing turns red, and nothing slips off the plan.",
          pic: {
            kind: "week",
            day: "Mon 2",
            now: 6.1,
            slots: [
              { t: "Founders’ sync", at: 0, len: 0.75, kind: "event", meta: "9:00" },
              {
                t: "Oudom review",
                at: 1.5,
                len: 1,
                kind: "event",
                meta: "10:30 · Mike Grochowski",
              },
              { t: "Redraw the onboarding flow", at: 4, len: 2, kind: "late", meta: "13:00" },
            ],
          },
        },
        {
          time: "14:30",
          where: "Notes",
          joint: { key: "/", text: "from the alpha call" },
          title: "The alpha checklist lives in one note.",
          text: "Mike keeps the open alpha plan in the project note and mentions Maciej where the drawings come in. The lines he makes tasks with [⌘ ⇧ T] show up in Tasks, and tick off in both places.",
          pic: {
            kind: "note",
            crumb: ["Open alpha", "Open alpha plan"],
            title: "Open alpha plan",
            text: "Opens on the 16th. Drawings from {@Maciej Grzywacz} by the 12th, then the invite.",
            lines: [
              { t: "Approve the invite drawings", due: "Nov 13" },
              { t: "Ship 1.4.1 before the invite", due: "Fri" },
              { t: "Freeze the invite copy", done: true },
            ],
          },
        },
        {
          time: "15:15",
          where: "Settings",
          joint: { key: "Role", text: "for the new person" },
          title: "A copywriter joins with the right reach.",
          text: "You join for the open alpha with a role built for the job: you edit Notes, see Tasks and stay out of Chat. Admin, Member and Viewer cover most people; custom roles cover the rest, module by module.",
          pic: {
            kind: "roles",
            members: [
              { name: "Mike Grochowski", initials: "MI", c: pink, role: "Owner" },
              { name: "Maciej Grzywacz", initials: "MA", c: violet, role: "Admin" },
              { name: "You", initials: "YO", c: amber, role: "Copywriter", on: true },
            ],
            levels: [
              ["Tasks", 1],
              ["Notes", 2],
              ["Calendar", 1],
              ["Contacts", 0],
              ["Chat", 0],
            ],
          },
        },
        {
          time: "17:45",
          where: "Contacts",
          joint: { key: "@", text: "files it on Maciej" },
          title: "Maciej’s page shows what the team did.",
          text: "The channel, the task from his message, the alpha plan and the review he’s in all gather on Maciej’s page, whoever made them. Anyone back from a day off opens one page and knows where things stand.",
          pic: {
            kind: "contact",
            name: "Maciej Grzywacz",
            initials: "MA",
            sub: "Co-founder, design · Moduo",
            rows: [
              { cap: "Channels", icon: "message-square", t: "open-alpha", rel: "Conversation" },
              {
                cap: "Tasks",
                icon: "circle-check",
                t: "Redraw the onboarding flow",
                rel: "Created from",
              },
              { cap: "Notes", icon: "file-text", t: "Open alpha plan", rel: "Mentions" },
              { cap: "Events", icon: "calendar", t: "Oudom review · Mon 10:30", rel: "Attendee" },
            ],
          },
        },
      ],
    },
    juggle: {
      title: "What the team stops switching between.",
      text: "The stack a small studio grows by its second year, and the one window that does each part.",
      rows: [
        {
          was: "Team chat",
          now: "A channel per client, with threads wrapped up and the decision marked.",
        },
        {
          was: "A project tracker",
          now: "Tasks that carry their message, email and history to whoever picks them up.",
        },
        {
          was: "A shared CRM",
          now: "Client pages that gather what everyone linked, without a form to fill.",
        },
        {
          was: "A wiki",
          now: "Project notes with real tasks inside and mentions of the people involved.",
        },
        { was: "An admin console", now: "Roles set module by module, from Viewer up to Owner." },
      ],
    },
    fit: {
      title: "Team grows a seat at a time.",
      text: "Everything in Duo for three people or more, with roles, permissions and admin controls. No minimum beyond three seats.",
    },
    questions: [
      {
        q: "How many seats do we need?",
        a: "Three or more. Team is priced per seat with no minimum beyond that, so a studio of five pays for five.",
      },
      {
        q: "Can some work stay private?",
        a: "Yes. Roles set what each person can see and change, module by module, and anyone can keep a private workspace of their own.",
      },
      {
        q: "Can people outside the team book time with us?",
        a: "Yes. Each of you can share a booking page. Whoever books needs no account, and the call lands on that person’s calendar.",
      },
    ],
    related: { title: "Smaller, for now?", slugs: ["freelancers", "founders", "pricing"] },
  },
];
