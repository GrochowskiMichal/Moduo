// The site's inner pages beyond the modules: one entry each, the words other pages use to link to
// it (related cards, the footer, the help center, llms.txt). Each page's own copy lives in its
// own file under src/data/pages/, so a page's words change in one place.
//
// Families are the chains in each page's hero: the strokes are the pages, the lit one is where you
// are (components/page/PageHero.astro, the module pages' grammar).

export type PageSlug =
  | "ai"
  | "integrations"
  | "security"
  | "download"
  | "compare"
  | "help"
  | "import"
  | "mcp"
  | "shortcuts"
  | "founders"
  | "freelancers"
  | "teams"
  | "press"
  | "about"
  | "manifesto"
  | "colophon"
  | "typeface"
  | "pricing"
  | "changelog";

export type PageRef = {
  href: string;
  /** The hero's one word, and the chain's label. */
  name: string;
  /** What the footer and link lists call it, when that differs from the name. */
  label?: string;
  /** One sentence: what you find there. */
  short: string;
};

export const pages: Record<PageSlug, PageRef> = {
  ai: {
    href: "/ai",
    name: "AI",
    label: "AI and MCP",
    short: "Connect Claude, ChatGPT or Claude Code over MCP, on a key you scope module by module.",
  },
  integrations: {
    href: "/integrations",
    name: "Integrations",
    short:
      "Gmail, iCloud and IMAP mail, Google Calendar, imports, and the assistants that connect over MCP.",
  },
  security: {
    href: "/security",
    name: "Security",
    short: "Where your work is stored, who can reach it, and how you take it back.",
  },
  download: {
    href: "/download",
    name: "Download",
    short: "Moduo for Mac, Windows and the web, and what each one does.",
  },
  compare: {
    href: "/compare",
    name: "Compare",
    short: "Moduo next to the apps it replaces, with the cases where you should keep them.",
  },
  help: {
    href: "/help",
    name: "Help",
    label: "Help center",
    short: "Answers about invites, email, plans, your data and AI, in one place.",
  },
  import: {
    href: "/import",
    name: "Import",
    label: "Import guide",
    short:
      "Bring notes from Notion or Markdown, contacts from a CSV, and tasks through your assistant.",
  },
  mcp: {
    href: "/mcp",
    name: "MCP",
    label: "MCP docs",
    short:
      "The connector URL, sign-in and keys, access levels, and every tool an assistant can call.",
  },
  shortcuts: {
    href: "/shortcuts",
    name: "Shortcuts",
    short: "Every key Moduo answers to, on Mac and Windows.",
  },
  founders: {
    href: "/for/founders",
    name: "Founders",
    short:
      "Two co-founders, one workspace: clients, hiring, the plan and the conversation in one window.",
  },
  freelancers: {
    href: "/for/freelancers",
    name: "Freelancers",
    short: "One person, many clients: every email, task and call filed by who it is for.",
  },
  teams: {
    href: "/for/teams",
    name: "Small teams",
    short: "Three people or ten: shared work, roles, and a channel for every client.",
  },
  press: {
    href: "/press",
    name: "Press",
    label: "Press kit",
    short: "The logo files, the boilerplate, the founders and how to reach us.",
  },
  about: {
    href: "/about",
    name: "About",
    label: "About us",
    short: "The two of us, as our coding agent reads us.",
  },
  manifesto: {
    href: "/manifesto",
    name: "Manifesto",
    short: "Every app you need. None you don’t.",
  },
  colophon: {
    href: "/colophon",
    name: "Colophon",
    short: "How the site is drawn, from one stroke.",
  },
  typeface: {
    href: "/typeface",
    name: "Typeface",
    short: "Oudom, the typeface we cut from our mark.",
  },
  pricing: {
    href: "/pricing",
    name: "Pricing",
    short: "Free, Pro, Duo and Team, with a founding price.",
  },
  changelog: { href: "/changelog", name: "Changelog", short: "Every release, newest first." },
};

/** The chain in each family's heroes, in reading order. */
export const families = {
  product: ["ai", "integrations", "security", "download", "compare"],
  resources: ["help", "import", "mcp", "shortcuts"],
  for: ["freelancers", "founders", "teams"],
  company: ["about", "manifesto", "press", "colophon", "typeface"],
} as const satisfies Record<string, readonly PageSlug[]>;

export type Family = keyof typeof families;

/** The chain's landmark name: unique on the page (the footer's columns are "Product" and so on). */
export const familyLabel: Record<Family, string> = {
  product: "Product pages",
  resources: "Help and guides",
  for: "Who Moduo is for",
  company: "Company pages",
};
