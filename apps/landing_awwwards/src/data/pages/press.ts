// /press: the press kit (brand brief §13, decision 66). The boilerplate and the brand line are the
// brand's own words, verbatim (§11, decision 75); the pronunciation and katakana are decision 9.
// No location in brand copy, no screenshots of the app yet, and the name story (mod and duo) is
// not repeated here (decision 8). The files are the BRAND-1 exports, copied into public/press.

export const press = {
  title: "Press kit: logos, lines and founders",
  description:
    "Moduo’s press kit: the logo in SVG and PNG, the app icon, the boilerplate and brand line, how to say the name, the founders, and who to write to.",
  name: "Press",
  line: "Everything you need to write about Moduo.",
  lead: "The logo files, the lines we use, the two of us, and an address where a person answers.",
  cta: { kit: "Download the press kit", email: "Email us" },
  kit: { href: "/press/moduo-press-kit.zip", file: "moduo-press-kit.zip" },

  plate: {
    title: "The logo, measured.",
    text: "Give it room and keep it whole. The space around it is measured in its own letters.",
    lockup: "The lockup",
    mark: "The mark",
    guides: { top: "Top of the mark", xh: "x-height", base: "Baseline", foot: "Foot of the mark" },
    space: {
      lockup: "Clear space: one o on every side",
      mark: "Clear space: a quarter of its height",
    },
    min: {
      title: "Smallest sizes",
      lockup: { screen: "72 px wide", print: "20 mm in print" },
      mark: { screen: "16 px", print: "5 mm in print" },
    },
  },

  files: {
    title: "The files.",
    text: "Paper for dark grounds, Ink for light ones. SVG for anything that scales, PNG at three times its size for the rest.",
    items: [
      {
        id: "lockup-paper",
        name: "Lockup",
        tone: "Paper",
        on: "dark",
        span: 6,
        img: "moduo-lockup-paper",
        alt: "The Moduo lockup in Paper on black",
      },
      {
        id: "lockup-ink",
        name: "Lockup",
        tone: "Ink",
        on: "light",
        span: 6,
        img: "moduo-lockup-ink",
        alt: "The Moduo lockup in Ink on white",
      },
      {
        id: "mark-paper",
        name: "Mark",
        tone: "Paper",
        on: "dark",
        span: 3,
        img: "moduo-mark-paper",
        alt: "The Moduo mark in Paper on black",
      },
      {
        id: "mark-ink",
        name: "Mark",
        tone: "Ink",
        on: "light",
        span: 3,
        img: "moduo-mark-ink",
        alt: "The Moduo mark in Ink on white",
      },
      {
        id: "wordmark-paper",
        name: "Wordmark",
        tone: "Paper",
        on: "dark",
        span: 3,
        img: "moduo-wordmark-paper",
        alt: "The Moduo wordmark in Paper on black",
      },
      {
        id: "wordmark-ink",
        name: "Wordmark",
        tone: "Ink",
        on: "light",
        span: 3,
        img: "moduo-wordmark-ink",
        alt: "The Moduo wordmark in Ink on white",
      },
    ],
    wordmarkNote: "The wordmark alone only where the mark is already large nearby.",
    icon: {
      name: "App icon",
      text: "The mark on a black tile, as it sits in the Dock and the taskbar.",
      file: "moduo-app-icon-1024.png",
      size: "1024 × 1024 PNG",
      alt: "The Moduo app icon: the white mark on a black rounded tile",
    },
    kit: {
      name: "Everything here, in one file",
      text: "Every logo above in SVG and PNG, the app icon, both founders’ photos and the lines below as text.",
    },
  },

  misuse: {
    title: "Keep it as drawn.",
    text: "The logo is artwork. Use the files above as they are.",
    items: [
      { id: "stretch", label: "Don’t stretch it" },
      { id: "rotate", label: "Don’t rotate it" },
      { id: "mirror", label: "Don’t mirror it" },
      { id: "outline", label: "Don’t outline it" },
      { id: "glow", label: "Don’t add a glow or a shadow" },
      { id: "circle", label: "Don’t put it in a circle" },
    ],
    more: "And never color it, set it on a color, retype the name in any typeface or glue a tagline to it. On a photo, place it over a calm, dark area.",
  },

  lines: {
    title: "The lines we use.",
    text: "Quote them as they are, or take what you need.",
    items: [
      {
        id: "paragraph",
        label: "About Moduo, a paragraph",
        text: "Moduo is a lightweight workspace for people who run their own work. Email, tasks, notes, calendar, contacts and chat live in one window and link to each other, so an email can become a task tied to the client it came from. There’s nothing to set up: no databases, no templates. Bring your own AI assistant; Moduo never trains on your data. Made by Maciej and Mike.",
      },
      {
        id: "line",
        label: "About Moduo, one line",
        text: "Moduo is a lightweight workspace that links email, tasks, notes, calendar, contacts and chat in one window.",
      },
      { id: "brand", label: "The brand line", text: "One window for the whole working life." },
      {
        id: "campaign",
        label: "The campaign line, for now",
        text: "Fire ten apps. Keep the work.",
      },
    ],
    copy: "Copy",
  },

  say: {
    title: "Say it like this.",
    syllables: ["mo", "DOO", "oh"],
    text: "Mo, then duo, with the stress on du. However your language says duo is right.",
    kana: "モデュオ",
    kanaText: "In Japanese, written in katakana.",
    write:
      "In a sentence it’s Moduo, with a capital M. The lowercase moduo lives only in the logo.",
  },

  facts: {
    title: "Moduo, in brief.",
    rows: [
      {
        k: "What it is",
        v: "A workspace for email, tasks, notes, calendar, contacts and chat, linked to each other",
      },
      { k: "Made by", v: "Maciej Grzywacz and Mike Grochowski" },
      { k: "Status", v: "Private beta. Invites go out in waves." },
      { k: "Runs on", v: "Mac, Windows and the web. iPhone and Android later." },
      { k: "Plans", v: "Free, Pro, Duo for two people, and Team per seat" },
      {
        k: "AI",
        v: "None built in. Connect Claude, ChatGPT or Claude Code over MCP, on a key you scope",
      },
      { k: "In the works since", v: "February 2026" },
      { k: "Website", v: "moduo.app", href: "https://moduo.app" },
      { k: "Social", v: "@moduo_app", href: "https://x.com/Moduo_App" },
    ],
  },

  founders: {
    title: "The two of us.",
    download: "Download photo",
    meta: "JPG, 800 × 800",
    people: [
      {
        name: "Maciej Grzywacz",
        role: "Co-founder, product and design",
        photo: "maciej",
        file: "maciej-grzywacz.jpg",
      },
      {
        name: "Mike Grochowski",
        role: "Co-founder, engineering",
        photo: "mike",
        file: "mike-grochowski.jpg",
      },
    ],
  },

  contact: {
    title: "Writing about Moduo?",
    text: "Ask us anything, for a story, a review or a podcast. One of the two of us answers.",
    email: "hello@moduo.app",
  },

  related: "More about us.",
} as const;
