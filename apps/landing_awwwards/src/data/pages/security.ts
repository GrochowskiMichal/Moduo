// /security: where your work is kept, who can reach it, and how you take it back. Every line here
// is true of the code that runs Moduo on 27 October 2026 (the database's region, sign-in, the
// keychain, the access rules and their tests, key storage, signing) or quotes the published
// privacy policy and DPA (apps/landing/privacy.html, dpa.html). What isn't built yet is said so.

export const security = {
  title: "Security: where your work lives",
  description:
    "How Moduo keeps your work: mail that stays on your computer, sign-in without passwords, access rules tested on every change, and storage in London.",
  name: "Security",
  line: "Know where every piece of your work lives.",
  lead: "Your mail stays between your computer and your provider. Everything else is stored in London, behind access rules we test on every change.",
  cta: { policy: "Read the privacy policy" },

  map: {
    title: "Follow one thing through Moduo.",
    text: "Four places hold your work. Pick one thing and follow it: what crosses between them, and what never does.",
    follow: "Follow",
    places: [
      {
        id: "mail",
        name: "Your mail provider",
        sub: "Gmail, iCloud or any IMAP server",
        holds: ["Your mailbox, where it already is"],
      },
      {
        id: "computer",
        name: "Your computer",
        sub: "The Moduo desktop app",
        holds: [
          "Your mail and its attachments",
          "Mail passwords and sign-in tokens, in the system keychain",
          "Your Moduo session, in the keychain too",
        ],
      },
      {
        id: "moduo",
        name: "Moduo, London",
        sub: "Stored in London, UK",
        holds: [
          "Tasks, notes, calendar, contacts, chat and the links between them",
          "Of your mail, only the threads you act on",
        ],
      },
      {
        id: "assistant",
        name: "Your assistant",
        sub: "Claude, ChatGPT or Claude Code",
        holds: ["Nothing until you connect it, then only what its key allows"],
      },
    ],
    // Between place k and place k + 1.
    wires: [
      { id: "mail-computer", cross: "Your mail, both ways", how: "Encrypted on the way (TLS)" },
      {
        id: "computer-moduo",
        cross: "Your work, over HTTPS",
        how: "Of a thread you act on: sender, subject, a snippet, the date",
      },
      {
        id: "moduo-assistant",
        cross: "What its key allows, module by module",
        how: "Each change it makes carries its name",
      },
    ],
    never: {
      label: "Never connected",
      text: "Moduo’s servers never connect to your mailbox.",
    },
    things: [
      {
        id: "email",
        name: "An email from Maciej",
        text: "Maciej Grzywacz’s email lands in your mailbox and comes down to your computer over an encrypted connection. It stays there. Turn it into a task and Moduo keeps a short record of the thread beside it: sender, subject, a snippet, the date. The email itself, never.",
        places: ["mail", "computer", "moduo"],
        wires: ["mail-computer", "computer-moduo"],
      },
      {
        id: "task",
        name: "The task it became",
        text: "The task lives once, in London. Every read and every change is checked where the data lives: is this your workspace, and does your role allow it. Your teammates’ apps answer to the same rules.",
        places: ["computer", "moduo"],
        wires: ["computer-moduo"],
      },
      {
        id: "key",
        name: "Your assistant’s question",
        text: "Claude asks what’s due this week. Moduo checks its key on every request: not revoked, not expired, allowed to view Tasks, and never more than the person who made it can open. If it changes something, the activity says it was done via Claude.",
        places: ["assistant", "moduo"],
        wires: ["moduo-assistant"],
      },
    ],
  },

  controls: {
    title: "What keeps it there.",
    text: "Each of these is in the code that runs Moduo today.",
    items: [
      {
        id: "code",
        title: "No passwords",
        text: "You sign in with a one-time code sent to your email. It expires after ten minutes, and Moduo accounts have no password at all, so there’s none to leak or reuse.",
      },
      {
        id: "rows",
        title: "Rules on every row",
        text: "The database itself decides who can read or change each row. On every change we test the rules against nine kinds of people, then loosen each rule on purpose to prove a test notices.",
      },
      {
        id: "keychain",
        title: "Secrets in the keychain",
        text: "On your computer, mail passwords, sign-in tokens and your session sit in the system keychain, where your Mac or PC keeps its own.",
      },
      {
        id: "sealed",
        title: "Sealed twice where it counts",
        text: "Every connection is encrypted, and our hosting provider encrypts what it stores. Tokens for the Google or Zoom accounts you connect are sealed once more, with a key for each person.",
      },
      {
        id: "hash",
        title: "Keys we can’t read back",
        text: "An assistant’s key is shown to you once. We keep only its fingerprint, check it on every request, and stop it the moment you revoke it.",
      },
      {
        id: "signed",
        title: "A signed Mac app",
        text: "The Mac app is signed with our Apple Developer ID and notarized by Apple. Each update is checked against our signature before it installs.",
      },
      {
        id: "two",
        title: "Two people, on the record",
        text: "Only the two founders can reach production. We open a workspace’s content only when you ask, to fix a problem, or when the law requires it.",
      },
      {
        id: "review",
        title: "Checked before it ships",
        text: "Moduo’s code is public. Every push is scanned for leaked keys, and changes to permissions or account deletion get a second look before they go live.",
      },
    ],
  },

  notYet: {
    title: "What we don’t have yet.",
    text: "We’d rather tell you than have you find out. These are on the list.",
    items: [
      {
        title: "Two-factor sign-in",
        text: "Today you sign in with a code sent to your email. A second step, like an authenticator app, comes later.",
      },
      {
        title: "A signed Windows installer",
        text: "Windows asks before it runs our installer, because it isn’t signed yet. The Mac app is.",
      },
      {
        title: "Single sign-on",
        text: "No company sign-in through Google Workspace, Okta or SAML yet.",
      },
      {
        title: "A published security policy",
        text: "No bug bounty or formal disclosure policy yet. The address at the foot of this page works in the meantime.",
      },
    ],
  },

  vendors: {
    title: "Who else handles it.",
    text: "Five companies run parts of Moduo for us. We don’t sell your data, and we don’t share it with advertisers.",
    head: ["Company", "What it does for Moduo", "Where"],
    rows: [
      ["Supabase", "The database, sign-in, file storage and server functions", "London, UK"],
      [
        "Cloudflare",
        "Hosts moduo.app and the web app, and delivers the desktop downloads and updates",
        "USA, servers worldwide",
      ],
      ["PostHog", "Analytics for the site and the app, only if you agree", "Frankfurt, Germany"],
      ["Resend", "Sends sign-in codes, workspace invites and booking emails", "USA"],
      ["Stripe", "Payments and trials", "USA"],
    ],
    note: "Before we add or replace a company that holds your workspaces, we email you at least 30 days ahead.",
    privacy: "Privacy policy",
    dpa: "Data processing agreement",
  },

  rights: {
    title: "Yours to take, yours to end.",
    text: "The way out is in Settings, not in a support queue.",
    items: [
      {
        k: "Export",
        figure: "1 file",
        text: "Export workspace data, in Settings under Advanced, puts your tasks, notes, contacts, calendar, habits and chat in one .zip, every conversation as Markdown too. If we ever close Moduo, you get at least 30 days to do it first.",
      },
      {
        k: "Delete",
        figure: "At once",
        text: "Delete your account and it goes immediately, with what Stripe, file storage and analytics hold about you. If you’re the only owner of a workspace with other people in it, hand it over first.",
      },
      {
        k: "Backups",
        figure: "30 days",
        text: "Copies in backups expire within 30 days. We keep anything longer only where the law requires it.",
      },
      {
        k: "A breach",
        figure: "48 hours",
        text: "If a breach touches your data, the workspace owner hears from us within 48 hours: what happened, what may be affected and what we’re doing.",
      },
    ],
  },

  report: {
    title: "Found a problem?",
    text: "Write to hello@moduo.app with Security in the subject. Tell us what you found and how to see it. One of the two of us reads it, and we’ll tell you what we change.",
    email: "hello@moduo.app",
    button: "Email us",
  },

  faq: {
    title: "Questions about your data.",
    items: [
      {
        q: "Where is my data stored?",
        a: "In London, UK, on Supabase’s servers. Analytics stay in Frankfurt, and only if you agree to them. The desktop app also keeps data on your computer, your mail included.",
      },
      {
        q: "Can Moduo read my email?",
        a: "Your mail goes straight from your provider to the desktop app on your computer, and our servers never connect to your mailbox. When you act on a thread, like turning it into a task, Moduo keeps its sender, subject, a short snippet and the date.",
      },
      {
        q: "Does Moduo train AI on my work?",
        a: "No. We don’t train models at all. An assistant you connect reaches Moduo only through a key you control, and its provider’s own rules cover what it receives.",
      },
      {
        q: "Is there two-factor sign-in?",
        a: "Not yet. You sign in with a one-time code sent to your email, and there are no passwords on Moduo accounts.",
      },
      {
        q: "What do you track?",
        a: "On this site, nothing until you accept the cookie card, and nothing at all if your browser sends Do Not Track. In the app, analytics run only with your consent, and the app never records sessions or tracks clicks.",
      },
    ],
  },

  related: "Keep reading.",
} as const;
