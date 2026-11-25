// /download: where Moduo runs. Every requirement is the shipped build's (surveyed 27 October
// 2026): apps/desktop/src-tauri/tauri.conf.json (macOS 14.0 minimum, the updater and its
// signature check), .github/workflows/_desktop-release.yml (a universal, signed and notarized
// .dmg; an x64 NSIS installer that isn't code-signed yet; no Linux, no Windows on ARM), and the
// links Settings → About hands out (apps/app/src/features/settings/about.ts, the production
// channel). Email is desktop only (features/settings/sections/integrations-section.tsx), and so
// are CalDAV and ICS calendars (features/calendar/ui/calendar-connect-dialog.tsx).

const DOWNLOAD_BASE = "https://updates.moduo.app/download/desktop/production/latest";

export type OsId = "mac" | "windows" | "web";

export const download = {
  title: "Download Moduo for Mac, Windows and the web",
  description:
    "Moduo for macOS 14 or later and 64-bit Windows, or in your browser at app.moduo.app. The desktop apps carry your email; everything else is the same in all three.",
  name: "Download",
  line: "Moduo for Mac, Windows and the web.",
  lead: "One account and one workspace in all three. The desktop apps carry your email; the web app opens wherever you sign in.",
  web: { label: "Open the web app", href: "https://app.moduo.app" },
  invite: "Moduo is in private beta, so signing in needs an invite.",

  frames: {
    title: "One window, three frames.",
    text: "The same Home, the same links, the same morning. Only the frame around it changes.",
    pick: "Show Moduo on",
    os: [
      { id: "mac", label: "Mac" },
      { id: "windows", label: "Windows" },
      { id: "web", label: "Web" },
    ] as { id: OsId; label: string }[],
    caption: {
      mac: "On a Mac, in its own window, with your email in it.",
      windows: "On Windows, in its own window, with your email in it.",
      web: "In the browser at app.moduo.app. Your inbox stays in the desktop app.",
    } as Record<OsId, string>,
    // Inside the picture, in the browser: the Inbox widget mounts only where email runs.
    webInbox: "Your inbox opens in the desktop app.",
    url: "app.moduo.app",
    window: "Moduo",
  },

  platforms: {
    title: "Pick your door.",
    note: "Both installers sign in with an invite while Moduo is in private beta. The web app does too.",
    items: [
      {
        id: "mac",
        name: "Mac",
        need: "macOS 14 Sonoma or later",
        facts: [
          "One app for Apple silicon and Intel",
          "Signed with a Developer ID and notarized by Apple",
          "Updates itself, and checks each update’s signature first",
        ],
        button: { label: "Download for Mac", href: `${DOWNLOAD_BASE}/Moduo_universal.dmg` },
        file: "Moduo_universal.dmg",
      },
      {
        id: "windows",
        name: "Windows",
        need: "64-bit Windows on Intel or AMD",
        facts: [
          "Updates itself, and checks each update’s signature first",
          "The installer isn’t code-signed yet, so Windows asks before it runs: choose More info, then Run anyway",
          "Not on Windows on ARM yet",
        ],
        button: { label: "Download for Windows", href: `${DOWNLOAD_BASE}/Moduo_x64-setup.exe` },
        file: "Moduo_x64-setup.exe",
      },
      {
        id: "web",
        name: "Web",
        need: "Your browser, at app.moduo.app",
        facts: [
          "Nothing to install, always the latest version",
          "Everything but the inbox: email shows its follow-ups, snoozed and linked threads",
          "The same workspace you left on your desktop",
        ],
        button: { label: "Open the web app", href: "https://app.moduo.app" },
        file: "app.moduo.app",
      },
    ] as {
      id: OsId;
      name: string;
      need: string;
      facts: string[];
      button: { label: string; href: string };
      file: string;
    }[],
  },

  where: {
    title: "What runs where.",
    text: "Your work syncs between all three. Two things need the desktop app, because they talk to your mail and calendar servers from your own computer.",
    table: "Features by platform: Mac, Windows and the web",
    head: ["", "Mac", "Windows", "Web"],
    rows: [
      ["Tasks, notes, contacts and Home", "Yes", "Yes", "Yes"],
      ["Calendar, time blocks and booking pages", "Yes", "Yes", "Yes"],
      ["Google Calendar, both ways", "Yes", "Yes", "Yes"],
      ["Chat, on Duo and Team", "Yes", "Yes", "Yes"],
      ["Assistants over MCP", "Yes", "Yes", "Yes"],
      ["Email: Gmail, iCloud and IMAP", "Yes", "Yes", "Follow-ups, snoozed and linked threads"],
      ["iCloud, Fastmail and other CalDAV calendars, read-only", "Yes", "Yes", "No"],
      ["Calendar feeds (ICS), read-only", "Yes", "Yes", "No"],
    ],
  },

  phones: {
    title: "Phones come after.",
    text: "Apps for iPhone and Android follow once Mac, Windows and the web are settled. Join the waitlist and we’ll tell you when they’re ready.",
  },

  questions: [
    {
      q: "Do I need the desktop app?",
      a: "Only for email. Tasks, notes, calendar, contacts, chat and Home work the same in your browser. The desktop app adds your inbox, and calendars you connect over CalDAV or ICS.",
    },
    {
      q: "Why does Windows warn me before it installs?",
      a: "The Windows installer isn’t code-signed yet, so SmartScreen asks first. Choose More info, then Run anyway. The Mac app is signed and notarized by Apple.",
    },
    {
      q: "How do updates work?",
      a: "The desktop apps update themselves, and each update’s signature is checked before it installs. The web app is always the current version.",
    },
    {
      q: "Can I sign in before my invite arrives?",
      a: "Not yet. During the private beta every account starts with an invite. Join the waitlist and we’ll email you when it’s your turn.",
    },
  ],
} as const;
