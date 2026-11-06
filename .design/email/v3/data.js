/* Fictional data: Robin Hale's week of mail at Hale & Co. Today is Tue 3 Nov 2026, 10:42. */
const NOW = new Date("2026-11-03T10:42:00");
const ACCOUNTS = {
  work: { id: "work", address: "robin@haleandco.com", label: "Hale & Co", provider: "Google", hue: "blue", unread: 9, status: "ok", lastSync: "2 min ago" },
  personal: { id: "personal", address: "robin.hale@gmail.com", label: "Home", provider: "Google", hue: "violet", unread: 3, status: "ok", lastSync: "2 min ago" },
  studio: { id: "studio", address: "robin@lumen.studio", label: "Lumen", provider: "IMAP", hue: "teal", unread: 2, status: "reauth", lastSync: "Sun 18:20" },
};
const PEOPLE = {
  ana: { name: "Ana Ruiz", email: "ana@haleandco.com", company: "Hale & Co", role: "Design lead", hue: "pink", contact: true, member: true, lastTouch: "Chatted 20 min ago", openTasks: 2, notes: 3, meetings: ["Design review · today 14:00"], tasks: [["Review the relaunch copy", "Thu"], ["Brief Marco on the retouch", "Fri"]], noteTitles: ["Relaunch: hero explorations", "Design review notes", "Type and colour audit"] },
  tom: { name: "Tom Becker", email: "tom@beckerlegal.de", company: "Becker Legal", role: "Counsel", hue: "amber", contact: true, lastTouch: "Emailed today 8:12", openTasks: 1, notes: 1, meetings: [], tasks: [["Sign the contractor agreement", "Thu"]], noteTitles: ["Legal: contractor terms"] },
  jonas: { name: "Jonas Weber", email: "jonas.weber@acme.io", company: "Acme", role: "Head of Ops", hue: "green", contact: true, lastTouch: "Call Thu 28 Oct", openTasks: 3, notes: 2, meetings: ["Acme weekly · Thu 11:00"], tasks: [["Confirm Acme pilot week", "Thu"], ["Send the security answers", "Fri"], ["Book the kickoff room", "12 Nov"]], noteTitles: ["Acme: Weekly sync, week 44", "Acme: rollout plan"] },
  priya: { name: "Priya Nair", email: "priya@northwind.co", company: "Northwind", role: "Founder", hue: "violet", contact: true, lastTouch: "Emailed you Sat 31 Oct", openTasks: 0, notes: 1, meetings: [], tasks: [], noteTitles: ["Northwind: partnership one-pager"] },
  lena: { name: "Lena Fischer", email: "lena@fjordventures.com", company: "Fjord Ventures", role: "Partner", hue: "blue", contact: true, lastTouch: "Investor update sent 28 Oct", openTasks: 1, notes: 2, meetings: ["Fjord catch-up · Fri 10:00"], tasks: [["Answer Lena on the second engineer", "Fri"]], noteTitles: ["Investor update, October", "Fjord: term sheet notes"] },
  marco: { name: "Marco Reyes", email: "marco.reyes@pixelforge.co", company: "Pixelforge", role: "Photographer", hue: "teal", contact: true, lastTouch: "Emailed Mon", openTasks: 1, notes: 0, meetings: ["Shoot · Thu 09:00"], tasks: [["Bring the product samples to the shoot", "Thu"]], noteTitles: [] },
  sam: { name: "Sam Ortiz", email: "sam.ortiz@gmail.com", company: "", role: "", hue: "green", contact: false },
  kit: { name: "Kit Moreau", email: "kit@moreau.fr", company: "", role: "", hue: "amber", contact: false },
  elena: { name: "Elena Novak", email: "elena.novak@brightpath.org", company: "Brightpath", role: "Programme lead", hue: "pink", contact: false },
  dev: { name: "Devon Park", email: "devon@haleandco.com", company: "Hale & Co", role: "Engineer", hue: "blue", contact: true, member: true, lastTouch: "Chatted yesterday", openTasks: 4, notes: 1, meetings: [], tasks: [["Flip prod to the new sync engine", "Wed"], ["Fix the landing build", "today"], ["Swap the hero behind the flag", "Wed"], ["Write the rollback note", "Thu"]], noteTitles: ["Sync engine: rollout plan"] },
  you: { name: "Robin Hale", email: "robin@haleandco.com", hue: "gray", me: true },
  stripe: { name: "Stripe", email: "receipts@stripe.com", hue: "gray", system: true },
  linear: { name: "Linear", email: "notifications@linear.app", hue: "gray", system: true },
  github: { name: "GitHub", email: "noreply@github.com", hue: "gray", system: true },
  vercel: { name: "Vercel", email: "notifications@vercel.com", hue: "gray", system: true },
  hetzner: { name: "Hetzner", email: "billing@hetzner.com", hue: "gray", system: true },
  calendly: { name: "Calendly", email: "notifications@calendly.com", hue: "gray", system: true },
  figma: { name: "Figma", email: "team@figma.com", hue: "gray", system: true },
  ph: { name: "Product Hunt", email: "hello@producthunt.com", hue: "gray", system: true },
  lenny: { name: "Lenny's Newsletter", email: "lenny@substack.com", hue: "gray", system: true },
  tldr: { name: "TLDR", email: "dan@tldrnewsletter.com", hue: "gray", system: true },
  notion: { name: "Notion", email: "team@mail.notion.so", hue: "gray", system: true },
  loom: { name: "Loom", email: "digest@loom.com", hue: "gray", system: true },
  webflow: { name: "Webflow", email: "news@webflow.com", hue: "gray", system: true },
  bank: { name: "N26", email: "support@n26.com", hue: "gray", system: true },
  dhl: { name: "DHL", email: "noreply@dhl.de", hue: "gray", system: true },
  apple: { name: "Apple", email: "no_reply@email.apple.com", hue: "gray", system: true },
  lufthansa: { name: "Lufthansa", email: "newsletter@lufthansa.com", hue: "gray", system: true },
};

/* kinds: people · updates · reading. unread, pinned, att (attachment names), msgs count, when (ISO).
   snooze: ISO until · follow: { by: ISO, due: bool } · links: [{kind, title}] · body: id of BODIES */
const THREADS = [
  { id: "t1", acc: "work", from: "jonas", to: ["you"], subject: "Re: Acme rollout — revised timeline", snippet: "Thanks for the call. Two changes from our side: the pilot moves to the week of 16 Nov and we'd like Devon on the", when: "2026-11-03T09:58:00", unread: true, kind: "people", msgs: 6, att: ["Acme-rollout-v3.pdf"], body: "b1", links: [{ kind: "task", title: "Confirm Acme pilot week" }, { kind: "note", title: "Acme: Weekly sync, week 44" }] },
  { id: "t2", acc: "work", from: "ana", to: ["you", "dev"], subject: "Hero photo options for the relaunch", snippet: "Three picks attached. I'd go with the second — the one with the morning light. Can you decide before the", when: "2026-11-03T09:31:00", unread: true, kind: "people", msgs: 2, att: ["hero-A.jpg", "hero-B.jpg", "hero-C.jpg"], body: "b2" },
  { id: "t3", acc: "work", from: "tom", to: ["you"], subject: "Contractor agreement: last two clauses", snippet: "Clause 9 (IP assignment) is fine as is. For clause 12 I'd soften the non-compete to six months — twelve won't hold in", when: "2026-11-03T08:12:00", unread: true, kind: "people", msgs: 4, att: ["Contractor-agreement-v4.docx"], body: "b3", links: [{ kind: "task", title: "Sign the contractor agreement" }] },
  { id: "t4", acc: "personal", from: "sam", to: ["you"], subject: "Coffee next week?", snippet: "Would love to catch up — I'm in Berlin Tuesday to Thursday. Any afternoon works, or breakfast if you're an early", when: "2026-11-03T07:45:00", unread: true, kind: "people", msgs: 1, body: "b4" },
  { id: "t5", acc: "work", from: "elena", to: ["you"], subject: "Speaking at Brightpath Founders Day (6 Dec)", snippet: "We'd love to have you on the 'small teams, big tools' panel. It's 40 minutes, no slides, two other founders. Travel", when: "2026-11-02T17:20:00", unread: true, kind: "people", msgs: 1, body: "b5" },
  { id: "t6", acc: "work", from: "lena", to: ["you"], subject: "Re: October investor update", snippet: "Great numbers on retention. One question on the hiring plan: is the second engineer a replacement or new headcount?", when: "2026-11-02T16:05:00", unread: false, kind: "people", msgs: 3, body: "b6", links: [{ kind: "note", title: "Investor update, October" }] },
  { id: "t7", acc: "work", from: "marco", to: ["you", "ana"], subject: "Thursday shoot: call sheet", snippet: "Call time 8:30 at the studio, outdoors from 9:15 while the light holds. Bring the product samples and the two", when: "2026-11-02T14:40:00", unread: false, kind: "people", pinned: true, msgs: 5, att: ["Call-sheet-Thu.pdf"], body: "b7", links: [{ kind: "event", title: "Shoot · Thu 09:00" }] },
  { id: "t8", acc: "work", from: "dev", to: ["you"], subject: "Staging is on the new sync engine", snippet: "Everything's green on staging. I'd like to flip prod Wednesday morning unless you want another day of soak.", when: "2026-11-02T11:15:00", unread: false, kind: "people", msgs: 2, body: "b8" },
  { id: "t9", acc: "personal", from: "kit", to: ["you"], subject: "Lisbon offsite — the house", snippet: "Found a place in Alfama with a terrace that fits ten, 18–21 Jan. Holding it until Friday. Photos below.", when: "2026-11-01T19:30:00", unread: false, kind: "people", msgs: 3, att: ["alfama-house.pdf"], body: "b9", links: [{ kind: "note", title: "Book the Lisbon offsite" }] },
  { id: "t10", acc: "work", from: "priya", to: ["you"], subject: "Intro: Northwind × Hale & Co", snippet: "Robin, meet Dana (cc'd) who runs partnerships at Northwind. I'll let you two take it from here.", when: "2026-10-31T15:02:00", unread: false, kind: "people", msgs: 2, body: "b10" },
  { id: "t11", acc: "work", from: "jonas", to: ["you"], subject: "Invoice HC-2026-031 (September)", snippet: "Paid today, should land Tuesday. Apologies for the delay — finance moved to a new system.", when: "2026-10-30T16:48:00", unread: false, kind: "people", msgs: 2, body: "b11" },
  { id: "t12", acc: "work", from: "ana", to: ["you"], subject: "Fwd: Icon set v1.3 export", snippet: "Latest cut from the illustrator. The 24 px variants are in. Open the source file, not the PNGs, if you want to", when: "2026-10-30T10:20:00", unread: false, kind: "people", msgs: 1, att: ["icons-1.3.zip"], body: "b12" },
  { id: "t13", acc: "studio", from: "elena", to: ["you"], subject: "Re: Workshop materials", snippet: "Perfect, the PDF works. See you on the 14th.", when: "2026-10-29T09:10:00", unread: false, kind: "people", msgs: 4, body: "b13" },
  { id: "t14", acc: "personal", from: "sam", to: ["you"], subject: "That book I mentioned", snippet: "'The Mom Test' — short, and it fixes the exact thing we talked about. Lend it to you Tuesday if you want.", when: "2026-10-28T21:05:00", unread: false, kind: "people", msgs: 1, body: "b14" },

  { id: "u1", acc: "work", from: "stripe", to: ["you"], subject: "Your October invoice is ready", snippet: "Invoice #4821 for October: €49.00. No action needed — it's paid from your card ending 4421.", when: "2026-11-03T06:02:00", unread: true, kind: "updates", msgs: 1, att: ["invoice-4821.pdf"], body: "u1" },
  { id: "u2", acc: "work", from: "linear", to: ["you"], subject: "Devon assigned you HAL-212: Flip prod to the new sync engine", snippet: "Due Wed 5 Nov · Project: Sync engine · 'Flip the flag after the Tuesday soak; rollback plan in the issue.'", when: "2026-11-03T05:50:00", unread: true, kind: "updates", msgs: 1 },
  { id: "u3", acc: "work", from: "github", to: ["you"], subject: "[haleandco/app] Release v0.41.0 published", snippet: "v0.41.0: sync engine behind a flag, mail reader dark mode, 14 fixes. Published by devon-park.", when: "2026-11-02T23:40:00", unread: true, kind: "updates", msgs: 1 },
  { id: "u4", acc: "work", from: "vercel", to: ["you"], subject: "Deployment failed: landing (main)", snippet: "Build failed at step 'bun run build' — Module not found: './fonts/brand-1.3.woff2'. View the logs.", when: "2026-11-02T22:10:00", unread: true, kind: "updates", msgs: 1 },
  { id: "u5", acc: "work", from: "calendly", to: ["you"], subject: "New event: Dana Whitfield at 11:30 on Thu 5 Nov", snippet: "Intro call · 30 min · Google Meet. Dana wrote: 'Priya suggested we talk about the partnership programme.'", when: "2026-11-02T18:25:00", unread: false, kind: "updates", msgs: 1 },
  { id: "u6", acc: "work", from: "figma", to: ["you"], subject: "Ana Ruiz invited you to 'Relaunch — hero explorations'", snippet: "Open the file to leave comments. You have edit access.", when: "2026-11-02T10:05:00", unread: false, kind: "updates", msgs: 1 },
  { id: "u7", acc: "work", from: "hetzner", to: ["you"], subject: "Invoice R0023498761 is available", snippet: "Your invoice for October 2026 is now available in the Hetzner console. Amount: €86.20.", when: "2026-11-01T04:12:00", unread: false, kind: "updates", msgs: 1, att: ["R0023498761.pdf"] },
  { id: "u8", acc: "personal", from: "dhl", to: ["you"], subject: "Your parcel arrives today", snippet: "Parcel 00340434161094893213 will be delivered between 12:00 and 15:00. Not home? Choose a Packstation.", when: "2026-10-31T07:30:00", unread: false, kind: "updates", msgs: 1 },
  { id: "u9", acc: "personal", from: "bank", to: ["you"], subject: "Your card was used abroad", snippet: "€124.50 at Lisboa Hostel Partners, Lisbon. If this wasn't you, lock your card in the app.", when: "2026-10-30T20:15:00", unread: false, kind: "updates", msgs: 1 },
  { id: "u10", acc: "personal", from: "apple", to: ["you"], subject: "Your receipt from Apple", snippet: "iCloud+ 200GB · €2.99 · Renews 30 Nov.", when: "2026-10-30T08:00:00", unread: false, kind: "updates", msgs: 1 },

  { id: "r1", acc: "personal", from: "lenny", to: ["you"], subject: "How the best small teams run their week", snippet: "This week: rituals that survive a growing team, a founder's weekly review template, and why 'office hours' beat", when: "2026-11-03T08:30:00", unread: true, kind: "reading", msgs: 1 },
  { id: "r2", acc: "personal", from: "tldr", to: ["you"], subject: "TLDR: Tauri 3 beta, Postgres 19, the end of the sidebar", snippet: "Tauri 3 beta lands with a new IPC layer (4 min) · Postgres 19 async I/O benchmarks (6 min) · Why every app is", when: "2026-11-03T06:15:00", unread: true, kind: "reading", msgs: 1 },
  { id: "r3", acc: "work", from: "ph", to: ["you"], subject: "Weekly digest: 8 new products", snippet: "The best new products this week, curated for you: a calmer calendar, a mail client with no AI, and a tiny CRM.", when: "2026-11-02T13:00:00", unread: false, kind: "reading", msgs: 1 },
  { id: "r4", acc: "work", from: "notion", to: ["you"], subject: "What's new in Notion — November", snippet: "Mail arrives in Notion for everyone, plus new database views and a faster search.", when: "2026-11-02T09:00:00", unread: false, kind: "reading", msgs: 1 },
  { id: "r5", acc: "work", from: "loom", to: ["you"], subject: "Your weekly Loom digest", snippet: "3 new videos from your workspace this week. Devon's 'sync engine walkthrough' has 4 views.", when: "2026-11-01T09:00:00", unread: false, kind: "reading", msgs: 1 },
  { id: "r6", acc: "work", from: "webflow", to: ["you"], subject: "Webflow Conf recap: everything we launched", snippet: "Catch up on the keynote, the new CMS and the AI site builder — plus 40% off annual plans this week only.", when: "2026-10-31T16:00:00", unread: false, kind: "reading", msgs: 1 },
  { id: "r7", acc: "personal", from: "lufthansa", to: ["you"], subject: "Lisbon from €89 — January sale", snippet: "Fly to Lisbon, Porto and Faro from €89 return. Book by 15 November.", when: "2026-10-30T11:00:00", unread: false, kind: "reading", msgs: 1 },
  { id: "r8", acc: "personal", from: "lenny", to: ["you"], subject: "The founder's weekly review (template)", snippet: "A 25-minute Friday ritual: what moved, what didn't, what you're avoiding. Template inside.", when: "2026-10-27T08:30:00", unread: false, kind: "reading", msgs: 1 },
];

/* Snoozed and follow-ups live outside the inbox. */
const SNOOZED = [
  { id: "s1", acc: "work", from: "lena", subject: "Fjord: term sheet redline", snippet: "Attached with our comments. No rush before your Friday call.", when: "2026-10-29T17:40:00", until: "2026-11-06T09:00:00", att: ["Term-sheet-redline.pdf"], kind: "people", msgs: 2 },
  { id: "s2", acc: "personal", from: "kit", subject: "Flights for Lisbon", snippet: "Prices drop mid-November usually. I'll ping you.", when: "2026-10-28T12:00:00", until: "2026-11-17T09:00:00", kind: "people", msgs: 1 },
  { id: "s3", acc: "work", from: "elena", subject: "Brightpath: speaker form", snippet: "Fill in when you've decided; deadline is 20 Nov.", when: "2026-11-02T17:22:00", until: "2026-11-10T09:00:00", kind: "people", msgs: 1 },
  { id: "s4", acc: "work", from: "hetzner", subject: "Scheduled maintenance 9 Nov, 02:00–04:00 CET", snippet: "Your server fsn1-dc14-021 will restart once during the window.", when: "2026-10-30T09:00:00", until: "2026-11-08T18:00:00", kind: "updates", msgs: 1 },
];
const FOLLOWUPS = [
  { id: "f1", acc: "work", to: "priya", subject: "Partnership programme: next steps", snippet: "You: Sending over the one-pager and three dates for a call…", when: "2026-10-27T16:10:00", by: "2026-11-03T09:00:00", due: true, msgs: 1, body: "f1" },
  { id: "f2", acc: "work", to: "tom", subject: "Trademark filing: EU classes", snippet: "You: Going with classes 9, 35 and 42 — can you file this week?", when: "2026-10-30T11:25:00", by: "2026-11-05T09:00:00", due: false, msgs: 1, body: "f2" },
  { id: "f3", acc: "work", to: "jonas", subject: "Acme: security questionnaire", snippet: "You: Answers attached; the two open items need your IT lead.", when: "2026-10-31T09:40:00", by: "2026-11-07T09:00:00", due: false, att: ["Acme-security-questionnaire.xlsx"], msgs: 1, body: "f3" },
];
const SENT = [
  { id: "x1", acc: "work", to: "jonas", subject: "Re: Acme rollout — revised timeline", snippet: "You: Works for us. Devon is on the pilot; I'll confirm the week by Thursday.", when: "2026-11-03T10:12:00", msgs: 6 },
  { id: "x2", acc: "work", to: "lena", subject: "October investor update", snippet: "You: Retention 94%, two hires, the relaunch on the 14th. Numbers and the deck inside.", when: "2026-10-28T18:30:00", att: ["Hale-Oct-update.pdf"], msgs: 1 },
  { id: "x3", acc: "personal", to: "kit", subject: "Re: Lisbon offsite — the house", snippet: "You: Terrace wins. Hold it, I'll confirm with the team Friday.", when: "2026-11-02T09:05:00", msgs: 3 },
];
const DRAFTS = [
  { id: "d1", acc: "work", to: "elena", subject: "Re: Speaking at Brightpath Founders Day (6 Dec)", snippet: "Thanks Elena — yes in principle. Two questions before I confirm:", when: "2026-11-03T10:30:00" },
];

const BODIES = {
  b1: [
    { from: "jonas", when: "2026-10-29T14:02:00", text: ["Hi Robin,", "Following up on today's call. Draft timeline attached (v2). Pilot starts the week of 9 Nov with the Hamburg team, full rollout in January.", "Jonas"], att: ["Acme-rollout-v2.pdf"] },
    { from: "you", when: "2026-10-29T16:40:00", text: ["Thanks Jonas. The 9th works, as long as the SSO piece is done on your side by then. Devon will join the pilot calls.", "Robin"] },
    { from: "jonas", when: "2026-10-30T09:15:00", text: ["SSO is on track. One ask: can the pilot group be 25 instead of 15? Hamburg has grown."] },
    { from: "you", when: "2026-10-30T09:52:00", text: ["25 is fine. Same price for the pilot."] },
    { from: "jonas", when: "2026-11-03T09:58:00", text: ["Thanks for the call. Two changes from our side: the pilot moves to the week of 16 Nov and we'd like Devon on the weekly check-in rather than only the kickoff. Revised timeline attached (v3).", "Can you confirm the week by Thursday? Our IT lead needs to book the SSO window.", "Jonas"], att: ["Acme-rollout-v3.pdf"] },
    { from: "you", when: "2026-11-03T10:12:00", text: ["Works for us. Devon is on the weekly. I'll confirm the week by Thursday.", "Robin"] },
  ],
  b2: [
    { from: "ana", when: "2026-11-02T15:10:00", text: ["Marco sent the contact sheet from the test shoot. Picking three for the hero tomorrow."] },
    { from: "ana", when: "2026-11-03T09:31:00", text: ["Three picks attached. I'd go with the second — the one with the morning light. The first is safer but it looks like every other landing page.", "Can you decide before the design review at 14:00? Devon needs the final by Wednesday to swap it in behind the flag.", "Ana"], att: ["hero-A.jpg", "hero-B.jpg", "hero-C.jpg"] },
  ],
  b3: [
    { from: "you", when: "2026-10-28T10:05:00", text: ["Tom, v3 attached. Two clauses I'm not sure about: 9 (IP) and 12 (non-compete). Everything else is as we discussed."], att: ["Contractor-agreement-v3.docx"] },
    { from: "tom", when: "2026-10-29T17:48:00", text: ["Will look Friday."] },
    { from: "you", when: "2026-10-30T08:00:00", text: ["Thanks."] },
    { from: "tom", when: "2026-11-03T08:12:00", text: ["Clause 9 (IP assignment) is fine as is. For clause 12 I'd soften the non-compete to six months — twelve won't hold in Germany for a contractor and a court would likely strike the whole clause.", "v4 attached with the change tracked. If you're happy, sign and send; I don't need to see it again.", "Tom"], att: ["Contractor-agreement-v4.docx"] },
  ],
  b4: [{ from: "sam", when: "2026-11-03T07:45:00", text: ["Hey Robin,", "Would love to catch up — I'm in Berlin Tuesday to Thursday. Any afternoon works, or breakfast if you're an early one.", "I also finally read the thing you sent about the relaunch. Thoughts over coffee.", "Sam"] }],
  b5: [{ from: "elena", when: "2026-11-02T17:20:00", text: ["Dear Robin,", "We'd love to have you on the 'small teams, big tools' panel at Brightpath Founders Day on 6 December in Hamburg. It's 40 minutes, no slides, two other founders and a moderator.", "Travel and a night's stay are covered. Could you let me know by 20 November?", "Warmly,", "Elena"] }],
  b6: [
    { from: "you", when: "2026-10-28T18:30:00", text: ["Lena, October's update: retention 94%, two hires, the relaunch on the 14th. Deck attached."], att: ["Hale-Oct-update.pdf"] },
    { from: "lena", when: "2026-10-29T08:50:00", text: ["Thanks Robin, reading this week."] },
    { from: "lena", when: "2026-11-02T16:05:00", text: ["Great numbers on retention. One question on the hiring plan: is the second engineer a replacement or new headcount? It changes how I read the runway slide.", "See you Friday.", "Lena"] },
  ],
  b7: [{ from: "marco", when: "2026-11-02T14:40:00", text: ["Call time 8:30 at the studio, outdoors from 9:15 while the light holds. Bring the product samples and the two shirts Ana picked. Call sheet attached.", "Marco"], att: ["Call-sheet-Thu.pdf"] }],
  b8: [
    { from: "dev", when: "2026-11-01T18:20:00", text: ["Staging is on the new sync engine since this afternoon. No errors in 6 hours."] },
    { from: "dev", when: "2026-11-02T11:15:00", text: ["Everything's green on staging. I'd like to flip prod Wednesday morning unless you want another day of soak. Rollback is a flag.", "Devon"] },
  ],
  b9: [{ from: "kit", when: "2026-11-01T19:30:00", text: ["Found a place in Alfama with a terrace that fits ten, 18–21 Jan. Holding it until Friday. Photos in the PDF.", "Kit"], att: ["alfama-house.pdf"] }],
  b10: [{ from: "priya", when: "2026-10-31T15:02:00", text: ["Robin, meet Dana (cc'd) who runs partnerships at Northwind. I'll let you two take it from here.", "Priya"] }],
  b11: [{ from: "jonas", when: "2026-10-30T16:48:00", text: ["Paid today, should land Tuesday. Apologies for the delay — finance moved to a new system."] }],
  b12: [{ from: "ana", when: "2026-10-30T10:20:00", text: ["Latest cut from the illustrator. The 24 px variants are in. Open the source file, not the PNGs, if you want to see the alternates."], att: ["icons-1.3.zip"] }],
  b13: [{ from: "elena", when: "2026-10-29T09:10:00", text: ["Perfect, the PDF works. See you on the 14th."] }],
  b14: [{ from: "sam", when: "2026-10-28T21:05:00", text: ["'The Mom Test' — short, and it fixes the exact thing we talked about. Lend it to you Tuesday if you want."] }],
  f1: [{ from: "you", when: "2026-10-27T16:10:00", text: ["Hi Priya,", "Sending over the one-pager and three dates for a call: Thu 6 Nov 11:00, Fri 7 Nov 15:00 or Mon 10 Nov 10:00. Dana is welcome to join.", "Robin"], att: ["Partnership-one-pager.pdf"] }],
  f2: [{ from: "you", when: "2026-10-30T11:25:00", text: ["Tom, going with classes 9, 35 and 42 for the EU filing. Can you file this week? Happy to sign whatever you need.", "Robin"] }],
  f3: [{ from: "you", when: "2026-10-31T09:40:00", text: ["Jonas, answers attached. The two open items (data residency, SSO logs) need your IT lead; everything else is filled in.", "Robin"], att: ["Acme-security-questionnaire.xlsx"] }],
  u1: [{ from: "stripe", when: "2026-11-03T06:02:00", text: ["Invoice #4821 for October: €49.00. No action needed — it's paid from your card ending 4421.", "Download the PDF for your records."], att: ["invoice-4821.pdf"] }],
};

/* ── round 3: the shipped model's extras ───────────────────────────────────────────────── */
PEOPLE.jonas.priority = true; PEOPLE.ana.priority = true;
PEOPLE.olivia = { name: "Olivia Grant", email: "olivia@seedcamp.com", company: "", role: "", hue: "teal", contact: false };
PEOPLE.hannah = { name: "Hannah Lee", email: "hannah@designlab.io", company: "", role: "", hue: "violet", contact: false };
PEOPLE.dana = { name: "Dana Whitfield", email: "dana@northwind.co", company: "Northwind", role: "Partnerships", hue: "pink", contact: false };
THREADS.splice(1, 0, { id: "t15", acc: "work", from: "jonas", to: ["you", "dev"], subject: "Invitation: Acme weekly", snippet: "Thu 5 Nov, 11:00 – 11:30 · Google Meet. Agenda: pilot week, seat count, SSO window.", when: "2026-11-03T10:05:00", unread: true, kind: "people", msgs: 1, att: ["invite.ics"], invite: { title: "Acme weekly", when: "Thu 5 Nov, 11:00 – 11:30", where: "Google Meet", organizer: "Jonas Weber" }, body: "b15" });
THREADS.push(
  { id: "n1", acc: "work", from: "olivia", to: ["you"], subject: "Office hours next week?", snippet: "Saw the relaunch teaser. I run founder office hours on Thursdays and would love to have you.", when: "2026-11-03T08:40:00", unread: true, kind: "people", msgs: 1, screened: true },
  { id: "n2", acc: "personal", from: "hannah", to: ["you"], subject: "Portfolio: product designer, freelance", snippet: "Hi Robin, I saw you're hiring for the relaunch. Portfolio attached, available from December.", when: "2026-11-02T19:10:00", unread: true, kind: "people", msgs: 1, att: ["Hannah-Lee-portfolio.pdf"], screened: true },
);
BODIES.b15 = [{ from: "jonas", when: "2026-11-03T10:05:00", text: ["Weekly check-in with Devon from now on. Agenda: pilot week, seat count, SSO window.", "Jonas"], att: ["invite.ics"] }];
const TODAY = {
  events: [["9:30", "Standup", true], ["14:00", "Design review · Ana", false], ["16:00", "Hiring sync", false]],
  tasks: [["Fix the landing build", "Devon"], ["Answer Lena on the second engineer", ""]],
};
const SAVED = [["Acme with files", "from:acme has:attachment"], ["Invoices", "subject:invoice"]];
const FOLDER_TREE = { work: ["Inbox", "Sent", "Drafts", "Archive", "Clients/Acme", "Clients/Northwind", "Receipts 2026", "Trash"], personal: ["Inbox", "Sent", "Archive", "[Gmail] Travel", "[Gmail] Family"], studio: ["INBOX", "Sent", "Archive", "Workshops"] };

/* ── round 5: what the rebuilt engine knows (specs/mail-rebuild.md, MR-1…MR-16) ─────────── */
ACCOUNTS.work.aliases = [["robin@haleandco.com", "Robin Hale · Hale & Co", true], ["hello@haleandco.com", "The Hale & Co team", false]];
ACCOUNTS.personal.aliases = [["robin.hale@gmail.com", "Robin", true]];
ACCOUNTS.studio.aliases = [["robin@lumen.studio", "Robin · Lumen Studio", true]];
ACCOUNTS.work.health = { kind: "Google Workspace", signin: "Signed in with Google", push: true, depth: "Last 12 months", mail: 1.4, files: 0.6, cap: 2, reapprove: "Mon 10 Nov" };
ACCOUNTS.personal.health = { kind: "Gmail", signin: "App password", push: true, depth: "Last 6 months", mail: 0.5, files: 0.2, cap: 2 };
ACCOUNTS.studio.health = { kind: "IMAP · mail.lumen.studio", signin: "Password", push: false, depth: "Everything", mail: 0.3, files: 0.1, cap: 2 };
const SNIPPETS = [["hello", "Nice to meet you", "Great to meet you, {first name}. The short version of what we do at Hale & Co:"], ["thanks", "Got it, more by Friday", "Thanks {first name}, got it. I'll come back to you properly by Friday."], ["slots", "Three slots", "Happy to talk. Three times that work for me this week:"]];
const OUTBOX = [
  { id: "o1", acc: "work", to: "lena", subject: "Re: Second engineer: the shortlist", snippet: "You: Two names below. Both can start in January; I'd meet them Thursday.", when: "2026-11-03T10:38:00", msgs: 2 },
];
/* why a thread sits in its tab: the classifier's order is blocked → rules → per-sender choice
   → custom tabs → contacts → headers (MR-3/MR-12, AC25) */
const WHY = {
  stripe: { by: "rule", text: "Your rule: From receipts@stripe.com → put in tab Notifications, label Receipts", step: 2 },
  linear: { by: "headers", text: "Linear sends from a no-reply address with a mailing-list header.", step: 6 },
  github: { by: "headers", text: "GitHub sends from a no-reply address with a mailing-list header.", step: 6 },
  vercel: { by: "headers", text: "Vercel sends from a notifications address with a mailing-list header.", step: 6 },
  calendly: { by: "sender", text: "You chose Notifications for Calendly on 14 Oct.", step: 3 },
  hetzner: { by: "headers", text: "Hetzner sends from a billing address with a mailing-list header.", step: 6 },
  figma: { by: "headers", text: "Figma sends from a team address with a mailing-list header.", step: 6 },
};
const WHY_STEPS = ["Blocked senders", "Your rules", "Your choice for this sender", "Custom tabs", "People in your contacts", "Mailing-list headers"];

PEOPLE.marc = { name: "Marc Duval", email: "marc@northzone.vc", company: "Northzone", role: "Principal", hue: "amber", contact: true, lastTouch: "Coffee 21 Oct", openTasks: 0, notes: 1, meetings: [], tasks: [], noteTitles: ["Northzone: first call"] };
THREADS.find((t) => t.id === "t6").kind = "investors";
THREADS.push({ id: "i1", acc: "work", from: "marc", to: ["you"], subject: "Seed extension: are you raising in Q1?", snippet: "We'd like to be early if you open the round. Thirty minutes next week to hear the plan?", when: "2026-11-03T09:12:00", unread: true, kind: "investors", msgs: 1 });
WHY.marc = WHY.lena = { by: "tab", text: "Your Investors tab collects mail from fjordventures.com and northzone.vc.", step: 4 };
DRAFTS.push({ id: "d2", acc: "work", to: "marco", subject: "Shoot: the final shot list", snippet: "Marco, the list for Thursday: 14 set-ups, the samples come with me. Hero first while the light is low.", when: "2026-11-03T10:39:00" });
