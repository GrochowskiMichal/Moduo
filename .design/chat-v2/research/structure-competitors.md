> Raw research report from the Chat re-plan, 2026-10-13. Nothing here is decided.

# How team chat tools structure conversation — competitor research

**Lane:** structure + competitors. **Question:** how do Slack, Discord, Teams, Google Chat, Basecamp, Twist, Zulip and the rest structure team talk, and what should Moduo's chat structure be for teams of 2–5 (plus hackathon teams and organizers)?

**Legend.** [V] = checked against a primary source (the vendor's own docs, pricing page, release notes, or the affected party's own post), linked. [U] = unverified: secondary source, or from prior knowledge, or the primary page was unreachable. Treat [U] as a lead to check, not a fact.

**Method note.** Web research on 2026-10-13. The run was cut by a usage limit once (about 04:25 CEST) and resumed. Discord's support site blocks automated fetching (HTTP 403), so most Discord rows rely on search snippets of its help pages and are marked [U] unless noted.

---

## 1. Snapshot: each product's structure in one paragraph

**Slack.** Workspace → channels (public/private) grouped into the user's own sidebar sections → messages with one level of reply threads. DMs and group DMs sit beside channels. Personal triage views: Activity (mentions, threads you are in, reactions), Later (saved items + reminders, with In progress / Archived / Completed tabs), an optional Unreads view on desktop, and Catch up (a swipe-card deck of unreads) on mobile [V: [Later](https://slack.com/help/articles/360042650274-Save-messages-and-files-for-later), [Unreads + Catch up](https://slack.com/help/articles/226410907)]. Extras: huddles, canvases, lists, workflows, Slack Connect for other companies, guests on paid plans.

**Discord.** Server → categories → channels of several kinds (text, voice, stage, forum, announcement, media) → messages with optional threads. Roles control who sees and does what. Forum channels make every post its own thread with tags. Announcement channels can be "followed" into other servers. Community Onboarding lets new members pick roles and channels by answering questions [U: Discord help via search snippets; [Onboarding article](https://support.discord.com/hc/en-us/articles/11074987197975)]. An Inbox (desktop/web only) collects Mentions and Unreads [U: [Inbox FAQ](https://support.discord.com/hc/en-us/articles/360045027712-Inbox-FAQ), via search snippet].

**Microsoft Teams.** Historically two worlds: Teams → channels with "posts" (email-like, subject + replies), and a separate Chat app (DMs, group chats, meeting chats). Since 2025 the two can be merged into one list with Favorites, Chats, Teams-and-channels, and up to 50 custom sections, plus filters for Unread / Chats / Channels / Meeting chats and "quick views" for @mentions and Followed threads [V: [Microsoft support](https://support.microsoft.com/en-us/topic/d1036ef9-8295-41e4-848a-cb92e3431912)]. Channels can also now use a chat-like "Threads" layout instead of posts (rollout June–Aug 2025; the Posts tab becomes "Conversation") [V: [Message Center MC1088172 mirror](https://mc.merill.net/message/MC1088172/v/2025-06-23T20-17-36-803Z); [U: [Practical365](https://practical365.com/teams-threaded-layout/)]].

**Google Chat.** DMs, group conversations and "spaces". Spaces use in-line threading: send to the whole space, or reply to one message to start a thread. Threads you follow show on Home; you are notified for @mentions and replies in followed threads [U: via [Workspace Updates](https://workspaceupdates.googleblog.com/2024/10/gemini-summaries-google-chat.html) search summary]. Gemini summaries on Home (since Oct 2024) and an in-conversation catch-up card for long unread backlogs (Aug 2025) [V: [Workspace Updates, Aug 2025](https://workspaceupdates.googleblog.com/2025/08/catch-up-unread-conversations-gemini-chat.html)].

**Basecamp (now Basecamp 5, May 2026).** Work-anchored. Every project has a fixed set of tools: Message Board (long-form posts with comments), Chat (formerly Campfire: one chat room per project), to-dos, card table, schedule, docs and files, automatic check-ins. Pings are private 1:1 or small-group chats across projects. Basecamp 5 replaced the "Hey!" notification menu with a permanent "New For You" sidebar holding notifications and Pings, added "Bubble Up" (snooze an item back into the sidebar later), and an "Everything" page that lists, for example, all messages across all projects [V: [Basecamp 5 page](https://basecamp.com/5), [DHH, 2026-05-26](https://world.hey.com/dhh/basecamp-five-8fcfd2ef)]. Notification schedule "Work Can Wait!" holds notifications outside your hours; "Catch me up" sends a summary of what happened while you were away [V: [Basecamp 5 Help — Notifications](https://5.basecamp-help.com/article/1177-notifications)].

**Twist (Doist).** Thread-first. Channels (by topic, project or client) contain threads; each thread has a title, like a forum post or email subject. Private "Messages" for 1:1 talk. An Inbox gathers threads for each person. Positioning: async, calm, no presence dots [V: [twist.com](https://twist.com/)].

**Zulip.** Channels (renamed from "streams" in Zulip 9.0, 2024 [U]) where every message carries a topic, so each channel is a list of named conversations. Zulip 10 allowed an empty "general chat" topic and Zulip 11 (2025-08-13) allows channels without topics at all, plus channel folders [V: [Zulip 11.0 release post](https://blog.zulip.com/zulip-server-11-0); [U: general-chat help page, Zulip docs mirrored at](https://chat.fhir.org/help/general-chat-channels)]. Note: even the topic-first purist softened its model for casual channels.

**Linear.** Ships no chat. Talk about work happens as issue comments and project updates; real-time talk stays in Slack, bridged by an integration: create an issue from a Slack message, and the Slack thread and the issue's comment thread stay in sync both ways; status changes post back to Slack; "Asks" turns Slack requests into issues even for people without a Linear account [V: [Linear docs — Slack](https://linear.app/docs/slack), [Linear Asks](https://linear.app/integrations/linear-asks)]. Why no chat: no primary statement found. Indirect signals: the CEO describes written async wrap-ups replacing stand-ups and a strong focus discipline [U: [Sequoia profile, 2021](https://articles.sequoiacap.com/2021-03-17-karri-saarinen)]; the likelier practical reason is that its customers already live in Slack, so Linear invests in the bridge instead.

**Height.** Project tool with a chat attached to every task. Announced shutdown in March 2025, shut down 2025-09-24 [U: [AlternativeTo news](https://alternativeto.net/news/2025/3/height-project-management-tool-to-shut-down-by-september-2025/); several secondary sources agree].

*(Campsite, Threads, Missive, Front, WhatsApp/Telegram/Messenger, newcomers: section 1b, below.)*

### 1b. The rest of the field

**Campsite.** Posts-first async tool (posts as the default unit, plus chat/DMs, calls, docs, AI summaries). Its site now shows a banner that Campsite is winding down and that its founders have joined Notion; no date on the page [V: [campsite.com](https://www.campsite.com/)]. The code is public on GitHub, provided as-is and not actively maintained, forks welcome for non-commercial use [V: [github.com/campsite/campsite](https://github.com/campsite/campsite)]. Read: posts-first as a standalone product did not survive; its founders went to Notion.

**Threads (threads.com, the work app).** Sequoia-backed (2019) async app for turning conversations into lasting narratives. The domain was later sold: TechCrunch reported Meta acquired threads.com in Sept 2024, and Meta's social app moved there in April 2025 [U: [TechCrunch](https://techcrunch.com/2024/09/25/meta-acquires-the-threads-com-domain-name), [Neowin](https://www.neowin.net/news/meta-finally-moves-threadsnet-to-threadscom-brings-more-improvements-to-web-app/)]. The work app's current status is unclear; one report says Shopify acquired the company in 2024 [U]. Either way: no longer a live option.

**Missive.** Team email client where every email thread has an internal chat/comments pane beside it, plus team chat rooms and tasks. Third-party pricing pages list about $14 / $24 / $36 per user per month billed yearly (higher monthly), with the cheapest tier capped at 5 users; AI is bring-your-own-key [U: [usecarly](https://www.usecarly.com/blog/missive-pricing/), [dragapp](https://www.dragapp.com/blog/missive-pricing/)]. Structure lesson: **internal talk attached to an external object** (an email thread) works well and is Missive's whole pitch.

**Front.** Shared-inbox for customer-facing teams; teammates comment and @mention inside a customer conversation instead of forwarding. Per-seat pricing reported at about $25 / $65 / $105 per seat per month (annual), with seat caps on lower tiers [U: [getmacha](https://www.getmacha.com/blog/front-pricing-explained), [eesel](https://www.eesel.ai/blog/front-pricing)]. Same lesson as Missive, priced for support teams, not 2–5 person studios.

**WhatsApp (Communities, groups).** A Community links up to ~50 groups under one auto-created announcement group where only admins post; groups hold up to 1,024 people; announcement reach reported at 2,000–5,000 depending on source [U: [GSMArena launch report](https://m.gsmarena.com/whatsapp_unveils_communities_feature_raises_group_limit_to_1024_participants-news-56392.php), [getkanal guide](https://getkanal.com/blog/whatsapp-communities-guide)]. Structure: flat linear groups + a broadcast layer. Phone-number identity mixes personal and work.

**Telegram.** Groups can switch on Topics (forum mode, since Nov 2022): each topic acts as its own chat with its own media and notification settings, with a permanent "General" topic [V: [Telegram blog](https://telegram.org/blog/topics-in-groups-collectible-usernames), [API docs](https://core.telegram.org/api/forum)]. Originally only for groups over 200 members; reportedly now any size [U]. Channels are one-way broadcast.

**Messenger.** Meta shut down the standalone Messenger desktop apps for Mac and Windows on 2025-12-15; desktop users go to the web [U: [BetaNews](https://betanews.com/2025/10/17/meta-is-discontinuing-windows-and-mac-messenger-apps/), confirmed to TechCrunch per reports]. Also: Meta's own work product, Workplace, announced shutdown in May 2024, went read-only from Sept 2025 and ended around 31 May 2026 [U: [TechRadar](https://www.techradar.com/pro/meta-shuts-down-workplace-its-slack-rival-that-never-really-took-off), [SiliconANGLE](https://siliconangle.com/2024/05/14/meta-shut-workplace-business-communications-platform/)]. Read: Meta is retreating from desktop and from work.

**ClickUp Chat (closest all-in-one analogue).** Channels + DMs inside ClickUp; hover a message → Create Task (pick a List, or let AI pick), and the new task shows above the message in the thread; tasks cannot be created from threaded replies; "Posts" for important announcements; "SyncUps" for calls from any channel or DM; Slack import [V: [ClickUp — What is Chat?](https://help.clickup.com/hc/en-us/articles/25790737416855-What-is-Chat), [Connect tasks to Chat messages](https://help.clickup.com/hc/en-us/articles/26425806391703-Connect-tasks-to-Chat-messages)]. Structure: Slack-like channels bolted onto a work tool, with message → task as the bridge.

**Newcomers worth knowing (2024–26).**
- **Buzz (Block / Jack Dorsey), launched 2026-07-21.** Open-source, Nostr-based group chat for mixed teams of people and AI agents: channels, threads, DMs, voice, code repos, workflows; agents are first-class members [U: [Decrypt](https://decrypt.co/374026/jack-dorseys-block-launches-buzz-nostr-based-slack-and-github-rival-for-ai-agents?amp=1), [Linuxiac](https://linuxiac.com/jack-dorsey-launches-buzz-an-open-source-slack-alternative/)].
- **Slackbot as a personal agent (GA 2026-01-13)** for Business+ and Enterprise+ [V: [Salesforce press release](https://investor.salesforce.com/news/news-details/2026/Salesforce-Announces-the-General-Availability-of-Slackbot--Your-Personal-Agent-for-Work/default.aspx)]. The incumbents' 2026 direction is "agents in the channel".
- **Glue (2024).** AI-native work chat whose atomic unit is the thread, not the channel [U: [Business Wire](https://www.businesswire.com/news/home/20240514116610/en/Introducing-Glue-Work-Chat-for-the-AI-Era)].
- **Basecamp 5 (2026-05-26)** and **Zulip 11 (2025-08-13)**, covered above, are the notable 2025–26 releases from older players.
- **Campfire (37signals, self-hosted)** reportedly now free and MIT-licensed [U: third-party deploy pages only].

---

## 2. Dimension tables

"Not checked" = no source reviewed in this run; do not read it as "absent".

### D1. Unit of conversation, and where talk about a work item lives

| Product | Primary unit | Secondary unit | Talk about one work item lives… |
|---|---|---|---|
| Slack | Channel (a message stream) | One level of reply threads; DMs, group DMs | In whatever channel or thread it started; work items arrive as links/unfurls, or via app bridges such as Linear's synced threads [V: [Linear](https://linear.app/docs/slack)] |
| Discord | Channel inside a category inside a server | Threads; forum posts (each post is its own thread, with tags) [U] | A thread or forum post; no native work objects |
| Teams | Channel "post" (subject + replies) or a chat | Since mid-2025, optional chat-like "Threads" layout per channel [V: mirror of MC1088172] | Channel posts/threads and channel tabs (files, apps) [U for tabs] |
| Google Chat | Space with in-line threads; DMs; group chats | A thread inside a space [U] | A space or thread; files via Drive [U] |
| Basecamp | Project, holding a Message Board, one project Chat, to-dos, docs, card table | Pings (DM/small group); comments on every to-do, doc, card [V: [help](https://5.basecamp-help.com/article/1177-notifications)] | **On the object itself** (to-do or doc comments), or the project's Message Board / Chat |
| Twist | Titled thread inside a channel | Private Messages [V: [twist.com](https://twist.com/)] | A thread named for the item |
| Zulip | Topic inside a channel | DMs; since 11.0 optional topic-less channels [V: [Zulip 11](https://blog.zulip.com/zulip-server-11-0)] | A topic named for the item |
| Linear | Issue comment thread; project updates | (Slack, bridged) | On the issue; mirrored to a Slack thread [V] |
| Height (shut 2025) | Chat on every task | — | The task's chat [U] |
| Missive / Front | Internal comments attached to an email conversation | Missive: chat rooms, tasks [U] | On the email thread itself [U] |
| ClickUp | Channel / DM | Threads; Posts [V: [ClickUp](https://help.clickup.com/hc/en-us/articles/25790737416855-What-is-Chat)] | A task created from a message, shown above that message [V] |
| WhatsApp / Telegram | Linear group chat | Telegram topics; WhatsApp community subgroups [V/U] | Nowhere structured |

**Read.** Two families. **Container-first** (Slack, Discord, Teams, Google Chat, WhatsApp): the conversation lives in a channel and the work is only *referenced* by a link. **Object-first** (Linear, Height, Missive/Front, Basecamp's comments): the conversation is *attached to* the thing. Basecamp and ClickUp are hybrids: a container (project chat / channel) plus object comments, bridged by "message → task". Thread-first tools (Twist, Zulip, Glue) sit between: the container is a list of named conversations.

Two 2025 moves point to the middle. Teams added chat-like threads because channel "posts" felt too formal. Zulip added topic-less channels because mandatory topics felt too formal for social rooms. And most of the object-first or new-unit startups in this set are gone (Height closed, Campsite winding down, Threads sold its domain); Twist survives as a niche. Structure has done best inside a bigger workspace (Basecamp, ClickUp, Missive).

### D2. Notification model and defaults

| Product | What pings by default | Schedules / quiet hours | Granularity | Summary / digest |
|---|---|---|---|---|
| Slack | DMs, @mentions and your keywords. Options: all new messages, or nothing; per-channel exceptions [V: [help 201355156](https://slack.com/help/articles/201355156)] | Notification schedule; outside it notifications pause [V: same] | Per channel, per thread, keywords | Catch up deck (mobile); AI recaps on Business+ [V: [help 39264531104275](https://slack.com/help/articles/39264531104275)] |
| Discord | Set per server by admins (All messages or Only @mentions) [U]. Users complain that new servers notify on every message and must be changed by hand each time [U: [support community post](https://support.discord.com/hc/it/community/posts/4406349904151-Default-server-notification-settings)] | Do Not Disturb status [U] | Per server, category, channel; suppress @everyone and role mentions [U] | None found |
| Teams | Not checked in detail | Not checked | Per channel [U] | Copilot recap (paid) [U] |
| Google Chat | @mentions and replies in threads you follow [U] | Not checked | Per space [U] | Gemini summaries on Home and an in-conversation catch-up card (paid Workspace) [V: [Aug 2025](https://workspaceupdates.googleblog.com/2025/08/catch-up-unread-conversations-gemini-chat.html)] |
| Basecamp | You choose: everything, or only Pings + @mentions. Chat rooms notify only if you opt in; new rooms do not auto-include everyone. Posting a comment subscribes you to that discussion; each thread shows who will be notified, with notify / don't-notify toggles. **Client users are always on and cannot change it** [V: [help](https://5.basecamp-help.com/article/1177-notifications)] | "Work Can Wait!": notifications only in your hours and days, held otherwise [V] | Per project ("yes, notify me" / "only when…"), per thread, per room [V]; Bubble Up snooze [V: [Basecamp 5](https://basecamp.com/5)] | "Catch me up": a summary email/push of what happened after hours [V] |
| Twist | Not checked in detail; sells itself on calm notifications and no notification dots [V: [twist.com](https://twist.com/)] | Not checked | Per thread mute [U] | Inbox |
| Zulip | Not checked in detail | Not checked | Follow / mute per topic; one personal panel for all channel settings (11.0) [V] | None found |

**Read.** Slack's default trigger (DMs + mentions + keywords) is already "quiet", yet Slack still built Catch up because people felt overwhelmed by unreads [U: Slack's director of product, quoted by [TechRadar](https://www.techradar.com/pro/slacks-new-feature-wants-you-to-swipe-right-on-all-those-unread-alerts)]. So the noise is not only pings; it is **unread counts on many containers**. Basecamp is the closest match to Moduo's bar: one global switch, opt-in chat rooms, per-object subscription shown on the object, work hours, and an after-hours summary. Its one hard edge (clients always notified) is a choice Moduo would need to make too.

### D3. Catch-up and unread model

| Product | Cross-conversation "what's new" | Personal activity view | Save for later / snooze | Notes |
|---|---|---|---|---|
| Slack | Unreads view (desktop; opt-in in sidebar; sort and filter; mark all read with Undo); Catch up deck on mobile; muted and archived channels excluded [V: [help 226410907](https://slack.com/help/articles/226410907)] | Activity: mentions, threads you are in, reactions; Unreads toggle [V: [Later/Activity help](https://slack.com/help/articles/360042650274-Save-messages-and-files-for-later)] | Later: In progress / Archived / Completed, with reminders on any message [V: same] | Mark unread exists (Alt/Option-click) [U: garbled shortcut table] |
| Discord | Inbox → Unreads tab (desktop/web only) [U: [Inbox FAQ](https://support.discord.com/hc/en-us/articles/360045027712-Inbox-FAQ)] | Inbox → Mentions; mentions clear after 7 days [U] | Not checked | — |
| Teams | Unread filter over the merged list; channel names go bold [V: [support](https://support.microsoft.com/en-us/topic/d1036ef9-8295-41e4-848a-cb92e3431912)] | Quick views for @mentions and Followed threads (show always / when unread / hide) [V: same] | Not checked | Up to 50 custom sections [V] |
| Google Chat | Home: feed of conversations and followed threads, with Summarize on hover [V: [Oct 2024](https://workspaceupdates.googleblog.com/2024/10/gemini-summaries-google-chat.html)] | Mentions, starred [U] | Starred [U] | — |
| Basecamp 5 | Everything page (e.g. all messages across projects on one list); Activity grouped by topic and person [V: [Basecamp 5](https://basecamp.com/5)] | New For You sidebar holds notifications and Pings; Return moves to next item [V: [DHH](https://world.hey.com/dhh/basecamp-five-8fcfd2ef)] | Bubble Up: defer an item; it returns to the sidebar later [V] | Replaced the old open-click-close "Hey!" menu [V] |
| Twist | Inbox gathers threads per person [V: [twist.com](https://twist.com/)] | Same Inbox | Save thread; mark unread [U: help article titles only] | — |
| Zulip | Inbox view, grouped by channel folder in 11.0 [V]; Recent conversations [U] | — | Not checked | Bulk mark-read for muted / unfollowed topics (11.0) [V] |

**Read.** Every incumbent has bolted a **triage layer** on top of its containers: Slack (Unreads, Activity, Later, Catch up), Teams (filters + quick views), Discord (Inbox), Google (Home), Basecamp (New For You sidebar + Bubble Up). The unit of triage has converged on "a conversation with something new for me", not "a channel". Snooze-to-later is now standard (Slack Later, Basecamp Bubble Up, which Basecamp credits to HEY). For long backlogs, the 2025 pattern is a summary card at the top of the conversation (Google) or a recap (Slack, paid).

### D4. Threads vs replies vs topics, and the complaints

| Product | Model | Friction seen |
|---|---|---|
| Slack | Optional one-level reply threads, hidden from the channel; optional "also send to channel" | Slack's own design team: nested replies confused testers, one-level threads then made channels unreadable, and the fix (hide replies from the channel) meant replies no longer marked anything unread. Thread alerts in Activity were easy to miss yet distracting, so they built a dedicated All Threads view [V: [slack.design](https://slack.design/articles/threads-in-slack-a-long-design-journey-part-2-of-2/), undated, ~2020]. Users still report replies going unseen unless sent to the channel [U: [G2 review](https://www.g2.com/survey_responses/slack-review-13734269)] |
| Discord | Optional threads (public/private), auto-archive after inactivity (default reported as 24 h); you are not notified for threads you have not joined [U: [Drexel guide](https://support.cci.drexel.edu/getting-connected/discord/discord-threads/), [dev docs](https://docs.discord.com/developers/topics/threads.md)] | Users ask for a "never hide" option for inactive threads [U: [support community](https://support.discord.com/hc/pl/community/posts/13723557751319-Thread-Inactivity-Option-Never-Hide-Expire)] |
| Teams | Posts (subject + replies) or, since 2025, chat-like threads in a side pane; a Followed threads view across channels [V: mirror of MC1088172] | Posts layout read like email; Microsoft added the threads layout |
| Google Chat | In-line threading: reply to any message to start a thread; follow threads [U] | Not checked |
| Zulip | Topic on every message | Zulip itself relaxed it: "general chat" empty topic (10) and topic-less channels (11.0) [V] |
| Twist | Titled threads; replies inside | Not checked |
| Basecamp | Flat project chat; threaded discussion lives on Message Board posts and object comments | "Which place do I post in?" is the classic Basecamp question [U] |
| Telegram | Topics (forum mode) | A guide notes topics can add friction in smaller groups [U: [metricgram](https://metricgram.com/blog/telegram-forum-topics-guide)] |

**Read.** Three designs: no threads (Basecamp chat, WhatsApp), optional reply threads (Slack, Discord, Google Chat, Teams threads), mandatory topic/title (Zulip, Twist, Teams posts). In 2025 both ends moved toward optional threads. The "missed reply" complaint is really a routing problem: a reply must reach the people who care even when they are not looking at that container. Slack (Activity), Teams (Followed threads) and Basecamp (subscribers shown on each thread) each solve routing explicitly. Slack's own design write-up is the best primary evidence: hiding replies keeps channels readable but breaks unread signals, so every threaded design needs a separate routing view. ClickUp users report the same unseen-reply problem in ClickUp Chat [U: [feedback board](https://feedback.clickup.com/chat-feedback/p/send-threaded-message-to-chat-and-thread)]. No dated study quantifying it was found.

### D5. Announcements and broadcast to many groups

| Product | Broadcast primitive | Reaches other groups? |
|---|---|---|
| Slack | No announcement-follow mechanism found in the docs reviewed; cross-posting is manual (share a message into another channel). Posting-restricted channels exist [U] | No native follow |
| Discord | Announcement channel: sender presses Publish and the message appears in every server that follows the channel; some mentions are not pushed through [U: [support article](https://support.discord.com/hc/articles/360032008192), via search snippet] | Yes (Follow) |
| Teams | Announcement-style posts, cross-post to several channels [U] | Within the tenant [U] |
| Google Chat | Announcement-only spaces [U] | Not checked |
| Basecamp | Message Board post per project, choosing who to notify; Everything → All Messages lists posts from all projects [V: [Basecamp 5](https://basecamp.com/5)] | No; per project |
| WhatsApp | Community announcement group; only admins post; reaches all subgroups' members [U] | Yes, within the Community |
| Telegram | Channels (one-way) [U] | Not checked |
| ClickUp | Posts to draw attention to important information [V: [ClickUp](https://help.clickup.com/hc/en-us/articles/25790737416855-What-is-Chat)] | Not checked |

**Read.** Only Discord and WhatsApp have a true **one-to-many-groups** primitive, and those are exactly the tools hackathon organizers and communities use. MLH's organizer guide recommends Discord, citing free voice, with a baseline of eight channels: Team-Formation, Carpool-Search, Ask-Organizers, Introductions, Random, Ask-Mentors, Mentors-Internal, Admin (plus an admin voice channel) [V: [MLH guide](https://guide.mlh.com/general-information/event-logistics/hackathon-communication-platform)]. That list is a usable checklist: it needs a broadcast room, help-desk rooms, a staff-only room, and team formation. A 2–5 person team needs none of the broadcast machinery.

### D6. Guests and external people (clients, contractors)

| Product | How | Cost | Limits |
|---|---|---|---|
| Slack | Guests (paid plans only). Multi-channel guests billed as members; single-channel guests free, up to 5 per paid active member; guests can DM only people who share a channel [V: [help 202518103](https://slack.com/help/articles/202518103)]. Slack Connect: 1:1 external DMs on any plan; shared channels need every org on a paid plan; group external messaging (up to 250 orgs) on paid [V: [pricing](https://slack.com/pricing), [Connect help](https://slack.com/help/articles/115004151203)] | Free → paid jump to unlock any guest | Admin-only invites [V] |
| Discord | Anyone with an invite link; roles restrict what they see [U] | Free | Moderation burden [U] |
| Teams | Guest access and external (federated) access [U] | Not checked | Not checked |
| Google Chat | External people in spaces if the admin allows [U] | Not checked | Not checked |
| Basecamp | Invite clients/guests into a project; client users always get notifications [V: [help](https://5.basecamp-help.com/article/1177-notifications)] | Counted as users on Free (max 5) and Freelancer (max 20); **unlimited users from Studio $59/mo flat** [V: [pricing](https://basecamp.com/pricing)] | Per-project scope |
| Twist | Guests see only channels they are invited to. Free: up to 500 guests, same 1-month history. Unlimited: single-channel guests free, multi-channel billed like members [V: [pricing](https://twist.com/pricing)] | Free single-channel guests | — |
| Missive | Guest access on all paid plans [U] | Not checked | — |
| WhatsApp | Phone number; anyone | Free | Exposes personal numbers [U] |

**Read.** The industry norm for a client: **free if confined to one room**, billed if they roam (Slack, Twist), or free under flat pricing (Basecamp). For Moduo the natural "one room" is the client's own entity conversation.

### D7. Message → task / work object; links and previews

| Product | Message → work object | Links / unfurls |
|---|---|---|
| Slack | Save to Later + reminders on any message [V]; app actions, e.g. Linear "create issue" from a message with a two-way synced thread [V: [Linear](https://linear.app/docs/slack)] | Rich unfurls for issues, comments, docs, projects via apps [V: same] |
| Linear | Slack message → issue; 🎫 emoji turns a Slack message into an "Ask" (works for people without a Linear account; Business/Enterprise) [V: [Asks](https://linear.app/integrations/linear-asks)] | Thread updates when the issue completes, is cancelled, marked duplicate, or reopens [V] |
| ClickUp | Hover → Create Task (choose a List or let AI choose); task shows above the message; not from threaded replies; on mobile the task is generated from thread context [V: [ClickUp](https://help.clickup.com/hc/en-us/articles/26425806391703-Connect-tasks-to-Chat-messages)] | Not checked |
| Basecamp | Chat and to-dos live side by side in the project; object comments are the main bridge [V for comments]; message → to-do not checked | Not checked |
| Teams | Create a Planner task from a message [U] | Loop components [U] |
| Discord | None native; bots | Link embeds [U] |
| Missive | Tasks from conversations [U] | — |

**Read.** Linear's synced thread is the strongest pattern found: the discussion is **not copied** into the work item; the same thread exists in both places and status changes flow back into the chat. ClickUp is the in-product version (task pinned above its source message). For Moduo, with chat and work in one app, this can go further: the message and the task can share one conversation rather than syncing two.

### D8. Search, files, pins, bookmarks, docs inside chat (thin)

| Product | What was checked |
|---|---|
| Slack | Free plan: search and view only the last 90 days; data over a year old deleted on a rolling basis since 2024-08-26 [V: [help 115002422943](https://slack.com/help/articles/115002422943)]. Canvases and Lists on paid plans; Free column unclear on the current pricing page [V: [pricing](https://slack.com/pricing)]. Pins/bookmarks not checked. |
| Basecamp | Docs & Files per project; Basecamp 5 editor adds tables, markdown, code highlighting, voice notes [V: [DHH](https://world.hey.com/dhh/basecamp-five-8fcfd2ef)] |
| Twist | Free: comments and messages older than one month cannot be viewed or searched, but nothing is deleted [V: [pricing](https://twist.com/pricing)] |
| Others | Not checked in this run |

**Read.** History limits are the lever incumbents use to force upgrades; deleting old data (Slack) is felt as a threat, hiding it (Twist) less so. Moduo already has Notes and attachments, so "canvas in chat" is better served by linking a Note than by a chat-only doc type.

### D9. AI in chat

| Product | What it does | How it is presented / sold |
|---|---|---|
| Slack | Pro: conversation and thread summaries, huddle notes. Business+: also recaps, translations, file summaries, AI search, workflow generation [V: [June 2025 help](https://slack.com/help/articles/39264531104275)]. As of 2026-10-13 the pricing page also lists basic AI on Free, which conflicts with the June 2025 article [V: [pricing](https://slack.com/pricing)]. Slackbot as a personal agent, GA 2026-01-13 for Business+/Enterprise+ [V: [Salesforce](https://investor.salesforce.com/news/news-details/2026/Salesforce-Announces-the-General-Availability-of-Slackbot--Your-Personal-Agent-for-Work/default.aspx)] | Bundled into plan prices; the price does not drop if you turn AI off [V: June 2025 help] |
| Google Chat | Summarize button on Home; summary card when a conversation has many unreads; Gemini side panel limited to the open conversation [V: [Aug 2025](https://workspaceupdates.googleblog.com/2025/08/catch-up-unread-conversations-gemini-chat.html)] | Paid Workspace plans only; users can turn proactive summaries off [V] |
| Basecamp 5 | No in-app AI features headlined; full API, CLI, Skills and MCP support so outside agents can use Basecamp [V: [Basecamp 5](https://basecamp.com/5), [pricing](https://basecamp.com/pricing)] | DHH: "AI accessible, but not agent hysteric" [V: [post](https://world.hey.com/dhh/basecamp-five-8fcfd2ef)] |
| ClickUp | Summarize threads; AI picks the List for a task made from a message [V] | In-product |
| Campsite | Summaries of calls and posts via OpenAI [V: [README](https://github.com/campsite/campsite)] | — |
| Buzz | Agents as channel members [U] | Open source |
| Teams / Discord / Zulip | Not checked | — |

**Read.** Two postures. Incumbents put AI *inside* the chat (summaries, recaps, agents as members) and fold its cost into seats. Basecamp keeps the chat human and exposes it to outside agents via API/MCP. Moduo's brief (MCP-only AI, no AI badges) matches Basecamp's posture; catch-up summaries would then come from the user's own agent, or not at all, and the product's own catch-up must work without AI.

### D10. Desktop / web quality and keyboard (thin)

| Product | What was checked |
|---|---|
| Slack | Unreads view is desktop-only; Catch up is mobile-only [V: [help 226410907](https://slack.com/help/articles/226410907)]. Slack frames mobile as where people triage before replying on desktop [U: TechRadar]. |
| Discord | Inbox is desktop and web only [U: Inbox FAQ via snippet] |
| Basecamp 5 | Hold Shift to reveal shortcuts; Shift+C compose; Shift+S toggles the sidebar; Return walks through new items [V: [DHH](https://world.hey.com/dhh/basecamp-five-8fcfd2ef), [Basecamp 5](https://basecamp.com/5)] |
| Messenger | Standalone Mac/Windows apps shut 2025-12-15; web only on desktop [U] |
| Campsite | Was a PWA without native apps per a 2024 review [U: [Zapier](https://zapier.com/blog/campsite-features/)] |
| Slack shortcuts | Ctrl/Cmd+K (or T) jump to a conversation (desktop app); Alt/Option+Shift+Up for previous unread channel or DM; Ctrl/Cmd+J for most recent unread message [V: [Slack keyboard shortcuts](https://slack.com/intl/en-ie/help/articles/201374536-Slack-keyboard-shortcuts)]. Esc / Shift+Esc to mark read [U: third-party lists] |
| Discord / Zulip shortcuts | Quick switcher and next-unread keys, Zulip's next-unread-topic key: prior knowledge only [U] |

**Read.** Desktop triage views (Slack Unreads, Discord Inbox, Teams filters) are where the power users live; mobile is where people skim. Moduo being desktop + web only is fine for the triage view but is a real gap for chat specifically (see section 3).

---

## 3. What pushes small teams off Slack / Discord / WhatsApp

1. **Per-seat price, and repricing.** Slack Pro is $7.25 per user per month billed yearly, $8.75 monthly; Business+ is $15 / $18 after the June 2025 repackaging that bundled AI into the price [U for USD figures: [Zenzap](https://www.zenzap.co/blog-posts/slack-pricing-in-2026-complete-guide-what-it-really-costs-your-business), [Automation Atlas](https://automationatlas.io/answers/slack-pricing-explained-2026/); V for the euro equivalents €6.75 / €8.25 and €15 / €18 on [slack.com/pricing](https://slack.com/pricing)]. Slack states the price does not change if you turn all AI off [V: [help](https://slack.com/help/articles/39264531104275)]. For five people that is roughly $36–90 a month for chat alone. Comparison: Basecamp Studio is $59/month flat with unlimited users [V: [pricing](https://basecamp.com/pricing)]; Twist is $6 per user [V: [pricing](https://twist.com/pricing)]; Discord is free.
2. **History limits on free plans.** Slack Free shows 90 days and permanently deletes data over a year old (rolling, since 2024-08-26) [V: [help](https://slack.com/help/articles/115002422943)]; reports say deleted data cannot be recovered by upgrading [U: Digital Trends via search]. Twist Free hides history after one month but deletes nothing [V]. Small teams on free Slack lose their decision record.
3. **Price shocks and vendor lock.** In Sept 2025 Slack told Hack Club (a nonprofit on a $5k/year arrangement) to pay an extra $50k that week and $200k a year, or have the workspace deactivated and history deleted. After the post went public, Slack's CEO reached out to fix it; Hack Club still said it was moving to Mattermost [V: [Hack Club volunteer's post, 2025-09-18](https://mahadk.com/posts/slack)].
4. **Always-on pressure and interruptions.** Microsoft's 2025 Work Trend Index reports interruptions about every two minutes in core hours and ~153 Teams messages a day [U: [coverage](https://unleash.ai/artificial-intelligence/news/microsoft-employees-are-interrupted-every-2-minutes-how-can-ai-help-us-re-focus-on-the-work-that-matters); original report not checked]. Slack built Catch up because users felt overwhelmed [U: TechRadar]. Whole products sell the opposite: Basecamp's Work Can Wait and Catch me up [V], Twist's async-over-ASAP pitch with no notification dots [V].
5. **Bad defaults.** Discord users report new servers notify on every message until changed by hand [U: [support community](https://support.discord.com/hc/it/community/posts/4406349904151-Default-server-notification-settings)].
6. **Personal and work mixed (WhatsApp, Messenger).** A vendor survey says 56% of employees want personal and work communication on separate platforms and 2 in 5 work after hours because of work WhatsApp groups [U: [Connecteam](https://connecteam.com/pm-downside-of-whatsapp-for-business-communications/), undated]; a 2023 recruiter survey reported 58% feel obliged to answer colleagues after hours [U: via [Newstalk](https://newstalk.com/news/employers-warned-to-set-boundaries-on-whatsapp-groups-1473907)]. Phone-number identity exposes personal numbers to clients.
7. **Discord reads as gaming.** Anecdotal: a company's evaluation committee refused to try Discord over its gaming look and game listings [U: [Discord support community thread](https://support.discord.com/hc/it/community/posts/360030253991-Discord-for-Business?page=4)].
8. **Platforms leaving.** Meta ended Workplace (read-only from Sept 2025, closed around May 2026) and killed the Messenger desktop apps (2025-12-15) [U: [TechRadar](https://www.techradar.com/pro/meta-shuts-down-workplace-its-slack-rival-that-never-really-took-off), [BetaNews](https://betanews.com/2025/10/17/meta-is-discontinuing-windows-and-mac-messenger-apps/)].
9. **Work and talk in different tools.** The amount of bridge machinery Linear ships (message → issue, two-way synced threads, status posts back to Slack, Asks) shows how much glue it takes to keep chat and work connected across two products [V: [Linear docs](https://linear.app/docs/slack)]. This is the gap Moduo's spine targets directly.

## 4. What keeps them

1. **Network effects.** Clients and partners already on Slack can be reached through Slack Connect; 1:1 external DMs work even on Free [V: [Connect help](https://slack.com/help/articles/115004151203)]. Hackers already have Discord accounts; MLH tells organizers to use Discord [V: [MLH](https://guide.mlh.com/general-information/event-logistics/hackathon-communication-platform)].
2. **Integrations.** GitHub, Linear, deploy and alert bots post into Slack/Discord. Linear's Slack bridge is deep [V]. (Slack Free caps you at 10 apps [V: [help](https://slack.com/help/articles/115002422943)].) Moduo would need at least inbound webhooks for dev teams.
3. **Mobile.** Every incumbent is mobile-first or mobile-strong; Slack's own design treats mobile as the triage surface [U]. WhatsApp is mobile-native. **Moduo chat being desktop + web only is the biggest structural disadvantage for chat** (more than for tasks or notes), because chat is where people expect to be reachable away from the desk. It also aligns with "quiet" — but it must be a stated choice, not an accident.
4. **Voice.** MLH's stated reason for Discord is free voice [V]. Slack group huddles need a paid plan [V: [pricing](https://slack.com/pricing)]. (Calls are a separate Moduo track; noted here only as a retention factor.)
5. **Free tiers.** Discord, WhatsApp and Slack Free cost nothing at the point of adoption.
6. **Cheap or free guests.** Slack single-channel guests are free (5 per paid member) [V]; Twist single-channel guests free [V]; Basecamp unlimited users at flat price [V].
7. **Habit.** Teams resist switching once settled [U: anecdotal].

---

## 5. Structures Moduo could take

Constraints taken from the repo, not from competitors: Moduo's brief says coordination **on the work** stays async through comments + @mentions + notifications, and that chat must stay inside the "quiet, grouped-by-entity, digest-by-default" bar (`docs/PRODUCT_BRIEF.md` §7 and §9). Per the designer's standing direction, the right panel is a switchable multi-view surface, so an entity's conversation could be one of its views. Each candidate below answers: who it suits; what it costs; spine fit (including whether it creates a second place to discuss the same project); quiet-bar fit; where a client lands; whether it serves hackathon organizers or only hackathon teams; appeal outside the target group.

### A. Slack-like: channels + DMs + optional reply threads + triage views

- **Suits:** teams moving straight from Slack or Discord; developers; hackathon teams. Zero learning curve.
- **Costs:** the biggest feature-parity surface (sections, threads, unreads, later, search, guests, integrations) and a direct fight on Slack's home ground, where Slack has mobile, integrations and network effects. **Creates two places to discuss a project:** a #project channel *and* the project's own comments. That is Slack's fragmentation problem rebuilt inside Moduo.
- **Spine:** weak by default. Work items are referenced by links/unfurls and "message → task"; talk is not anchored to anything.
- **Quiet bar:** needs a grouping rule invented for channels (channels are not spine entities). Unread counts per channel return as ambient pressure.
- **Client:** a single-channel guest (Slack's model).
- **Hackathons:** teams yes; organizers only if an announcement/broadcast room is added.
- **Outside the target group:** broad appeal, but then the question is "why not just Slack?".

### B. Work-anchored: every spine entity can carry a conversation, plus a few free rooms and DMs

- **Shape:** projects, clients/companies, events (and optionally tasks, notes) each have **one** conversation. It is the same stream as that entity's comments, shown chat-style: no separate room. A small number of free team rooms (for example "general" and ad-hoc rooms) and DMs / small groups cover talk that belongs to nothing. One Inbox lists every conversation with something new for you, grouped by entity.
- **Suits:** agencies (one conversation per client), founders and PMs (per project), freelancers with clients, hackathon teams (per project or submission). Closest to Basecamp, which is the longest-lived small-team tool in this set.
- **Costs:** needs a clear rule for which entities get a conversation (all, or on first message) to avoid room sprawl; needs free rooms anyway for casual talk; must merge with the existing comment system rather than sit beside it (data-model work); "where do I post?" needs a sensible default (post in the entity you are looking at; otherwise general).
- **Spine:** native. The conversation *is* a spine edge; @-links to tasks, notes, contacts are just links; "message → task" keeps the task and the message in one thread (Linear's synced-thread idea, without the sync, because it is one app).
- **Quiet bar:** grouping by entity comes for free, because the room is the entity. Following an entity = subscribing to its conversation; digest by default; only DMs, @mentions, replies to you, and things assigned to you interrupt. Basecamp's line on each thread showing who will be notified is a ready pattern.
- **Client:** invited into their own client/project conversation only, free (Slack single-channel-guest and Basecamp precedents). Open choice: Basecamp forces client notifications on; Moduo would decide its own default.
- **Hackathons:** teams yes. Organizers need two more things: an event entity that holds many team conversations (like a Discord category or a WhatsApp Community) and an announcement/post message type that reaches all of them. Community features (roles, onboarding questions, 100+ strangers, moderation) are Discord territory and would be a separate decision.
- **Outside the target group:** strong for anyone client-facing; may feel too structured to Slack natives, which the free rooms soften.

### C. Topic-first (Zulip / Twist): rooms where every message belongs to a titled topic

- **Suits:** async, distributed, developer and open-source teams; people who read by subject.
- **Costs:** steep habit change; poor fit for quick pings and for hackathon pace. Zulip, the purest example, relaxed it twice (empty "general chat" topic in 10, topic-less channels in 11.0) [V], and Twist remains niche. New-unit standalone products have mostly struggled (Campsite, Threads; Glue's thread-first pitch is unproven) [U for Glue].
- **Spine:** decent if topic = entity; otherwise a topic named "Acme redesign" duplicates the Acme project's comments (two places again).
- **Quiet bar:** good catch-up (read by topic, follow/mute per topic), but grouping is by topic, not by entity, unless the two are merged, which turns it into B.
- **Client:** a topic-scoped guest is awkward; usually channel-scoped.
- **Hackathons:** weak for both teams and organizers.
- **Outside the target group:** niche appeal.

### D. Posts + chat (Basecamp Message Board, Campsite)

- **Shape:** long-form posts (announcements, weekly updates, decisions) with comments, beside a light flat chat.
- **Suits:** async teams, agencies sending client updates, organizers.
- **Costs:** two modes to learn; posts are often underused in very small teams [U]; Campsite, the posts-first standalone, is winding down [V]. Moduo already has Notes, so a separate "post" object overlaps with Notes.
- **Spine:** a post can be an entity in its own right (or a Note with comments), which links well.
- **Quiet bar:** posts can go to digest; chat stays flat.
- **Client:** good (clients read updates).
- **Hackathons:** organizers yes (announcements); teams only through the chat half.
- **Outside the target group:** moderate.

### Comparison at a glance

| | A Slack-like | B Work-anchored | C Topic-first | D Posts + chat |
|---|---|---|---|---|
| Familiar on day one | High | Medium | Low | Medium |
| Second place to discuss a project? | **Yes** | No (if merged with comments) | Yes unless topic = entity | Partly |
| Groups by entity for the quiet bar | Needs a rule | **Built in** | By topic | Partly |
| Client lands in | a channel | their own entity conversation | a channel | posts + a room |
| Hackathon teams / organizers | yes / with broadcast added | yes / with event + broadcast added | weak / weak | partial / yes |
| Head-on fight with Slack | Yes | No | No | No |
| Build surface | Largest | Medium (merges with comments) | Medium | Medium |

### Recommendation (labelled: a recommendation, not a decision)

**B, work-anchored, with two borrowed pieces.** From A: DMs and small groups, a few free team rooms, optional one-level reply threads, and a Slack-grade triage layer (one Inbox of "conversations with something new for me", mark unread, save-for-later/snooze). From D: an **announcement / post message type** rather than a separate board, so a founder can post a weekly update and an organizer can broadcast to every team conversation under an event.

Rules that make it hold together:
1. **One conversation per entity, merged with its comments.** Never a #project room *and* project comments.
2. **Interrupt only for** DMs, @mentions, replies to you, and things assigned to you; everything else is unread-in-Inbox or digest. Plus work hours and an after-hours catch-me-up summary (Basecamp's proven pair), without AI.
3. **Clients are free guests scoped to their own conversation.**
4. **Hackathon organizers at community scale (100+ strangers, roles, onboarding) are a separate decision.** Serve hackathon *teams* fully; serve organizers with event + broadcast + guests; do not chase Discord's community features in v1.
5. **Say out loud that Moduo chat is desktop + web only** for now, and design the Inbox and digest so being away from the desk is safe.

---

## 6. Gaps and things to verify before relying on them

- Discord specifics (default notifications, thread archive defaults, forum limits): Discord's help site blocks fetching; all [U].
- Teams notification defaults, guest pricing, Copilot in chat: not checked.
- Slack pins, bookmarks, canvas/list limits on Free, exact keyboard shortcuts: not checked.
- Slack AI on Free: the Oct 2026 pricing page and the June 2025 help article disagree.
- Missive and Front prices: third-party only.
- A dated study quantifying thread-fragmentation and missed-reply complaints: not found (Slack's own design write-up is qualitative).
- Microsoft Work Trend Index 2025 figures: secondary coverage only.
- Campsite's exact wind-down date and Threads.com (work app) final status: not found.
- Why Linear has no chat: no primary statement found.
- Scheduled send (Slack; Basecamp also announced scheduled messages) and reminders beyond Slack Later: not checked.
- Discord scheduled Events and Slack workflows/huddles detail: not checked (huddles and voice belong to the Calls track).
